// ==UserScript==
// @name         WME CH Street Name Checker
// @namespace    https://github.com/Neprena
// @version      0.6.0
// @description  Validates Waze street names against the official Swiss street register (répertoire officiel des rues, swisstopo / geo.admin.ch)
// @author       Yann Rapenne
// @license      MIT
// @homepageURL  https://github.com/Neprena/wme-ch-street-name-checker
// @supportURL   https://github.com/Neprena/wme-ch-street-name-checker/issues
// @downloadURL  https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js
// @updateURL    https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js
// @match        https://www.waze.com/editor*
// @match        https://www.waze.com/*/editor*
// @match        https://beta.waze.com/editor*
// @match        https://beta.waze.com/*/editor*
// @exclude      https://www.waze.com/user/editor*
// @exclude      https://www.waze.com/*/user/editor*
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      api3.geo.admin.ch
// @run-at       document-end
// @noframes
// ==/UserScript==

"use strict";
(() => {
  // src/log.ts
  var PREFIX = "[CH Names]";
  var log = {
    info: (...args) => console.log(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args)
  };

  // src/geoadmin/client.ts
  var BASE_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/identify";
  var LAYER_ID = "ch.swisstopo.amtliches-strassenverzeichnis";
  var PAGE_SIZE = 200;
  var MAX_PAGES_PER_TILE = 15;
  var MAX_REQUESTS_PER_MINUTE = 30;
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  var RateLimiter = class {
    constructor(maxPerMinute = MAX_REQUESTS_PER_MINUTE) {
      this.maxPerMinute = maxPerMinute;
    }
    maxPerMinute;
    stamps = [];
    queue = Promise.resolve();
    acquire() {
      const next = this.queue.then(async () => {
        let now = Date.now();
        this.stamps = this.stamps.filter((t2) => now - t2 < 6e4);
        if (this.stamps.length >= this.maxPerMinute) {
          const oldest = this.stamps[0] ?? now;
          await sleep(Math.max(0, oldest + 6e4 - now));
          now = Date.now();
          this.stamps = this.stamps.filter((t2) => now - t2 < 6e4);
        }
        this.stamps.push(Date.now());
      });
      this.queue = next.catch(() => void 0);
      return next;
    }
  };
  var rateLimiter = new RateLimiter();
  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "json",
        onload: (r) => r.status >= 200 && r.status < 300 ? resolve(r.response) : reject(new Error(`geo.admin.ch HTTP ${r.status}`)),
        onerror: () => reject(new Error("GM_xmlhttpRequest network error")),
        ontimeout: () => reject(new Error("GM_xmlhttpRequest timeout"))
      });
    });
  }
  async function httpGetJson(url, signal) {
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) throw new Error(`geo.admin.ch HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (err instanceof TypeError && typeof GM_xmlhttpRequest === "function") {
        log.warn("fetch() failed, falling back to GM_xmlhttpRequest", err.message);
        return gmGetJson(url);
      }
      throw err;
    }
  }
  function parseAttributes(attrs) {
    if (!attrs) return null;
    const esid = Number(attrs["str_esid"]);
    const label = attrs["stn_label"];
    if (typeof label !== "string" || label.trim() === "" || !Number.isFinite(esid)) return null;
    const official = attrs["str_official"];
    return {
      esid,
      label: label.trim(),
      zipLabel: String(attrs["zip_label"] ?? ""),
      comName: String(attrs["com_name"] ?? ""),
      comFosnr: Number(attrs["com_fosnr"] ?? 0),
      official: official === 1 || official === true || official === "true",
      status: String(attrs["str_status"] ?? ""),
      type: String(attrs["str_type"] ?? "")
    };
  }
  async function fetchOfficialStreets(bbox, signal, limiter = rateLimiter) {
    const out = [];
    for (let page = 0; page < MAX_PAGES_PER_TILE; page++) {
      await limiter.acquire();
      if (signal?.aborted) throw new DOMException("Scan aborted", "AbortError");
      const params = new URLSearchParams({
        geometryType: "esriGeometryEnvelope",
        geometry: bbox.join(","),
        sr: "4326",
        layers: `all:${LAYER_ID}`,
        tolerance: "0",
        returnGeometry: "false",
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE)
      });
      const data = await httpGetJson(`${BASE_URL}?${params.toString()}`, signal);
      const results = data.results ?? [];
      for (const r of results) {
        const street = parseAttributes(r.attributes);
        if (street) out.push(street);
      }
      if (results.length < PAGE_SIZE) return out;
    }
    log.warn(`Page cap (${MAX_PAGES_PER_TILE}) reached for bbox ${bbox.join(",")}; results truncated`);
    return out;
  }

  // src/geoadmin/tiles.ts
  var TILE_SIZE_DEG = 0.02;
  var CACHE_MAX_TILES = 300;
  var CACHE_TTL_MS = 24 * 60 * 60 * 1e3;
  function tileKeysForBbox(bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const x0 = Math.floor(minLon / TILE_SIZE_DEG);
    const x1 = Math.floor(maxLon / TILE_SIZE_DEG);
    const y0 = Math.floor(minLat / TILE_SIZE_DEG);
    const y1 = Math.floor(maxLat / TILE_SIZE_DEG);
    const keys = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }
  function tileKeyForPoint(lon, lat) {
    return `${Math.floor(lon / TILE_SIZE_DEG)}:${Math.floor(lat / TILE_SIZE_DEG)}`;
  }
  function tileKeyToBbox(key) {
    const [xs, ys] = key.split(":");
    const x = Number(xs);
    const y = Number(ys);
    return [
      x * TILE_SIZE_DEG,
      y * TILE_SIZE_DEG,
      (x + 1) * TILE_SIZE_DEG,
      (y + 1) * TILE_SIZE_DEG
    ];
  }
  var TileCache = class {
    constructor(maxTiles = CACHE_MAX_TILES, ttlMs = CACHE_TTL_MS, now = Date.now) {
      this.maxTiles = maxTiles;
      this.ttlMs = ttlMs;
      this.now = now;
    }
    maxTiles;
    ttlMs;
    now;
    slots = /* @__PURE__ */ new Map();
    get(key) {
      const slot = this.slots.get(key);
      if (!slot) return null;
      if (this.now() - slot.fetchedAt > this.ttlMs) {
        this.slots.delete(key);
        return null;
      }
      this.slots.delete(key);
      this.slots.set(key, slot);
      return slot.entries;
    }
    set(key, entries) {
      this.slots.delete(key);
      this.slots.set(key, { entries, fetchedAt: this.now() });
      while (this.slots.size > this.maxTiles) {
        const oldest = this.slots.keys().next().value;
        if (oldest === void 0) break;
        this.slots.delete(oldest);
      }
    }
    clear() {
      this.slots.clear();
    }
  };
  var TileFetcher = class {
    constructor(cache = new TileCache(), fetchTile = fetchOfficialStreets) {
      this.cache = cache;
      this.fetchTile = fetchTile;
    }
    cache;
    fetchTile;
    /**
     * Resolve all official streets covering the bbox, tile by tile (cache first),
     * deduplicated by federal street id.
     */
    async fetchBbox(bbox, signal, onProgress) {
      const keys = tileKeysForBbox(bbox);
      let done = 0;
      onProgress?.(0, keys.length);
      const perTile = await Promise.all(
        keys.map(async (key) => {
          const cached = this.cache.get(key);
          const entries = cached ?? await this.fetchTile(tileKeyToBbox(key), signal);
          if (!cached) this.cache.set(key, entries);
          done++;
          onProgress?.(done, keys.length);
          return entries;
        })
      );
      const byEsid = /* @__PURE__ */ new Map();
      for (const entries of perTile) {
        for (const e of entries) byEsid.set(e.esid, e);
      }
      return [...byEsid.values()];
    }
  };

  // src/i18n.ts
  var en = {
    stateIdle: "Idle",
    stateZoomGated: "Zoom in to scan",
    stateAreaGated: "View too large to scan",
    stateFetching: "Fetching official register…",
    stateEvaluating: "Comparing names…",
    statePaused: "Paused (layer unchecked)",
    stateError: "Scan failed",
    stateDone: "{issues} issue(s) · {ok} OK · {streets} official streets",
    unsavedBadge: "{n} unsaved",
    rescan: "Rescan",
    rescanTitle: "Clear the cache and fetch the official register again",
    nextIssue: "Next issue",
    nextIssueTitle: "Select the next mismatching segment",
    locateTitle: "Center the map on the segment",
    filterChipTitle: "Filter the list by this status",
    unnamed: "(unnamed)",
    noteUnofficial: "unofficial",
    notePlanned: "planned",
    noteFullLabel: "full label: {label}",
    noteExistsIn: "exists in: {place}",
    fixAll: "Fix all ({n})",
    fix: "Fix",
    fixTitle: 'Apply "{name}"',
    confirmGroupFix: 'Apply "{name}" to {n} segments?\nNothing is saved automatically; review and save in WME.',
    fixFailed: "Fix failed: {error}",
    fixStopped: "Fixed {done}/{total}, then stopped: {error} (segment {id})",
    allMatch: "All street names match ✓",
    legendTitle: "Legend",
    legendCOSMETIC: "typography only (case, apostrophe, spacing) — dashed line",
    legendVARIANT: "abbreviation, missing accent or article; official spelling suggested",
    legendNEAR: "probable typo; one close official name found",
    legendWRONG_TYPE: "different way type (Chemin ↔ Route); unique official name suggested",
    legendWRONG_CITY: "name exists, but in another locality (city scoping)",
    legendNOT_FOUND: "not found in the official register",
    legendUNNAMED: "checked road type without a street name — dashed line",
    legendMICRO_SEGMENT: "drivable segment shorter than 5 m (Swiss guideline; roundabouts excluded)",
    legendLOOP: "loop made of fewer than 3 segments (same endpoints); split it",
    legendNARROW_MISUSE: "Narrow Street misuse: one-way or shorter than 50 m",
    guidelineChecks: "Swiss guideline checks (micro-segments, loops, narrow streets)",
    guidelineChecksTitle: "Checks from the Suisse romande editing guidelines that need no external data",
    settingsTitle: "Settings",
    roadTypesLabel: "Checked road types:",
    altOk: "Alternate name match counts as OK",
    altOkTitle: "Useful in bilingual communes where the second language is an alternate name",
    showCosmetic: "Show cosmetic differences",
    showMapLabels: "Show expected name on the map (zoom ≥ 17)",
    keepOldName: "Keep old name as alternate when fixing",
    keepOldNameTitle: "Never applied to typo (NEAR) fixes",
    scopingLabel: "City scoping:",
    scopingTitle: "Compare the segment's city with the official locality (zip_label)",
    scopingOff: "off",
    scopingWarn: "warn",
    scopingStrict: "strict",
    minZoomLabel: "Min zoom to scan:",
    languageLabel: "Language:",
    languageAuto: "Auto (WME)",
    errNotFixable: "Not fixable",
    errEditingNotAllowed: "Editing is not allowed here",
    errSegmentUnloaded: "Segment no longer loaded",
    errNoCity: "Segment has no city; set the city first",
    errStreetCreate: "Could not find or create the street record"
  };
  var fr = {
    stateIdle: "En attente",
    stateZoomGated: "Zoomez pour scanner",
    stateAreaGated: "Vue trop large pour scanner",
    stateFetching: "Lecture du répertoire officiel…",
    stateEvaluating: "Comparaison des noms…",
    statePaused: "En pause (couche décochée)",
    stateError: "Échec du scan",
    stateDone: "{issues} écart(s) · {ok} OK · {streets} rues officielles",
    unsavedBadge: "{n} non sauvegardé(s)",
    rescan: "Rescanner",
    rescanTitle: "Vider le cache et relire le répertoire officiel",
    nextIssue: "Écart suivant",
    nextIssueTitle: "Sélectionner le segment en écart suivant",
    locateTitle: "Centrer la carte sur le segment",
    filterChipTitle: "Filtrer la liste sur ce statut",
    unnamed: "(sans nom)",
    noteUnofficial: "non officiel",
    notePlanned: "planifié",
    noteFullLabel: "libellé complet: {label}",
    noteExistsIn: "existe à: {place}",
    fixAll: "Tout corriger ({n})",
    fix: "Corriger",
    fixTitle: "Appliquer «{name}»",
    confirmGroupFix: "Appliquer «{name}» à {n} segments ?\nRien n'est sauvegardé automatiquement; relisez et sauvez dans WME.",
    fixFailed: "Échec de la correction: {error}",
    fixStopped: "{done}/{total} corrigés, puis arrêt: {error} (segment {id})",
    allMatch: "Tous les noms de rues correspondent ✓",
    legendTitle: "Légende",
    legendCOSMETIC: "typographie uniquement (casse, apostrophe, espaces) — trait pointillé",
    legendVARIANT: "abréviation, accent ou article manquant; orthographe officielle proposée",
    legendNEAR: "faute de frappe probable; un seul nom officiel proche",
    legendWRONG_TYPE: "type de voie différent (Chemin ↔ Route); nom officiel unique proposé",
    legendWRONG_CITY: "le nom existe, mais dans une autre localité (scoping)",
    legendNOT_FOUND: "introuvable dans le répertoire officiel",
    legendUNNAMED: "type de route vérifié sans nom — trait pointillé",
    legendMICRO_SEGMENT: "segment carrossable de moins de 5 m (règle suisse; ronds-points exclus)",
    legendLOOP: "boucle de moins de 3 segments (nœuds identiques); à diviser",
    legendNARROW_MISUSE: "Rue étroite mal utilisée: sens unique ou moins de 50 m",
    guidelineChecks: "Contrôles des règles suisses (micro-segments, boucles, rues étroites)",
    guidelineChecksTitle: "Contrôles issus des règles d'édition de Suisse romande, sans donnée externe",
    settingsTitle: "Réglages",
    roadTypesLabel: "Types de routes vérifiés:",
    altOk: "Nom alternatif correspondant = OK",
    altOkTitle: "Utile dans les communes bilingues où la seconde langue est en nom alternatif",
    showCosmetic: "Afficher les différences cosmétiques",
    showMapLabels: "Afficher le nom attendu sur la carte (zoom ≥ 17)",
    keepOldName: "Conserver l'ancien nom en alternatif lors de la correction",
    keepOldNameTitle: "Jamais appliqué aux corrections de fautes de frappe (NEAR)",
    scopingLabel: "Scoping par localité:",
    scopingTitle: "Compare la ville du segment à la localité officielle (zip_label)",
    scopingOff: "désactivé",
    scopingWarn: "avertir",
    scopingStrict: "strict",
    minZoomLabel: "Zoom minimal pour scanner:",
    languageLabel: "Langue:",
    languageAuto: "Auto (WME)",
    errNotFixable: "Non corrigeable",
    errEditingNotAllowed: "Édition non autorisée ici",
    errSegmentUnloaded: "Segment plus chargé",
    errNoCity: "Segment sans ville; définissez d'abord la ville",
    errStreetCreate: "Impossible de trouver ou de créer la rue"
  };
  var de = {
    stateIdle: "Bereit",
    stateZoomGated: "Zum Scannen hineinzoomen",
    stateAreaGated: "Ausschnitt zu gross zum Scannen",
    stateFetching: "Amtliches Verzeichnis wird geladen…",
    stateEvaluating: "Namen werden verglichen…",
    statePaused: "Pausiert (Ebene deaktiviert)",
    stateError: "Scan fehlgeschlagen",
    stateDone: "{issues} Abweichung(en) · {ok} OK · {streets} amtliche Strassen",
    unsavedBadge: "{n} ungespeichert",
    rescan: "Neu scannen",
    rescanTitle: "Cache leeren und amtliches Verzeichnis neu laden",
    nextIssue: "Nächste Abweichung",
    nextIssueTitle: "Nächstes abweichendes Segment auswählen",
    locateTitle: "Karte auf das Segment zentrieren",
    filterChipTitle: "Liste nach diesem Status filtern",
    unnamed: "(unbenannt)",
    noteUnofficial: "inoffiziell",
    notePlanned: "geplant",
    noteFullLabel: "vollständige Bezeichnung: {label}",
    noteExistsIn: "existiert in: {place}",
    fixAll: "Alle korrigieren ({n})",
    fix: "Korrigieren",
    fixTitle: "«{name}» übernehmen",
    confirmGroupFix: "«{name}» auf {n} Segmente anwenden?\nNichts wird automatisch gespeichert; in WME prüfen und speichern.",
    fixFailed: "Korrektur fehlgeschlagen: {error}",
    fixStopped: "{done}/{total} korrigiert, dann gestoppt: {error} (Segment {id})",
    allMatch: "Alle Strassennamen stimmen überein ✓",
    legendTitle: "Legende",
    legendCOSMETIC: "nur Typografie (Gross-/Kleinschreibung, Apostroph, Leerzeichen) — gestrichelt",
    legendVARIANT: "Abkürzung, fehlender Akzent oder Artikel; amtliche Schreibweise vorgeschlagen",
    legendNEAR: "wahrscheinlicher Tippfehler; ein einziger naher amtlicher Name",
    legendWRONG_TYPE: "anderer Strassentyp (Weg ↔ Strasse); eindeutiger amtlicher Name vorgeschlagen",
    legendWRONG_CITY: "Name existiert, aber in einer anderen Ortschaft (Scoping)",
    legendNOT_FOUND: "nicht im amtlichen Verzeichnis",
    legendUNNAMED: "geprüfter Strassentyp ohne Namen — gestrichelt",
    legendMICRO_SEGMENT: "befahrbares Segment kürzer als 5 m (Schweizer Regel; Kreisel ausgenommen)",
    legendLOOP: "Schleife aus weniger als 3 Segmenten (gleiche Endknoten); aufteilen",
    legendNARROW_MISUSE: "Falsch verwendete enge Strasse: Einbahn oder kürzer als 50 m",
    guidelineChecks: "Schweizer Regelprüfungen (Mikrosegmente, Schleifen, enge Strassen)",
    guidelineChecksTitle: "Prüfungen aus den Editier-Richtlinien der Romandie, ohne externe Daten",
    settingsTitle: "Einstellungen",
    roadTypesLabel: "Geprüfte Strassentypen:",
    altOk: "Alternativname zählt als OK",
    altOkTitle: "Nützlich in zweisprachigen Gemeinden mit der zweiten Sprache als Alternativname",
    showCosmetic: "Kosmetische Unterschiede anzeigen",
    showMapLabels: "Erwarteten Namen auf der Karte anzeigen (Zoom ≥ 17)",
    keepOldName: "Alten Namen bei Korrektur als Alternative behalten",
    keepOldNameTitle: "Nie bei Tippfehler-Korrekturen (NEAR)",
    scopingLabel: "Ortschafts-Scoping:",
    scopingTitle: "Vergleicht die Stadt des Segments mit der amtlichen Ortschaft (zip_label)",
    scopingOff: "aus",
    scopingWarn: "warnen",
    scopingStrict: "strikt",
    minZoomLabel: "Minimaler Zoom zum Scannen:",
    languageLabel: "Sprache:",
    languageAuto: "Auto (WME)",
    errNotFixable: "Nicht korrigierbar",
    errEditingNotAllowed: "Bearbeiten ist hier nicht erlaubt",
    errSegmentUnloaded: "Segment nicht mehr geladen",
    errNoCity: "Segment ohne Stadt; zuerst die Stadt setzen",
    errStreetCreate: "Strasse konnte nicht gefunden oder erstellt werden"
  };
  var it = {
    stateIdle: "In attesa",
    stateZoomGated: "Ingrandisci per scansionare",
    stateAreaGated: "Vista troppo ampia per la scansione",
    stateFetching: "Lettura del repertorio ufficiale…",
    stateEvaluating: "Confronto dei nomi…",
    statePaused: "In pausa (livello disattivato)",
    stateError: "Scansione fallita",
    stateDone: "{issues} differenze · {ok} OK · {streets} strade ufficiali",
    unsavedBadge: "{n} non salvati",
    rescan: "Riscansiona",
    rescanTitle: "Svuota la cache e rilegge il repertorio ufficiale",
    nextIssue: "Prossima differenza",
    nextIssueTitle: "Seleziona il prossimo segmento con differenza",
    locateTitle: "Centra la mappa sul segmento",
    filterChipTitle: "Filtra l'elenco per questo stato",
    unnamed: "(senza nome)",
    noteUnofficial: "non ufficiale",
    notePlanned: "pianificata",
    noteFullLabel: "denominazione completa: {label}",
    noteExistsIn: "esiste a: {place}",
    fixAll: "Correggi tutti ({n})",
    fix: "Correggi",
    fixTitle: "Applica «{name}»",
    confirmGroupFix: "Applicare «{name}» a {n} segmenti?\nNulla viene salvato automaticamente; rivedi e salva in WME.",
    fixFailed: "Correzione fallita: {error}",
    fixStopped: "{done}/{total} corretti, poi interrotto: {error} (segmento {id})",
    allMatch: "Tutti i nomi delle strade corrispondono ✓",
    legendTitle: "Legenda",
    legendCOSMETIC: "solo tipografia (maiuscole, apostrofo, spazi) — linea tratteggiata",
    legendVARIANT: "abbreviazione, accento o articolo mancante; proposta la grafia ufficiale",
    legendNEAR: "probabile errore di battitura; un solo nome ufficiale vicino",
    legendWRONG_TYPE: "tipo di via diverso (Chemin ↔ Route); proposto il nome ufficiale unico",
    legendWRONG_CITY: "il nome esiste, ma in un'altra località (scoping)",
    legendNOT_FOUND: "non presente nel repertorio ufficiale",
    legendUNNAMED: "tipo di strada verificato senza nome — linea tratteggiata",
    legendMICRO_SEGMENT: "segmento percorribile più corto di 5 m (regola svizzera; rotatorie escluse)",
    legendLOOP: "anello con meno di 3 segmenti (stessi nodi); da dividere",
    legendNARROW_MISUSE: "Strada stretta usata male: senso unico o meno di 50 m",
    guidelineChecks: "Controlli delle regole svizzere (micro-segmenti, anelli, strade strette)",
    guidelineChecksTitle: "Controlli dalle regole di editing della Svizzera romanda, senza dati esterni",
    settingsTitle: "Impostazioni",
    roadTypesLabel: "Tipi di strada verificati:",
    altOk: "Nome alternativo corrispondente = OK",
    altOkTitle: "Utile nei comuni bilingui con la seconda lingua come nome alternativo",
    showCosmetic: "Mostra differenze cosmetiche",
    showMapLabels: "Mostra il nome atteso sulla mappa (zoom ≥ 17)",
    keepOldName: "Mantieni il vecchio nome come alternativo alla correzione",
    keepOldNameTitle: "Mai applicato alle correzioni di errori di battitura (NEAR)",
    scopingLabel: "Scoping per località:",
    scopingTitle: "Confronta la città del segmento con la località ufficiale (zip_label)",
    scopingOff: "disattivato",
    scopingWarn: "avvisa",
    scopingStrict: "rigoroso",
    minZoomLabel: "Zoom minimo per la scansione:",
    languageLabel: "Lingua:",
    languageAuto: "Auto (WME)",
    errNotFixable: "Non correggibile",
    errEditingNotAllowed: "La modifica non è consentita qui",
    errSegmentUnloaded: "Segmento non più caricato",
    errNoCity: "Segmento senza città; imposta prima la città",
    errStreetCreate: "Impossibile trovare o creare la strada"
  };
  var LOCALES = { en, fr, de, it };
  var LANGUAGE_CHOICES = [
    { value: "auto", label: "Auto (WME)" },
    { value: "en", label: "English" },
    { value: "fr", label: "Français" },
    { value: "de", label: "Deutsch" },
    { value: "it", label: "Italiano" }
  ];
  var current = "en";
  function setLocale(code) {
    current = code;
  }
  function resolveLocale(preference, wmeLocaleCode) {
    if (preference !== "auto") return preference;
    const prefix = wmeLocaleCode.toLowerCase().slice(0, 2);
    return prefix === "fr" || prefix === "de" || prefix === "it" ? prefix : "en";
  }
  function t(key, params) {
    let s = LOCALES[current][key] ?? en[key];
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        s = s.replaceAll(`{${name}}`, String(value));
      }
    }
    return s;
  }

  // src/map-layer.ts
  var LAYER_NAME = "CH Street Check";
  var LABEL_MIN_ZOOM = 17;
  var STATUS_STYLES = {
    COSMETIC: { strokeColor: "#f7c948", strokeDashstyle: "dash" },
    VARIANT: { strokeColor: "#f7c948", strokeDashstyle: "solid" },
    NEAR: { strokeColor: "#ff8c00", strokeDashstyle: "solid" },
    WRONG_TYPE: { strokeColor: "#ff5722", strokeDashstyle: "dash" },
    WRONG_CITY: { strokeColor: "#ff5ca8", strokeDashstyle: "solid" },
    NOT_FOUND: { strokeColor: "#e02020", strokeDashstyle: "solid" },
    UNNAMED: { strokeColor: "#9b59b6", strokeDashstyle: "dash" },
    MICRO_SEGMENT: { strokeColor: "#00bcd4", strokeDashstyle: "solid" },
    LOOP: { strokeColor: "#795548", strokeDashstyle: "solid" },
    NARROW_MISUSE: { strokeColor: "#3f51b5", strokeDashstyle: "dash" }
  };
  var HighlightLayer = class {
    constructor(sdk2, settings) {
      this.sdk = sdk2;
      this.settings = settings;
    }
    sdk;
    settings;
    init() {
      this.sdk.Map.addLayer({
        layerName: LAYER_NAME,
        styleContext: {
          getLabel: ({ feature, zoomLevel }) => {
            if (!this.settings.get().showMapLabels || zoomLevel < LABEL_MIN_ZOOM) return "";
            const suggestion = feature?.properties.suggestion;
            return typeof suggestion === "string" && suggestion !== "" ? `→ ${suggestion}` : "";
          }
        },
        styleRules: Object.keys(STATUS_STYLES).map((status) => ({
          predicate: (properties) => properties.status === status,
          style: {
            strokeColor: STATUS_STYLES[status].strokeColor,
            strokeDashstyle: STATUS_STYLES[status].strokeDashstyle,
            strokeWidth: 6,
            strokeOpacity: 0.75,
            strokeLinecap: "round",
            pointerEvents: "none",
            label: "${getLabel}",
            fontColor: "#222222",
            fontSize: "12px",
            fontWeight: "bold",
            labelOutlineColor: "#ffffff",
            labelOutlineWidth: 3
          }
        }))
      });
    }
    sync(issues, showCosmetic) {
      this.sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_NAME });
      const features = [...issues.values()].filter((issue) => showCosmetic || issue.status !== "COSMETIC").map((issue) => ({
        type: "Feature",
        id: `chk-${issue.segmentId}`,
        geometry: issue.geometry,
        properties: {
          status: issue.status,
          suggestion: issue.suggestion,
          currentName: issue.currentName
        }
      }));
      if (features.length > 0) {
        this.sdk.Map.addFeaturesToLayer({ layerName: LAYER_NAME, features });
      }
    }
    setVisible(visible) {
      this.sdk.Map.setLayerVisibility({ layerName: LAYER_NAME, visibility: visible });
    }
  };
  function registerLayerCheckbox(sdk2, onToggle) {
    sdk2.LayerSwitcher.addLayerCheckbox({ name: LAYER_NAME, isChecked: true });
    sdk2.Events.on({
      eventName: "wme-layer-checkbox-toggled",
      eventHandler: (payload) => {
        if (payload.name === LAYER_NAME) onToggle(payload.checked);
      }
    });
  }

  // src/guidelines.ts
  var MIN_SEGMENT_LENGTH_M = 5;
  var MIN_NARROW_STREET_LENGTH_M = 50;
  var NARROW_STREET_TYPE = 22;
  var DRIVABLE_TYPES = /* @__PURE__ */ new Set([1, 2, 3, 4, 6, 7, 8, 17, 20, 22]);
  function makeIssue(segment, status, getAddress) {
    const address = getAddress(segment.id);
    return {
      segmentId: segment.id,
      status,
      currentName: address?.street?.name?.trim() || null,
      suggestion: null,
      note: null,
      cityId: address?.city?.id ?? null,
      cityName: address?.city?.name ?? null,
      roadType: segment.roadType,
      length: segment.length,
      geometry: segment.geometry,
      fixable: false
    };
  }
  function isOneWay(segment) {
    return segment.isAtoB !== segment.isBtoA;
  }
  function evaluateGuidelines(segments, getAddress) {
    const issues = /* @__PURE__ */ new Map();
    const byNodePair = /* @__PURE__ */ new Map();
    for (const segment of segments) {
      if (!DRIVABLE_TYPES.has(segment.roadType)) continue;
      const isRoundabout = segment.junctionId !== null;
      if (!isRoundabout && segment.length < MIN_SEGMENT_LENGTH_M) {
        issues.set(segment.id, makeIssue(segment, "MICRO_SEGMENT", getAddress));
      }
      if (segment.roadType === NARROW_STREET_TYPE && (isOneWay(segment) || segment.length < MIN_NARROW_STREET_LENGTH_M)) {
        if (!issues.has(segment.id)) {
          issues.set(segment.id, makeIssue(segment, "NARROW_MISUSE", getAddress));
        }
      }
      if (isRoundabout || segment.fromNodeId === null || segment.toNodeId === null) continue;
      if (segment.fromNodeId === segment.toNodeId) {
        issues.set(segment.id, makeIssue(segment, "LOOP", getAddress));
        continue;
      }
      const a = Math.min(segment.fromNodeId, segment.toNodeId);
      const b = Math.max(segment.fromNodeId, segment.toNodeId);
      const key = `${a}:${b}`;
      const list = byNodePair.get(key);
      if (list) list.push(segment);
      else byNodePair.set(key, [segment]);
    }
    for (const pair of byNodePair.values()) {
      if (pair.length < 2) continue;
      for (const segment of pair) {
        issues.set(segment.id, makeIssue(segment, "LOOP", getAddress));
      }
    }
    return [...issues.values()];
  }

  // src/matching/normalize.ts
  function k0(name) {
    return name.normalize("NFC").trim();
  }
  var APOSTROPHES = /[’ʼ´`]/g;
  var DASHES = /[–—−]/g;
  function k1(name) {
    let s = k0(name);
    s = s.replace(APOSTROPHES, "'");
    s = s.replace(DASHES, "-");
    s = s.replace(/\s+/g, " ");
    s = s.replace(/\s*-\s*/g, "-");
    s = s.toLowerCase();
    s = s.replace(/ß/g, "ss");
    return s.trim();
  }
  function foldAccents(s) {
    return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
  }
  var ABBREVIATIONS = [
    { abbrev: "av", expansions: ["avenue"], firstTokenOnly: true },
    { abbrev: "bd", expansions: ["boulevard"] },
    { abbrev: "bvd", expansions: ["boulevard"] },
    { abbrev: "boul", expansions: ["boulevard"] },
    { abbrev: "ch", expansions: ["chemin"], firstTokenOnly: true },
    { abbrev: "rte", expansions: ["route"] },
    { abbrev: "pl", expansions: ["place", "platz", "piazza"] },
    { abbrev: "imp", expansions: ["impasse"] },
    { abbrev: "prom", expansions: ["promenade"] },
    { abbrev: "pass", expansions: ["passage"] },
    { abbrev: "fbg", expansions: ["faubourg"] },
    { abbrev: "fg", expansions: ["faubourg"] },
    { abbrev: "st", expansions: ["saint", "sankt"] },
    { abbrev: "ste", expansions: ["sainte"] },
    { abbrev: "str", expansions: ["strasse"] }
  ];
  var ABBREV_MAP = new Map(ABBREVIATIONS.map((r) => [r.abbrev, r]));
  var MAX_VARIANTS = 8;
  var ARTICLES = /* @__PURE__ */ new Set([
    "de",
    "du",
    "des",
    "la",
    "le",
    "les",
    "di",
    "da",
    "del",
    "della",
    "delle",
    "dei",
    "degli",
    "al",
    "alla",
    "ai"
  ]);
  var WAY_TYPE_WORDS = /* @__PURE__ */ new Set([
    // fr
    "rue",
    "route",
    "chemin",
    "avenue",
    "boulevard",
    "impasse",
    "sentier",
    "passage",
    "place",
    "promenade",
    "quai",
    "ruelle",
    "allee",
    "faubourg",
    "esplanade",
    "montee",
    "clos",
    "square",
    // it
    "via",
    "viale",
    "vicolo",
    "piazza",
    "piazzetta",
    "strada",
    "sentiero",
    "corso",
    "salita",
    "riva"
  ]);
  var GERMAN_SUFFIXES = /^(.{4,}?)(strasse|weg|gasse|platz)$/;
  function stemKey(key) {
    const tokens = key.split(" ");
    let rest = null;
    const first = tokens[0];
    if (tokens.length >= 2 && first !== void 0 && WAY_TYPE_WORDS.has(first)) {
      rest = tokens.slice(1);
    } else if (tokens.length === 1 && first !== void 0) {
      const m = first.match(GERMAN_SUFFIXES);
      if (m && m[1] !== void 0) rest = [m[1]];
    }
    if (!rest || rest.length === 0) return null;
    const cleaned = rest.filter((t2) => !ARTICLES.has(t2)).map((t2) => t2.replace(/^[ld]'/, ""));
    const stem = (cleaned.length > 0 ? cleaned : rest).join(" ");
    return stem.length >= 3 ? stem : null;
  }
  function stripArticles(key) {
    const tokens = key.split(" ").filter((token) => !ARTICLES.has(token)).map((token) => token.replace(/^[ld]'/, ""));
    if (tokens.length < 2) return null;
    const stripped = tokens.join(" ");
    return stripped === key ? null : stripped;
  }
  function k2(name) {
    let s = k1(name);
    s = foldAccents(s);
    s = s.replace(/(\p{L}{2,})str\.?(?=$|\s|-)/gu, "$1strasse");
    s = s.replace(/-/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    const tokens = s.split(" ").filter((t2) => t2.length > 0);
    let variants = [[]];
    tokens.forEach((token, i) => {
      const bare = token.replace(/\./g, "");
      const rule = ABBREV_MAP.get(bare);
      const options = rule && (!rule.firstTokenOnly || i === 0) ? rule.expansions : [bare];
      variants = variants.flatMap((v) => options.map((option) => [...v, option])).slice(0, MAX_VARIANTS);
    });
    const keys = [...new Set(variants.map((v) => v.join(" ")))];
    for (const key of [...keys]) {
      const stripped = stripArticles(key);
      if (stripped && !keys.includes(stripped)) keys.push(stripped);
    }
    return keys;
  }

  // src/matching/evaluate.ts
  function noteFor(entry) {
    const note = {};
    if (!entry.street.official) note.unofficial = true;
    const status = entry.street.status.toLowerCase();
    if (status !== "" && status !== "bestehend" && status !== "real" && status !== "existing") {
      note.planned = true;
    }
    if (entry.isSlashPart) note.fullLabel = entry.street.label;
    return Object.keys(note).length > 0 ? note : null;
  }
  function evaluateSegment(segment, address, index, settings) {
    if (!settings.checkedRoadTypes.includes(segment.roadType)) return { kind: "skipped" };
    const currentName = address.street?.name?.trim() || null;
    const baseIssue = {
      segmentId: segment.id,
      currentName,
      cityId: address.city?.id ?? null,
      cityName: address.city?.name ?? null,
      roadType: segment.roadType,
      length: segment.length,
      geometry: segment.geometry
    };
    if (!currentName) {
      if (segment.junctionId !== null) return { kind: "skipped" };
      return {
        kind: "issue",
        issue: {
          ...baseIssue,
          status: "UNNAMED",
          suggestion: null,
          note: null,
          fixable: false
        }
      };
    }
    const locality = settings.cityScoping !== "off" && address.city?.name ? k1(address.city.name) : void 0;
    const match = index.lookup(currentName, locality);
    if (match) {
      if (match.level === "exact") {
        if (locality && !match.inLocality) {
          return {
            kind: "issue",
            issue: {
              ...baseIssue,
              status: "WRONG_CITY",
              suggestion: null,
              note: { existsIn: match.entry.street.zipLabel },
              fixable: false
            }
          };
        }
        return { kind: "ok" };
      }
      const statusByLevel = {
        cosmetic: "COSMETIC",
        variant: "VARIANT",
        near: "NEAR",
        stem: "WRONG_TYPE"
      };
      return {
        kind: "issue",
        issue: {
          ...baseIssue,
          status: statusByLevel[match.level],
          suggestion: match.entry.namePart,
          note: noteFor(match.entry),
          fixable: true
        }
      };
    }
    if (settings.altNameCountsAsOk) {
      for (const alt of address.altStreets) {
        const altName = alt.street?.name?.trim();
        if (!altName) continue;
        const altMatch = index.lookup(altName, locality);
        if (altMatch && (altMatch.level === "exact" || altMatch.level === "cosmetic")) {
          return { kind: "okAlt" };
        }
      }
    }
    return {
      kind: "issue",
      issue: {
        ...baseIssue,
        status: "NOT_FOUND",
        suggestion: null,
        note: null,
        fixable: false
      }
    };
  }

  // src/matching/distance.ts
  function damerauLevenshtein(a, b, maxDist) {
    if (a === b) return 0;
    const la = a.length;
    const lb = b.length;
    if (Math.abs(la - lb) > maxDist) return maxDist + 1;
    if (la === 0) return lb;
    if (lb === 0) return la;
    let prevPrev = new Array(lb + 1).fill(0);
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1).fill(0);
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      curr[0] = i;
      let rowMin = curr[0];
      for (let j = 1; j <= lb; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let v = Math.min(
          prev[j] + 1,
          // deletion
          curr[j - 1] + 1,
          // insertion
          prev[j - 1] + cost
          // substitution
        );
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          v = Math.min(v, prevPrev[j - 2] + 1);
        }
        curr[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > maxDist) return maxDist + 1;
      [prevPrev, prev, curr] = [prev, curr, prevPrev];
    }
    const result = prev[lb];
    return result > maxDist ? maxDist + 1 : result;
  }

  // src/matching/official-index.ts
  function localityFromZipLabel(zipLabel) {
    return k1(zipLabel.replace(/^\d{4}\s*/, ""));
  }
  function isExistingStatus(status) {
    const s = status.toLowerCase();
    return s === "bestehend" || s === "real" || s === "existing";
  }
  function rankScore(entry, locality) {
    let score = 0;
    if (entry.street.official) score += 8;
    if (isExistingStatus(entry.street.status)) score += 4;
    const t2 = entry.street.type.toLowerCase();
    if (t2 !== "benanntes gebiet" && t2 !== "area") score += 2;
    if (locality && entry.locality === locality) score += 1;
    return score;
  }
  function pushTo(map, key, entry) {
    const list = map.get(key);
    if (list) list.push(entry);
    else map.set(key, [entry]);
  }
  var FUZZY_LENGTH_SLACK = 2;
  var OfficialIndex = class {
    byK0 = /* @__PURE__ */ new Map();
    byK1 = /* @__PURE__ */ new Map();
    byK2 = /* @__PURE__ */ new Map();
    /** Buckets by first character of the folded K2 key, for bounded fuzzy search. */
    fuzzyBuckets = /* @__PURE__ */ new Map();
    /** Stem (name minus way-type word and articles) -> entries, for WRONG_TYPE detection. */
    byStem = /* @__PURE__ */ new Map();
    entryCount;
    streetCount;
    constructor(streets) {
      let entries = 0;
      for (const street of streets) {
        const locality = localityFromZipLabel(street.zipLabel);
        const parts = street.label.includes("/") ? [street.label, ...street.label.split("/").map((p) => p.trim()).filter(Boolean)] : [street.label];
        parts.forEach((namePart, i) => {
          const entry = {
            street,
            namePart,
            isSlashPart: i > 0,
            locality
          };
          entries++;
          pushTo(this.byK0, k0(namePart), entry);
          pushTo(this.byK1, k1(namePart), entry);
          const k2Keys = k2(namePart);
          for (const key of k2Keys) pushTo(this.byK2, key, entry);
          const primary = k2Keys[0];
          if (primary && primary.length > 0) {
            const bucketKey = primary[0];
            const bucket = this.fuzzyBuckets.get(bucketKey);
            const candidate = { entry, key: primary };
            if (bucket) bucket.push(candidate);
            else this.fuzzyBuckets.set(bucketKey, [candidate]);
            const stem = stemKey(primary);
            if (stem) pushTo(this.byStem, stem, entry);
          }
        });
      }
      this.entryCount = entries;
      this.streetCount = streets.length;
    }
    /**
     * Cascade lookup: K0 exact -> K1 cosmetic -> K2 variant -> bounded fuzzy.
     * `locality` (K1-normalized) only affects ranking and the inLocality flag.
     */
    lookup(name, locality) {
      const exact = this.byK0.get(k0(name));
      if (exact) return this.result("exact", exact, locality);
      const cosmetic = this.byK1.get(k1(name));
      if (cosmetic) return this.result("cosmetic", cosmetic, locality);
      for (const key of k2(name)) {
        const variant = this.byK2.get(key);
        if (variant) return this.result("variant", variant, locality);
      }
      return this.fuzzyLookup(name, locality) ?? this.stemLookup(name, locality);
    }
    /**
     * Way-type mismatch: same stem, different type word ("Chemin de la Guérite"
     * vs official "Route de la Guérite"). Only suggests when every candidate
     * carries the SAME official name — two officials sharing a stem (e.g.
     * "Rue du Moulin" and "Route du Moulin") stay ambiguous and unmatched.
     */
    stemLookup(name, locality) {
      const primary = k2(name)[0];
      if (!primary) return null;
      const stem = stemKey(primary);
      if (!stem) return null;
      const candidates = this.byStem.get(stem);
      if (!candidates) return null;
      const distinctNames = new Set(candidates.map((c) => k1(c.namePart)));
      if (distinctNames.size !== 1) return null;
      return this.result("stem", candidates, locality);
    }
    fuzzyLookup(name, locality) {
      const queryKey = k2(name)[0];
      if (!queryKey || queryKey.length < 3) return null;
      const maxDist = queryKey.length < 8 ? 1 : 2;
      const bucket = this.fuzzyBuckets.get(foldAccents(queryKey[0])) ?? [];
      let best = maxDist + 1;
      const matchesByKey = /* @__PURE__ */ new Map();
      for (const { entry, key } of bucket) {
        if (Math.abs(key.length - queryKey.length) > FUZZY_LENGTH_SLACK) continue;
        const d = damerauLevenshtein(queryKey, key, maxDist);
        if (d > maxDist || d === 0) continue;
        if (d < best) {
          best = d;
          matchesByKey.clear();
        }
        if (d === best) pushTo(matchesByKey, key, entry);
      }
      if (best > maxDist) return null;
      if (matchesByKey.size !== 1) return null;
      const candidates = [...matchesByKey.values()][0];
      const result = this.result("near", candidates, locality);
      result.distance = best;
      return result;
    }
    result(level, candidates, locality) {
      const sorted = [...candidates].sort((a, b) => rankScore(b, locality) - rankScore(a, locality));
      return {
        level,
        entry: sorted[0],
        candidates: sorted,
        inLocality: locality ? sorted.some((c) => c.locality === locality) : true
      };
    }
  };

  // src/scan.ts
  var DEBOUNCE_MS = 800;
  var BBOX_PADDING_RATIO = 0.2;
  var MAX_AREA_KM2 = 6;
  function padBbox(bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const padLon = (maxLon - minLon) * BBOX_PADDING_RATIO;
    const padLat = (maxLat - minLat) * BBOX_PADDING_RATIO;
    return [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat];
  }
  function bboxAreaKm2(bbox) {
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const midLat = (minLat + maxLat) / 2;
    const widthKm = (maxLon - minLon) * 111.32 * Math.cos(midLat * Math.PI / 180);
    const heightKm = (maxLat - minLat) * 110.57;
    return widthKm * heightKm;
  }
  var Scanner = class {
    constructor(sdk2, fetcher, settings) {
      this.sdk = sdk2;
      this.fetcher = fetcher;
      this.settings = settings;
    }
    sdk;
    fetcher;
    settings;
    generation = 0;
    controller = null;
    debounceTimer;
    lastIndex = null;
    /** Tile keys covered by lastIndex; segments outside are not name-checked. */
    coveredTiles = null;
    listeners = [];
    snapshot = {
      state: "idle",
      issues: /* @__PURE__ */ new Map(),
      stats: { ok: 0, okAlt: 0, skipped: 0, total: 0 },
      officialStreetCount: 0,
      progress: null,
      error: null,
      unsavedCount: 0
    };
    paused = false;
    start() {
      const onMove = () => this.requestScan();
      this.sdk.Events.on({ eventName: "wme-map-move-end", eventHandler: onMove });
      this.sdk.Events.on({ eventName: "wme-map-data-loaded", eventHandler: onMove });
      this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.reevaluate() });
      this.sdk.Events.on({ eventName: "wme-save-finished", eventHandler: () => this.reevaluate() });
      this.requestScan();
    }
    onUpdate(listener) {
      this.listeners.push(listener);
    }
    getSnapshot() {
      return this.snapshot;
    }
    setPaused(paused) {
      this.paused = paused;
      if (paused) {
        this.controller?.abort();
        this.publish({ state: "paused" });
      } else {
        this.requestScan();
      }
    }
    requestScan() {
      if (this.paused) return;
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        void this.scan();
      }, DEBOUNCE_MS);
    }
    /** Full rescan ignoring the tile cache (e.g. after register daily update). */
    rescan() {
      this.fetcher.cache.clear();
      this.lastIndex = null;
      this.coveredTiles = null;
      this.requestScan();
    }
    /** Re-run evaluation against the last fetched official index, without refetching. */
    reevaluate() {
      if (this.paused || !this.lastIndex) return;
      this.evaluateAll(this.lastIndex);
      this.publish({ state: "done" });
    }
    async scan() {
      if (this.paused) return;
      const gen = ++this.generation;
      this.controller?.abort();
      const controller = new AbortController();
      this.controller = controller;
      try {
        const zoom = this.sdk.Map.getZoomLevel();
        if (zoom < this.settings.get().minZoom) {
          this.publish({ state: "zoom-gated", issues: /* @__PURE__ */ new Map(), progress: null });
          return;
        }
        const bbox = padBbox(this.sdk.Map.getMapExtent());
        if (bboxAreaKm2(bbox) > MAX_AREA_KM2) {
          this.publish({ state: "area-gated", issues: /* @__PURE__ */ new Map(), progress: null });
          return;
        }
        this.publish({ state: "fetching", error: null });
        const streets = await this.fetcher.fetchBbox(bbox, controller.signal, (done, total) => {
          if (gen === this.generation) this.publish({ progress: { done, total } });
        });
        if (gen !== this.generation) return;
        this.publish({ state: "evaluating", progress: null });
        const index = new OfficialIndex(streets);
        this.lastIndex = index;
        this.coveredTiles = new Set(tileKeysForBbox(bbox));
        this.evaluateAll(index);
        this.publish({ state: "done", officialStreetCount: index.streetCount });
      } catch (err) {
        if (controller.signal.aborted || gen !== this.generation) return;
        log.error("Scan failed", err);
        this.publish({ state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    evaluateAll(index) {
      const settings = this.settings.get();
      const issues = /* @__PURE__ */ new Map();
      const stats = { ok: 0, okAlt: 0, skipped: 0, total: 0 };
      const segments = this.sdk.DataModel.Segments.getAll();
      for (const segment of segments) {
        stats.total++;
        if (!this.isCovered(segment)) {
          stats.skipped++;
          continue;
        }
        let verdict;
        try {
          const address = this.sdk.DataModel.Segments.getAddress({ segmentId: segment.id });
          verdict = evaluateSegment(segment, address, index, settings);
        } catch {
          stats.skipped++;
          continue;
        }
        switch (verdict.kind) {
          case "ok":
            stats.ok++;
            break;
          case "okAlt":
            stats.okAlt++;
            break;
          case "skipped":
            stats.skipped++;
            break;
          case "issue":
            issues.set(verdict.issue.segmentId, verdict.issue);
            break;
        }
      }
      if (settings.guidelineChecks) {
        const getAddress = (segmentId) => {
          try {
            return this.sdk.DataModel.Segments.getAddress({ segmentId });
          } catch {
            return null;
          }
        };
        for (const issue of evaluateGuidelines(segments, getAddress)) {
          if (!issues.has(issue.segmentId)) issues.set(issue.segmentId, issue);
        }
      }
      this.publish({ issues, stats, unsavedCount: this.safeUnsavedCount() });
    }
    isCovered(segment) {
      const covered = this.coveredTiles;
      if (!covered) return true;
      return segment.geometry.coordinates.some(
        ([lon, lat]) => covered.has(tileKeyForPoint(lon, lat))
      );
    }
    safeUnsavedCount() {
      try {
        return this.sdk.Editing.getUnsavedChangesCount();
      } catch {
        return 0;
      }
    }
    publish(partial) {
      this.snapshot = { ...this.snapshot, ...partial, unsavedCount: this.safeUnsavedCount() };
      for (const listener of this.listeners) {
        try {
          listener(this.snapshot);
        } catch (err) {
          log.error("Listener failed", err);
        }
      }
    }
  };

  // src/sdk.ts
  var SCRIPT_ID = "wme-ch-street-name-checker";
  var SCRIPT_NAME = "WME CH Street Name Checker";
  var sdk = null;
  function pageWindow() {
    return typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  }
  async function initSdk() {
    const w = pageWindow();
    await w.SDK_INITIALIZED;
    if (!w.getWmeSdk) {
      throw new Error("getWmeSdk is not available on the page");
    }
    const instance = w.getWmeSdk({ scriptId: SCRIPT_ID, scriptName: SCRIPT_NAME });
    sdk = instance;
    return instance;
  }

  // src/settings.ts
  var ROAD_TYPE_OPTIONS = [
    { id: 1, label: "Street", defaultChecked: true },
    { id: 2, label: "Primary Street", defaultChecked: true },
    { id: 7, label: "Minor Highway", defaultChecked: true },
    { id: 6, label: "Major Highway", defaultChecked: true },
    { id: 3, label: "Freeway", defaultChecked: false },
    { id: 4, label: "Ramp", defaultChecked: false },
    { id: 17, label: "Private Road", defaultChecked: false },
    { id: 20, label: "Parking Lot Road", defaultChecked: false },
    { id: 8, label: "Off-road", defaultChecked: false },
    { id: 22, label: "Alley", defaultChecked: false },
    { id: 5, label: "Walking Trail", defaultChecked: false },
    { id: 9, label: "Walkway", defaultChecked: false },
    { id: 10, label: "Pedestrian Boardwalk", defaultChecked: false },
    { id: 16, label: "Stairway", defaultChecked: false },
    { id: 15, label: "Ferry", defaultChecked: false },
    { id: 18, label: "Railroad", defaultChecked: false },
    { id: 19, label: "Runway/Taxiway", defaultChecked: false }
  ];
  var DEFAULT_SETTINGS = {
    version: 1,
    minZoom: 15,
    checkedRoadTypes: ROAD_TYPE_OPTIONS.filter((r) => r.defaultChecked).map((r) => r.id),
    altNameCountsAsOk: true,
    showCosmetic: true,
    cityScoping: "off",
    showMapLabels: true,
    keepOldNameAsAlt: false,
    language: "auto",
    guidelineChecks: true
  };
  var STORAGE_KEY = "wme-ch-name-check.settings";
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1) return { ...DEFAULT_SETTINGS };
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch (err) {
      log.warn("Failed to load settings, using defaults", err);
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      log.warn("Failed to save settings", err);
    }
  }
  var SettingsStore = class {
    settings;
    constructor() {
      this.settings = loadSettings();
    }
    get() {
      return this.settings;
    }
    update(partial) {
      this.settings = { ...this.settings, ...partial };
      saveSettings(this.settings);
      return this.settings;
    }
  };

  // src/fix.ts
  var GROUP_FIX_CAP = 25;
  var GROUP_FIX_CONFIRM_THRESHOLD = 5;
  function fixSegment(sdk2, issue, settings) {
    const segmentId = issue.segmentId;
    const fail = (errorCode) => ({ segmentId, ok: false, errorCode });
    if (!issue.fixable || !issue.suggestion) return fail("errNotFixable");
    if (!sdk2.Editing.isEditingAllowed()) return fail("errEditingNotAllowed");
    try {
      const segment = sdk2.DataModel.Segments.getById({ segmentId });
      if (!segment) return fail("errSegmentUnloaded");
      const address = sdk2.DataModel.Segments.getAddress({ segmentId });
      const cityId = address.city?.id;
      if (cityId == null) return fail("errNoCity");
      let street = sdk2.DataModel.Streets.getStreet({ streetName: issue.suggestion, cityId });
      if (!street) {
        try {
          street = sdk2.DataModel.Streets.addStreet({ streetName: issue.suggestion, cityId });
        } catch {
          street = sdk2.DataModel.Streets.getStreet({ streetName: issue.suggestion, cityId });
        }
      }
      if (!street) return fail("errStreetCreate");
      const alternateStreetIds = [...segment.alternateStreetIds];
      if (settings.keepOldNameAsAlt && issue.status !== "NEAR" && // never keep a typo as alternate
      segment.primaryStreetId != null && segment.primaryStreetId !== street.id && !alternateStreetIds.includes(segment.primaryStreetId)) {
        alternateStreetIds.push(segment.primaryStreetId);
      }
      sdk2.DataModel.Segments.updateAddress({
        segmentId,
        primaryStreetId: street.id,
        alternateStreetIds
      });
      return { segmentId, ok: true };
    } catch (err) {
      log.error(`Fix failed for segment ${segmentId}`, err);
      return {
        segmentId,
        ok: false,
        errorDetail: err instanceof Error ? err.message : String(err)
      };
    }
  }
  function fixGroup(sdk2, issues, settings) {
    const outcomes = [];
    for (const issue of issues.slice(0, GROUP_FIX_CAP)) {
      const outcome = fixSegment(sdk2, issue, settings);
      outcomes.push(outcome);
      if (!outcome.ok) break;
    }
    return outcomes;
  }

  // src/ui/styles.ts
  var statusChipRules = Object.keys(STATUS_STYLES).map(
    (status) => `
.chk-badge-${status} { background: ${STATUS_STYLES[status].strokeColor}; }`
  ).join("\n");
  var CSS = `
.chk-pane { font-size: 12px; padding: 6px 8px; display: flex; flex-direction: column; gap: 8px; }
.chk-pane button { cursor: pointer; }
.chk-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.chk-status-line { flex: 1; min-width: 120px; }
.chk-unsaved { color: #b35c00; font-weight: bold; }
.chk-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chk-chip { border: 1px solid #ccc; border-radius: 10px; padding: 1px 8px; background: #fff; font-size: 11px; }
.chk-chip.chk-chip-active { border-color: #333; box-shadow: inset 0 0 0 1px #333; }
.chk-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; flex-shrink: 0; }
.chk-groups { display: flex; flex-direction: column; gap: 4px; max-height: 50vh; overflow-y: auto; }
.chk-group { border: 1px solid #ddd; border-radius: 4px; }
.chk-group-header { display: flex; align-items: center; gap: 6px; padding: 4px 6px; cursor: pointer; }
.chk-group-header:hover { background: #f5f5f5; }
.chk-badge { display: inline-block; min-width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
${statusChipRules}
.chk-group-names { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.chk-arrow { color: #888; }
.chk-suggestion { font-weight: bold; }
.chk-note { color: #888; font-style: italic; }
.chk-count { color: #666; }
.chk-fix-all { font-size: 11px; }
.chk-rows { border-top: 1px solid #eee; }
.chk-row { display: flex; align-items: center; gap: 6px; padding: 2px 6px 2px 18px; cursor: pointer; }
.chk-row:hover { background: #f0f7ff; }
.chk-row.chk-selected { background: #e0efff; }
.chk-row-meta { color: #888; flex: 1; }
.chk-locate { font-size: 13px; line-height: 1; padding: 0 5px; }
.chk-settings summary { cursor: pointer; font-weight: bold; margin: 4px 0; }
.chk-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 8px; margin: 4px 0; }
.chk-settings label { display: flex; align-items: center; gap: 4px; font-weight: normal; }
.chk-settings-row { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
.chk-empty { color: #4a8f3c; font-weight: bold; padding: 8px 0; }
.chk-muted { color: #888; }
.chk-error { color: #c00; }
.chk-footer { font-size: 11px; border-top: 1px solid #eee; padding-top: 4px; margin-top: 2px; }
`;
  var injected = false;
  function injectStyles() {
    if (injected) return;
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    injected = true;
  }

  // src/ui/tab.ts
  var ROAD_TYPE_LABELS = new Map(ROAD_TYPE_OPTIONS.map((r) => [r.id, r.label]));
  var LEGEND_KEYS = {
    COSMETIC: "legendCOSMETIC",
    VARIANT: "legendVARIANT",
    NEAR: "legendNEAR",
    WRONG_TYPE: "legendWRONG_TYPE",
    WRONG_CITY: "legendWRONG_CITY",
    NOT_FOUND: "legendNOT_FOUND",
    UNNAMED: "legendUNNAMED",
    MICRO_SEGMENT: "legendMICRO_SEGMENT",
    LOOP: "legendLOOP",
    NARROW_MISUSE: "legendNARROW_MISUSE"
  };
  var STATE_KEYS = {
    idle: "stateIdle",
    "zoom-gated": "stateZoomGated",
    "area-gated": "stateAreaGated",
    fetching: "stateFetching",
    evaluating: "stateEvaluating",
    done: "stateDone",
    paused: "statePaused",
    error: "stateError"
  };
  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  }
  function formatNote(note) {
    if (!note) return "";
    const parts = [];
    if (note.unofficial) parts.push(t("noteUnofficial"));
    if (note.planned) parts.push(t("notePlanned"));
    if (note.fullLabel) parts.push(t("noteFullLabel", { label: note.fullLabel }));
    if (note.existsIn) parts.push(t("noteExistsIn", { place: note.existsIn }));
    return parts.join(", ");
  }
  function formatFixError(outcome) {
    if (outcome.errorCode) return t(outcome.errorCode);
    return outcome.errorDetail ?? "?";
  }
  function groupIssues(issues) {
    const groups = /* @__PURE__ */ new Map();
    for (const issue of issues) {
      const key = `${issue.status}|${issue.currentName ?? ""}|${issue.suggestion ?? ""}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          key,
          status: issue.status,
          currentName: issue.currentName,
          suggestion: issue.suggestion,
          note: issue.note,
          fixable: issue.fixable,
          issues: []
        };
        groups.set(key, group);
      }
      group.issues.push(issue);
    }
    return [...groups.values()].sort((a, b) => b.issues.length - a.issues.length);
  }
  var TabUI = class {
    constructor(sdk2, scanner, settings) {
      this.sdk = sdk2;
      this.scanner = scanner;
      this.settings = settings;
    }
    sdk;
    scanner;
    settings;
    pane;
    statusLine;
    unsavedBadge;
    chipsBox;
    groupsBox;
    activeFilters = /* @__PURE__ */ new Set();
    expandedGroups = /* @__PURE__ */ new Set();
    selectedSegmentIds = /* @__PURE__ */ new Set();
    orderedIssueIds = [];
    nextIssuePointer = -1;
    async init() {
      injectStyles();
      const { tabLabel, tabPane } = await this.sdk.Sidebar.registerScriptTab();
      tabLabel.textContent = "CH Names";
      this.pane = tabPane;
      this.buildSkeleton();
      this.scanner.onUpdate((snapshot) => this.render(snapshot));
      this.sdk.Events.on({
        eventName: "wme-selection-changed",
        eventHandler: () => this.syncSelection()
      });
      this.render(this.scanner.getSnapshot());
    }
    /** Rebuild all static DOM (after a language change). */
    rebuild() {
      this.pane.replaceChildren();
      this.buildSkeleton();
      this.render(this.scanner.getSnapshot());
    }
    buildSkeleton() {
      this.pane.classList.add("chk-pane");
      const header = el("div", "chk-header");
      this.statusLine = el("span", "chk-status-line", t("stateIdle"));
      this.unsavedBadge = el("span", "chk-unsaved", "");
      const rescanBtn = el("button", "", t("rescan"));
      rescanBtn.title = t("rescanTitle");
      rescanBtn.addEventListener("click", () => this.scanner.rescan());
      const nextBtn = el("button", "", t("nextIssue"));
      nextBtn.title = t("nextIssueTitle");
      nextBtn.addEventListener("click", () => this.selectNextIssue());
      header.append(this.statusLine, this.unsavedBadge, rescanBtn, nextBtn);
      this.chipsBox = el("div", "chk-chips");
      this.groupsBox = el("div", "chk-groups");
      this.pane.append(
        header,
        this.chipsBox,
        this.groupsBox,
        this.buildLegend(),
        this.buildSettings(),
        this.buildFooter()
      );
    }
    buildFooter() {
      const footer = el("div", "chk-footer");
      footer.appendChild(el("span", "chk-muted", `v${"0.6.0"} · `));
      const link = el("a", "", "Changelog");
      link.href = "https://github.com/Neprena/wme-ch-street-name-checker/blob/main/CHANGELOG.md";
      link.target = "_blank";
      link.rel = "noopener";
      footer.appendChild(link);
      return footer;
    }
    buildLegend() {
      const details = el("details", "chk-settings");
      details.appendChild(el("summary", "", t("legendTitle")));
      for (const status of Object.keys(STATUS_STYLES)) {
        const row = el("div", "chk-settings-row");
        const dot = el("span", "chk-dot");
        dot.style.background = STATUS_STYLES[status].strokeColor;
        row.append(dot, el("span", "", `${status}: ${t(LEGEND_KEYS[status])}`));
        details.appendChild(row);
      }
      return details;
    }
    render(snapshot) {
      const { state, issues, stats, officialStreetCount, progress, error } = snapshot;
      let statusText = t(STATE_KEYS[state]);
      if (state === "fetching" && progress) statusText += ` ${progress.done}/${progress.total}`;
      if (state === "done") {
        statusText = t("stateDone", {
          issues: issues.size,
          ok: stats.ok + stats.okAlt,
          streets: officialStreetCount
        });
      }
      if (state === "error" && error) statusText += `: ${error}`;
      this.statusLine.textContent = statusText;
      this.statusLine.classList.toggle("chk-error", state === "error");
      this.unsavedBadge.textContent = snapshot.unsavedCount > 0 ? t("unsavedBadge", { n: snapshot.unsavedCount }) : "";
      const visible = this.visibleIssues(issues);
      this.orderedIssueIds = visible.map((i) => i.segmentId);
      this.renderChips(issues);
      this.renderGroups(visible, state);
    }
    visibleIssues(issues) {
      const settings = this.settings.get();
      return [...issues.values()].filter((issue) => {
        if (!settings.showCosmetic && issue.status === "COSMETIC") return false;
        return this.activeFilters.size === 0 || this.activeFilters.has(issue.status);
      });
    }
    renderChips(issues) {
      this.chipsBox.replaceChildren();
      const counts = /* @__PURE__ */ new Map();
      for (const issue of issues.values()) {
        counts.set(issue.status, (counts.get(issue.status) ?? 0) + 1);
      }
      for (const status of Object.keys(STATUS_STYLES)) {
        const count = counts.get(status) ?? 0;
        if (count === 0) continue;
        const chip = el("button", "chk-chip");
        chip.classList.toggle("chk-chip-active", this.activeFilters.has(status));
        const dot = el("span", "chk-dot");
        dot.style.background = STATUS_STYLES[status].strokeColor;
        chip.append(dot, `${status} ${count}`);
        chip.title = t("filterChipTitle");
        chip.addEventListener("click", () => {
          if (this.activeFilters.has(status)) this.activeFilters.delete(status);
          else this.activeFilters.add(status);
          this.render(this.scanner.getSnapshot());
        });
        this.chipsBox.appendChild(chip);
      }
    }
    renderGroups(visible, state) {
      this.groupsBox.replaceChildren();
      if (visible.length === 0) {
        if (state === "done") {
          this.groupsBox.appendChild(el("div", "chk-empty", t("allMatch")));
        } else if (state === "zoom-gated" || state === "area-gated") {
          this.groupsBox.appendChild(el("div", "chk-muted", t(STATE_KEYS[state])));
        }
        return;
      }
      for (const group of groupIssues(visible)) {
        this.groupsBox.appendChild(this.renderGroup(group));
      }
    }
    renderGroup(group) {
      const box = el("div", "chk-group");
      const header = el("div", "chk-group-header");
      const badge = el("span", `chk-badge chk-badge-${group.status}`);
      badge.title = group.status;
      const noteText = formatNote(group.note);
      const names = el("span", "chk-group-names");
      names.appendChild(el("span", "", group.currentName ?? t("unnamed")));
      if (group.suggestion && group.suggestion !== group.currentName) {
        names.appendChild(el("span", "chk-arrow", "  →  "));
        names.appendChild(el("span", "chk-suggestion", group.suggestion));
      }
      if (noteText) {
        names.appendChild(el("span", "chk-note", ` (${noteText})`));
      }
      names.title = `${group.status}${noteText ? ` — ${noteText}` : ""}`;
      const count = el("span", "chk-count", `×${group.issues.length}`);
      header.append(badge, names, count);
      if (group.fixable && group.issues.length > 1) {
        const fixAllBtn = el(
          "button",
          "chk-fix-all",
          t("fixAll", { n: Math.min(group.issues.length, GROUP_FIX_CAP) })
        );
        fixAllBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onFixGroup(group);
        });
        header.appendChild(fixAllBtn);
      }
      header.addEventListener("click", () => {
        if (this.expandedGroups.has(group.key)) this.expandedGroups.delete(group.key);
        else this.expandedGroups.add(group.key);
        this.render(this.scanner.getSnapshot());
      });
      box.appendChild(header);
      if (this.expandedGroups.has(group.key) || group.issues.length === 1) {
        const rows = el("div", "chk-rows");
        for (const issue of group.issues) {
          rows.appendChild(this.renderRow(issue));
        }
        box.appendChild(rows);
      }
      return box;
    }
    renderRow(issue) {
      const row = el("div", "chk-row");
      row.dataset["segmentId"] = String(issue.segmentId);
      row.classList.toggle("chk-selected", this.selectedSegmentIds.has(issue.segmentId));
      const meta = el(
        "span",
        "chk-row-meta",
        `${ROAD_TYPE_LABELS.get(issue.roadType) ?? `type ${issue.roadType}`} · ${Math.round(issue.length)} m${issue.cityName ? ` · ${issue.cityName}` : ""}`
      );
      row.appendChild(meta);
      const locateBtn = el("button", "chk-locate", "⌖");
      locateBtn.title = t("locateTitle");
      locateBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.locateSegment(issue);
      });
      row.appendChild(locateBtn);
      if (issue.fixable) {
        const fixBtn = el("button", "chk-fix-all", t("fix"));
        fixBtn.title = t("fixTitle", { name: issue.suggestion ?? "" });
        fixBtn.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.onFixOne(issue);
        });
        row.appendChild(fixBtn);
      }
      row.addEventListener("click", () => this.selectSegment(issue.segmentId));
      return row;
    }
    locateSegment(issue) {
      try {
        this.sdk.Map.centerMapOnGeometry({ geometry: issue.geometry });
      } catch {
      }
      this.selectSegment(issue.segmentId);
    }
    selectSegment(segmentId) {
      try {
        this.sdk.Editing.setSelection({
          selection: { ids: [segmentId], objectType: "segment" }
        });
      } catch {
      }
    }
    selectNextIssue() {
      if (this.orderedIssueIds.length === 0) return;
      this.nextIssuePointer = (this.nextIssuePointer + 1) % this.orderedIssueIds.length;
      const segmentId = this.orderedIssueIds[this.nextIssuePointer];
      if (segmentId !== void 0) this.selectSegment(segmentId);
    }
    syncSelection() {
      this.selectedSegmentIds.clear();
      const selection = this.sdk.Editing.getSelection();
      if (selection?.objectType === "segment") {
        for (const id of selection.ids) this.selectedSegmentIds.add(id);
      }
      let first = null;
      this.groupsBox.querySelectorAll(".chk-row").forEach((row) => {
        const id = Number(row.dataset["segmentId"]);
        const selected = this.selectedSegmentIds.has(id);
        row.classList.toggle("chk-selected", selected);
        if (selected && !first) first = row;
      });
      first?.scrollIntoView({ block: "nearest" });
    }
    onFixOne(issue) {
      const outcome = fixSegment(this.sdk, issue, this.settings.get());
      if (!outcome.ok) {
        alert(t("fixFailed", { error: formatFixError(outcome) }));
        return;
      }
      this.scanner.reevaluate();
    }
    onFixGroup(group) {
      const n = Math.min(group.issues.length, GROUP_FIX_CAP);
      if (n > GROUP_FIX_CONFIRM_THRESHOLD && !confirm(t("confirmGroupFix", { name: group.suggestion ?? "", n }))) {
        return;
      }
      const outcomes = fixGroup(this.sdk, group.issues, this.settings.get());
      const failed = outcomes.find((o) => !o.ok);
      if (failed) {
        alert(
          t("fixStopped", {
            done: outcomes.filter((o) => o.ok).length,
            total: n,
            error: formatFixError(failed),
            id: failed.segmentId
          })
        );
      }
      this.scanner.reevaluate();
    }
    buildSettings() {
      const details = el("details", "chk-settings");
      details.appendChild(el("summary", "", t("settingsTitle")));
      const settings = this.settings.get();
      const apply = (partial, rescan = false) => {
        this.settings.update(partial);
        if (rescan) this.scanner.requestScan();
        else this.scanner.reevaluate();
      };
      const grid = el("div", "chk-settings-grid");
      for (const option of ROAD_TYPE_OPTIONS) {
        const label = el("label");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = settings.checkedRoadTypes.includes(option.id);
        cb.addEventListener("change", () => {
          const current2 = new Set(this.settings.get().checkedRoadTypes);
          if (cb.checked) current2.add(option.id);
          else current2.delete(option.id);
          apply({ checkedRoadTypes: [...current2] });
        });
        label.append(cb, option.label);
        grid.appendChild(label);
      }
      details.appendChild(el("div", "", t("roadTypesLabel")));
      details.appendChild(grid);
      const toggle = (textKey, key, titleKey) => {
        const label = el("label");
        if (titleKey) label.title = t(titleKey);
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = settings[key];
        cb.addEventListener("change", () => apply({ [key]: cb.checked }));
        label.append(cb, t(textKey));
        const row = el("div", "chk-settings-row");
        row.appendChild(label);
        return row;
      };
      details.appendChild(toggle("altOk", "altNameCountsAsOk", "altOkTitle"));
      details.appendChild(toggle("showCosmetic", "showCosmetic"));
      details.appendChild(toggle("showMapLabels", "showMapLabels"));
      details.appendChild(toggle("keepOldName", "keepOldNameAsAlt", "keepOldNameTitle"));
      details.appendChild(toggle("guidelineChecks", "guidelineChecks", "guidelineChecksTitle"));
      const scopingRow = el("div", "chk-settings-row");
      scopingRow.appendChild(el("span", "", t("scopingLabel")));
      const select = el("select");
      const scopingLabels = {
        off: t("scopingOff"),
        warn: t("scopingWarn"),
        strict: t("scopingStrict")
      };
      for (const value of ["off", "warn", "strict"]) {
        const opt = el("option", "", scopingLabels[value]);
        opt.value = value;
        select.appendChild(opt);
      }
      select.value = settings.cityScoping;
      select.title = t("scopingTitle");
      select.addEventListener("change", () => apply({ cityScoping: select.value }));
      scopingRow.appendChild(select);
      details.appendChild(scopingRow);
      const zoomRow = el("div", "chk-settings-row");
      zoomRow.appendChild(el("span", "", t("minZoomLabel")));
      const zoomInput = el("input");
      zoomInput.type = "number";
      zoomInput.min = "12";
      zoomInput.max = "22";
      zoomInput.value = String(settings.minZoom);
      zoomInput.addEventListener("change", () => {
        const v = Number(zoomInput.value);
        if (Number.isFinite(v) && v >= 12 && v <= 22) apply({ minZoom: v }, true);
      });
      zoomRow.appendChild(zoomInput);
      details.appendChild(zoomRow);
      const langRow = el("div", "chk-settings-row");
      langRow.appendChild(el("span", "", t("languageLabel")));
      const langSelect = el("select");
      for (const choice of LANGUAGE_CHOICES) {
        const opt = el(
          "option",
          "",
          choice.value === "auto" ? t("languageAuto") : choice.label
        );
        opt.value = choice.value;
        langSelect.appendChild(opt);
      }
      langSelect.value = settings.language;
      langSelect.addEventListener("change", () => {
        const language = langSelect.value;
        this.settings.update({ language });
        setLocale(resolveLocale(language, this.sdk.Settings.getLocale().localeCode));
        this.rebuild();
      });
      langRow.appendChild(langSelect);
      details.appendChild(langRow);
      return details;
    }
  };

  // src/main.user.ts
  async function main() {
    const sdk2 = await initSdk();
    await sdk2.Events.once({ eventName: "wme-ready" });
    const settings = new SettingsStore();
    setLocale(resolveLocale(settings.get().language, sdk2.Settings.getLocale().localeCode));
    const fetcher = new TileFetcher();
    const scanner = new Scanner(sdk2, fetcher, settings);
    const layer = new HighlightLayer(sdk2, settings);
    layer.init();
    registerLayerCheckbox(sdk2, (checked) => {
      layer.setVisible(checked);
      scanner.setPaused(!checked);
    });
    scanner.onUpdate((snapshot) => {
      layer.sync(snapshot.issues, settings.get().showCosmetic);
    });
    const tab = new TabUI(sdk2, scanner, settings);
    await tab.init();
    scanner.start();
    log.info(`v${"0.6.0"} ready (SDK ${sdk2.getSDKVersion()}, WME ${sdk2.getWMEVersion()})`);
  }
  main().catch((err) => log.error("Initialization failed", err));
})();
