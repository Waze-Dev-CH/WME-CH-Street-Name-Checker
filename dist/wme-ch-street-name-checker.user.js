// ==UserScript==
// @name         WME CH Street Name Checker
// @namespace    https://github.com/Neprena
// @version      1.13.0
// @description  Validates Waze street names against the official Swiss street register (répertoire officiel des rues, swisstopo / geo.admin.ch)
// @author       Yann Rapenne
// @license      MIT
// @homepageURL  https://github.com/Neprena/WME-CH-Street-Name-Checker
// @supportURL   https://github.com/Neprena/WME-CH-Street-Name-Checker/issues
// @downloadURL  https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js
// @updateURL    https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js
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

  // src/geoadmin/idb-store.ts
  var DB_NAME = "wme-ch-name-check";
  var STORE_NAME = "tiles";
  var MAX_PERSISTED_TILES = 2e3;
  var IdbTileStore = class {
    dbPromise = null;
    broken = false;
    open() {
      if (!this.dbPromise) {
        this.dbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(DB_NAME, 2);
          request.onupgradeneeded = () => {
            if (request.result.objectStoreNames.contains(STORE_NAME)) {
              request.result.deleteObjectStore(STORE_NAME);
            }
            request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
        });
      }
      return this.dbPromise;
    }
    async run(mode, operation) {
      if (this.broken) return void 0;
      try {
        const db = await this.open();
        return await new Promise((resolve, reject) => {
          const request = operation(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
        });
      } catch (err) {
        if (!this.broken) {
          this.broken = true;
          log.warn("IndexedDB unavailable; falling back to in-memory tile cache only", err);
        }
        return void 0;
      }
    }
    async get(key) {
      return this.run("readonly", (store) => store.get(key));
    }
    async set(tile) {
      await this.run("readwrite", (store) => store.put(tile));
    }
    async clear() {
      await this.run("readwrite", (store) => store.clear());
    }
    /** Drop expired tiles, then the oldest beyond the cap. */
    async prune(ttlMs) {
      const all = await this.run("readonly", (store) => store.getAll());
      if (!all) return;
      const now = Date.now();
      const expired = all.filter((tile) => now - tile.fetchedAt > ttlMs).map((tile) => tile.key);
      const alive = all.filter((tile) => now - tile.fetchedAt <= ttlMs).sort((a, b) => a.fetchedAt - b.fetchedAt);
      const overflow = alive.slice(0, Math.max(0, alive.length - MAX_PERSISTED_TILES));
      for (const key of [...expired, ...overflow.map((tile) => tile.key)]) {
        await this.run("readwrite", (store) => store.delete(key));
      }
    }
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
  function extractLines(geometry) {
    const g = geometry;
    if (!g || typeof g !== "object") return null;
    switch (g.type) {
      case "LineString":
        return Array.isArray(g.coordinates) ? [g.coordinates] : null;
      case "MultiLineString":
        return Array.isArray(g.coordinates) ? g.coordinates : null;
      case "GeometryCollection": {
        const lines = (g.geometries ?? []).flatMap((sub) => extractLines(sub) ?? []);
        return lines.length > 0 ? lines : null;
      }
      default:
        return null;
    }
  }
  function parseAttributes(attrs, geometry) {
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
      type: String(attrs["str_type"] ?? ""),
      lines: extractLines(geometry)
    };
  }
  var FIND_URL = "https://api3.geo.admin.ch/rest/services/api/MapServer/find";
  async function findStreetLinesByName(name, signal, limiter = rateLimiter) {
    await limiter.acquire();
    if (signal?.aborted) throw new DOMException("Scan aborted", "AbortError");
    const params = new URLSearchParams({
      layer: LAYER_ID,
      searchField: "stn_label",
      searchText: name,
      contains: "false",
      returnGeometry: "true",
      geometryFormat: "geojson",
      sr: "4326"
    });
    const data = await httpGetJson(`${FIND_URL}?${params.toString()}`, signal);
    const lines = (data.results ?? []).flatMap((r) => extractLines(r.geometry) ?? []);
    return lines.length > 0 ? lines : null;
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
        // Geometries are always fetched (measured ~400 KB on the densest
        // Lausanne tile) so the tile cache stays coherent whatever the
        // geometry-matching setting; evaluation decides whether to use them.
        returnGeometry: "true",
        geometryFormat: "geojson",
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE)
      });
      const data = await httpGetJson(`${BASE_URL}?${params.toString()}`, signal);
      const results = data.results ?? [];
      for (const r of results) {
        const street = parseAttributes(r.properties ?? r.attributes, r.geometry);
        if (street) out.push(street);
      }
      if (results.length < PAGE_SIZE) return out;
    }
    log.warn(`Page cap (${MAX_PAGES_PER_TILE}) reached for bbox ${bbox.join(",")}; results truncated`);
    return out;
  }

  // src/geoadmin/tiles.ts
  var TILE_SIZE_DEG = 0.02;
  var CACHE_MAX_TILES = 120;
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
    /** fetchedAt lets persisted tiles keep their original age (TTL coherence). */
    set(key, entries, fetchedAt = this.now()) {
      this.slots.delete(key);
      this.slots.set(key, { entries, fetchedAt });
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
    constructor(cache = new TileCache(), fetchTile = fetchOfficialStreets, persistent = null) {
      this.cache = cache;
      this.fetchTile = fetchTile;
      this.persistent = persistent;
      void this.persistent?.prune(CACHE_TTL_MS);
    }
    cache;
    fetchTile;
    persistent;
    /**
     * Resolve all official streets covering the bbox, tile by tile
     * (memory cache, then persistent store, then network),
     * deduplicated by federal street id.
     */
    async fetchBbox(bbox, signal, onProgress) {
      const keys = tileKeysForBbox(bbox);
      let done = 0;
      onProgress?.(0, keys.length);
      const perTile = await Promise.all(
        keys.map(async (key) => {
          const entries = await this.resolveTile(key, signal);
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
    async resolveTile(key, signal) {
      const cached = this.cache.get(key);
      if (cached) return cached;
      const persisted = await this.persistent?.get(key);
      if (persisted && Date.now() - persisted.fetchedAt <= CACHE_TTL_MS) {
        this.cache.set(key, persisted.entries, persisted.fetchedAt);
        return persisted.entries;
      }
      const entries = await this.fetchTile(tileKeyToBbox(key), signal);
      this.cache.set(key, entries);
      void this.persistent?.set({ key, entries, fetchedAt: Date.now() });
      return entries;
    }
    /** Used by Rescan: drop both cache levels. */
    clearAll() {
      this.cache.clear();
      void this.persistent?.clear();
    }
  };

  // src/i18n.ts
  var en = {
    stateIdle: "Idle",
    stateDisabled: "Script disabled",
    stateOutsideCh: "Outside Switzerland",
    toggleEnabled: "Enabled",
    toggleEnabledTitle: "Master switch: off disables scanning, the map layer and the edit-panel box",
    toggleAutoScan: "Auto scan",
    toggleAutoScanTitle: "Scan automatically when the map moves; off = use the Rescan button",
    stateZoomGated: "Zoom in to scan",
    stateAreaGated: "View too large to scan",
    stateFetching: "Fetching official register…",
    stateEvaluating: "Comparing names…",
    statePaused: "Paused (layer unchecked)",
    stateError: "Scan failed",
    updating: "Updating…",
    stateDone: "{issues} issue(s) · {ok} OK · {streets} official streets",
    unsavedBadge: "{n} unsaved",
    rescan: "Rescan",
    rescanTitle: "Clear the cache and fetch the official register again",
    nextIssue: "Next issue",
    nextIssueTitle: "Select the next mismatching segment",
    locateTitle: "Center the map on the segment",
    geoAdminLinkTitle: "Open this spot on map.geo.admin.ch (official register layer)",
    filterChipTitle: "Filter the list by this status",
    unnamed: "(unnamed)",
    noteUnofficial: "unofficial",
    notePlanned: "planned",
    noteFullLabel: "full label: {label}",
    noteExistsIn: "exists in: {place}",
    noteOwnDistance: "its official axis is ~{m} m away",
    noteLock: "L{current} → expected L{expected}",
    fixAll: "Fix all ({n})",
    fix: "Fix",
    fixTitle: 'Apply "{name}"',
    confirmGroupFix: 'Apply "{name}" to {n} segments?\nNothing is saved automatically; review and save in WME.',
    fixFailed: "Fix failed: {error}",
    fixStopped: "Fixed {done}/{total}, then stopped: {error} (segment {id})",
    allMatch: "All street names match ✓",
    legendTitle: "Legend",
    legendCOSMETIC: "typography only (case, apostrophe, spacing), dashed line",
    legendVARIANT: "abbreviation, missing accent or article; official spelling suggested",
    legendNEAR: "probable typo; one close official name found",
    legendWRONG_TYPE: "different or missing way type (Chemin ↔ Route, X → Rue X); unique official name suggested",
    legendWRONG_STREET: "valid name, but the official street underneath has another name",
    geometryMatching: "Geometry matching (official street under the segment)",
    geometryMatchingTitle: "Enables UNNAMED suggestions, wrong-street detection and disambiguation by distance",
    viewportOnly: "Show only segments visible on the map",
    viewportOnlyTitle: "Filters the list and counters to the area currently on screen (no rescan)",
    editableOnly: "Only segments I can edit",
    editableOnlyTitle: "Hide segments locked above my editor rank",
    legendWRONG_CITY: "name exists, but in another locality (city scoping)",
    legendNOT_FOUND: "not found in the official register",
    legendUNNAMED: "checked road type without a street name, dashed line",
    legendMICRO_SEGMENT: "drivable segment shorter than 5 m (Swiss guideline; roundabouts excluded)",
    legendLOOP: "loop made of fewer than 3 segments (same endpoints); split it",
    legendNARROW_MISUSE: "Narrow Street misuse: one-way or shorter than 50 m",
    legendUNDER_LOCK: "lock rank below the Swiss minimum for its road type",
    legendOVER_LOCK: "lock rank above the Swiss minimum (often intentional)",
    guidelineChecks: "Swiss guideline checks (micro-segments, loops, narrow streets)",
    guidelineChecksTitle: "Checks from the Suisse romande editing guidelines that need no external data",
    helperOk: "matches the official register",
    helperSetting: "Issue box in the segment edit panel",
    settingsTitle: "Settings",
    roadTypesLabel: "Checked road types:",
    statusesLabel: "Checked issue types:",
    optionsLabel: "Options",
    scopeDisplayLabel: "Scope & display",
    altOk: "Alternate name match counts as OK",
    altOkTitle: "Useful in bilingual communes where the second language is an alternate name",
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
    shortcutNextIssue: "CH Names: select the next issue",
    shortcutFixSelected: "CH Names: fix the selected segment",
    errNotFixable: "Not fixable",
    errEditingNotAllowed: "Editing is not allowed here",
    errSegmentUnloaded: "Segment no longer loaded",
    errNoCity: "Segment has no city; set the city first",
    errStreetCreate: "Could not find or create the street record"
  };
  var fr = {
    stateIdle: "En attente",
    stateDisabled: "Script désactivé",
    stateOutsideCh: "Hors de Suisse",
    toggleEnabled: "Actif",
    toggleEnabledTitle: "Interrupteur général: désactive le scan, la couche carte et l'encadré du panneau",
    toggleAutoScan: "Scan auto",
    toggleAutoScanTitle: "Scanner automatiquement au déplacement de la carte; sinon utiliser le bouton Rescanner",
    stateZoomGated: "Zoomez pour scanner",
    stateAreaGated: "Vue trop large pour scanner",
    stateFetching: "Lecture du répertoire officiel…",
    stateEvaluating: "Comparaison des noms…",
    statePaused: "En pause (couche décochée)",
    stateError: "Échec du scan",
    updating: "Mise à jour…",
    stateDone: "{issues} écart(s) · {ok} OK · {streets} rues officielles",
    unsavedBadge: "{n} non sauvegardé(s)",
    rescan: "Rescanner",
    rescanTitle: "Vider le cache et relire le répertoire officiel",
    nextIssue: "Écart suivant",
    nextIssueTitle: "Sélectionner le segment en écart suivant",
    locateTitle: "Centrer la carte sur le segment",
    geoAdminLinkTitle: "Ouvrir cet endroit sur map.geo.admin.ch (couche du répertoire officiel)",
    filterChipTitle: "Filtrer la liste sur ce statut",
    unnamed: "(sans nom)",
    noteUnofficial: "non officiel",
    notePlanned: "planifié",
    noteFullLabel: "libellé complet: {label}",
    noteExistsIn: "existe à: {place}",
    noteOwnDistance: "son axe officiel à ~{m} m",
    noteLock: "L{current} → attendu L{expected}",
    fixAll: "Tout corriger ({n})",
    fix: "Corriger",
    fixTitle: "Appliquer «{name}»",
    confirmGroupFix: "Appliquer «{name}» à {n} segments ?\nRien n'est sauvegardé automatiquement; relisez et sauvez dans WME.",
    fixFailed: "Échec de la correction: {error}",
    fixStopped: "{done}/{total} corrigés, puis arrêt: {error} (segment {id})",
    allMatch: "Tous les noms de rues correspondent ✓",
    legendTitle: "Légende",
    legendCOSMETIC: "typographie uniquement (casse, apostrophe, espaces), trait pointillé",
    legendVARIANT: "abréviation, accent ou article manquant; orthographe officielle proposée",
    legendNEAR: "faute de frappe probable; un seul nom officiel proche",
    legendWRONG_TYPE: "type de voie différent ou manquant (Chemin ↔ Route, X → Rue X); nom officiel unique proposé",
    legendWRONG_STREET: "nom valide, mais la rue officielle dessous porte un autre nom",
    geometryMatching: "Matching géométrique (rue officielle sous le segment)",
    geometryMatchingTitle: "Active les suggestions UNNAMED, la détection de mauvaise rue et la désambiguïsation par distance",
    viewportOnly: "N'afficher que les segments visibles",
    viewportOnlyTitle: "Filtre la liste et les compteurs sur la zone actuellement à l'écran (sans relancer de scan)",
    editableOnly: "Seulement les segments modifiables",
    editableOnlyTitle: "Masquer les segments verrouillés au-dessus de mon niveau d'éditeur",
    legendWRONG_CITY: "le nom existe, mais dans une autre localité (scoping)",
    legendNOT_FOUND: "introuvable dans le répertoire officiel",
    legendUNNAMED: "type de route vérifié sans nom, trait pointillé",
    legendMICRO_SEGMENT: "segment carrossable de moins de 5 m (règle suisse; ronds-points exclus)",
    legendLOOP: "boucle de moins de 3 segments (nœuds identiques); à diviser",
    legendNARROW_MISUSE: "Rue étroite mal utilisée: sens unique ou moins de 50 m",
    legendUNDER_LOCK: "verrou plus bas que le minimum suisse pour ce type de route",
    legendOVER_LOCK: "verrou plus haut que le minimum suisse (souvent volontaire)",
    guidelineChecks: "Contrôles des règles suisses (micro-segments, boucles, rues étroites)",
    guidelineChecksTitle: "Contrôles issus des règles d'édition de Suisse romande, sans donnée externe",
    helperOk: "correspond au répertoire officiel",
    helperSetting: "Encadré d'écart dans le panneau d'édition du segment",
    settingsTitle: "Réglages",
    roadTypesLabel: "Types de routes vérifiés:",
    statusesLabel: "Types d'erreurs vérifiés:",
    optionsLabel: "Options",
    scopeDisplayLabel: "Portée & affichage",
    altOk: "Nom alternatif correspondant = OK",
    altOkTitle: "Utile dans les communes bilingues où la seconde langue est en nom alternatif",
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
    shortcutNextIssue: "CH Names: sélectionner l'écart suivant",
    shortcutFixSelected: "CH Names: corriger le segment sélectionné",
    errNotFixable: "Non corrigeable",
    errEditingNotAllowed: "Édition non autorisée ici",
    errSegmentUnloaded: "Segment plus chargé",
    errNoCity: "Segment sans ville; définissez d'abord la ville",
    errStreetCreate: "Impossible de trouver ou de créer la rue"
  };
  var de = {
    stateIdle: "Bereit",
    stateDisabled: "Skript deaktiviert",
    stateOutsideCh: "Ausserhalb der Schweiz",
    toggleEnabled: "Aktiv",
    toggleEnabledTitle: "Hauptschalter: deaktiviert Scan, Kartenebene und Panel-Box",
    toggleAutoScan: "Auto-Scan",
    toggleAutoScanTitle: "Automatisch bei Kartenbewegung scannen; sonst Neu-scannen-Knopf verwenden",
    stateZoomGated: "Zum Scannen hineinzoomen",
    stateAreaGated: "Ausschnitt zu gross zum Scannen",
    stateFetching: "Amtliches Verzeichnis wird geladen…",
    stateEvaluating: "Namen werden verglichen…",
    statePaused: "Pausiert (Ebene deaktiviert)",
    stateError: "Scan fehlgeschlagen",
    updating: "Aktualisierung…",
    stateDone: "{issues} Abweichung(en) · {ok} OK · {streets} amtliche Strassen",
    unsavedBadge: "{n} ungespeichert",
    rescan: "Neu scannen",
    rescanTitle: "Cache leeren und amtliches Verzeichnis neu laden",
    nextIssue: "Nächste Abweichung",
    nextIssueTitle: "Nächstes abweichendes Segment auswählen",
    locateTitle: "Karte auf das Segment zentrieren",
    geoAdminLinkTitle: "Diese Stelle auf map.geo.admin.ch öffnen (amtliche Verzeichnis-Ebene)",
    filterChipTitle: "Liste nach diesem Status filtern",
    unnamed: "(unbenannt)",
    noteUnofficial: "inoffiziell",
    notePlanned: "geplant",
    noteFullLabel: "vollständige Bezeichnung: {label}",
    noteExistsIn: "existiert in: {place}",
    noteOwnDistance: "amtliche Achse ~{m} m entfernt",
    noteLock: "L{current} → erwartet L{expected}",
    fixAll: "Alle korrigieren ({n})",
    fix: "Korrigieren",
    fixTitle: "«{name}» übernehmen",
    confirmGroupFix: "«{name}» auf {n} Segmente anwenden?\nNichts wird automatisch gespeichert; in WME prüfen und speichern.",
    fixFailed: "Korrektur fehlgeschlagen: {error}",
    fixStopped: "{done}/{total} korrigiert, dann gestoppt: {error} (Segment {id})",
    allMatch: "Alle Strassennamen stimmen überein ✓",
    legendTitle: "Legende",
    legendCOSMETIC: "nur Typografie (Gross-/Kleinschreibung, Apostroph, Leerzeichen), gestrichelt",
    legendVARIANT: "Abkürzung, fehlender Akzent oder Artikel; amtliche Schreibweise vorgeschlagen",
    legendNEAR: "wahrscheinlicher Tippfehler; ein einziger naher amtlicher Name",
    legendWRONG_TYPE: "anderer oder fehlender Strassentyp (Weg ↔ Strasse, X → Strasse X); eindeutiger amtlicher Name vorgeschlagen",
    legendWRONG_STREET: "gültiger Name, aber die amtliche Strasse darunter heisst anders",
    geometryMatching: "Geometrie-Matching (amtliche Strasse unter dem Segment)",
    geometryMatchingTitle: "Aktiviert UNNAMED-Vorschläge, Falsche-Strasse-Erkennung und Distanz-Disambiguierung",
    viewportOnly: "Nur auf der Karte sichtbare Segmente anzeigen",
    viewportOnlyTitle: "Filtert Liste und Zähler auf den aktuell sichtbaren Bereich (ohne erneuten Scan)",
    editableOnly: "Nur bearbeitbare Segmente",
    editableOnlyTitle: "Über meinem Rang gesperrte Segmente ausblenden",
    legendWRONG_CITY: "Name existiert, aber in einer anderen Ortschaft (Scoping)",
    legendNOT_FOUND: "nicht im amtlichen Verzeichnis",
    legendUNNAMED: "geprüfter Strassentyp ohne Namen, gestrichelt",
    legendMICRO_SEGMENT: "befahrbares Segment kürzer als 5 m (Schweizer Regel; Kreisel ausgenommen)",
    legendLOOP: "Schleife aus weniger als 3 Segmenten (gleiche Endknoten); aufteilen",
    legendNARROW_MISUSE: "Falsch verwendete enge Strasse: Einbahn oder kürzer als 50 m",
    legendUNDER_LOCK: "Sperrstufe unter dem Schweizer Minimum für diesen Strassentyp",
    legendOVER_LOCK: "Sperrstufe über dem Schweizer Minimum (oft beabsichtigt)",
    guidelineChecks: "Schweizer Regelprüfungen (Mikrosegmente, Schleifen, enge Strassen)",
    guidelineChecksTitle: "Prüfungen aus den Editier-Richtlinien der Romandie, ohne externe Daten",
    helperOk: "stimmt mit dem amtlichen Verzeichnis überein",
    helperSetting: "Abweichungsbox im Segment-Bearbeitungspanel",
    settingsTitle: "Einstellungen",
    roadTypesLabel: "Geprüfte Strassentypen:",
    statusesLabel: "Geprüfte Fehlertypen:",
    optionsLabel: "Optionen",
    scopeDisplayLabel: "Geltungsbereich & Anzeige",
    altOk: "Alternativname zählt als OK",
    altOkTitle: "Nützlich in zweisprachigen Gemeinden mit der zweiten Sprache als Alternativname",
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
    shortcutNextIssue: "CH Names: nächste Abweichung auswählen",
    shortcutFixSelected: "CH Names: ausgewähltes Segment korrigieren",
    errNotFixable: "Nicht korrigierbar",
    errEditingNotAllowed: "Bearbeiten ist hier nicht erlaubt",
    errSegmentUnloaded: "Segment nicht mehr geladen",
    errNoCity: "Segment ohne Stadt; zuerst die Stadt setzen",
    errStreetCreate: "Strasse konnte nicht gefunden oder erstellt werden"
  };
  var it = {
    stateIdle: "In attesa",
    stateDisabled: "Script disattivato",
    stateOutsideCh: "Fuori dalla Svizzera",
    toggleEnabled: "Attivo",
    toggleEnabledTitle: "Interruttore generale: disattiva scansione, livello mappa e riquadro del pannello",
    toggleAutoScan: "Scansione auto",
    toggleAutoScanTitle: "Scansiona automaticamente al movimento della mappa; altrimenti usare Riscansiona",
    stateZoomGated: "Ingrandisci per scansionare",
    stateAreaGated: "Vista troppo ampia per la scansione",
    stateFetching: "Lettura del repertorio ufficiale…",
    stateEvaluating: "Confronto dei nomi…",
    statePaused: "In pausa (livello disattivato)",
    stateError: "Scansione fallita",
    updating: "Aggiornamento…",
    stateDone: "{issues} differenze · {ok} OK · {streets} strade ufficiali",
    unsavedBadge: "{n} non salvati",
    rescan: "Riscansiona",
    rescanTitle: "Svuota la cache e rilegge il repertorio ufficiale",
    nextIssue: "Prossima differenza",
    nextIssueTitle: "Seleziona il prossimo segmento con differenza",
    locateTitle: "Centra la mappa sul segmento",
    geoAdminLinkTitle: "Apri questo punto su map.geo.admin.ch (livello del repertorio ufficiale)",
    filterChipTitle: "Filtra l'elenco per questo stato",
    unnamed: "(senza nome)",
    noteUnofficial: "non ufficiale",
    notePlanned: "pianificata",
    noteFullLabel: "denominazione completa: {label}",
    noteExistsIn: "esiste a: {place}",
    noteOwnDistance: "asse ufficiale a ~{m} m",
    noteLock: "L{current} → atteso L{expected}",
    fixAll: "Correggi tutti ({n})",
    fix: "Correggi",
    fixTitle: "Applica «{name}»",
    confirmGroupFix: "Applicare «{name}» a {n} segmenti?\nNulla viene salvato automaticamente; rivedi e salva in WME.",
    fixFailed: "Correzione fallita: {error}",
    fixStopped: "{done}/{total} corretti, poi interrotto: {error} (segmento {id})",
    allMatch: "Tutti i nomi delle strade corrispondono ✓",
    legendTitle: "Legenda",
    legendCOSMETIC: "solo tipografia (maiuscole, apostrofo, spazi), linea tratteggiata",
    legendVARIANT: "abbreviazione, accento o articolo mancante; proposta la grafia ufficiale",
    legendNEAR: "probabile errore di battitura; un solo nome ufficiale vicino",
    legendWRONG_TYPE: "tipo di via diverso o mancante (Chemin ↔ Route, X → Via X); proposto il nome ufficiale unico",
    legendWRONG_STREET: "nome valido, ma la strada ufficiale sottostante ha un altro nome",
    geometryMatching: "Matching geometrico (strada ufficiale sotto il segmento)",
    geometryMatchingTitle: "Attiva i suggerimenti UNNAMED, il rilevamento di strada errata e la disambiguazione per distanza",
    viewportOnly: "Mostra solo i segmenti visibili sulla mappa",
    viewportOnlyTitle: "Filtra l'elenco e i contatori sull'area attualmente visibile (senza nuova scansione)",
    editableOnly: "Solo i segmenti modificabili",
    editableOnlyTitle: "Nascondi i segmenti bloccati oltre il mio livello di editor",
    legendWRONG_CITY: "il nome esiste, ma in un'altra località (scoping)",
    legendNOT_FOUND: "non presente nel repertorio ufficiale",
    legendUNNAMED: "tipo di strada verificato senza nome, linea tratteggiata",
    legendMICRO_SEGMENT: "segmento percorribile più corto di 5 m (regola svizzera; rotatorie escluse)",
    legendLOOP: "anello con meno di 3 segmenti (stessi nodi); da dividere",
    legendNARROW_MISUSE: "Strada stretta usata male: senso unico o meno di 50 m",
    legendUNDER_LOCK: "livello di blocco sotto il minimo svizzero per questo tipo di strada",
    legendOVER_LOCK: "livello di blocco sopra il minimo svizzero (spesso intenzionale)",
    guidelineChecks: "Controlli delle regole svizzere (micro-segmenti, anelli, strade strette)",
    guidelineChecksTitle: "Controlli dalle regole di editing della Svizzera romanda, senza dati esterni",
    helperOk: "corrisponde al repertorio ufficiale",
    helperSetting: "Riquadro differenze nel pannello di modifica del segmento",
    settingsTitle: "Impostazioni",
    roadTypesLabel: "Tipi di strada verificati:",
    statusesLabel: "Tipi di errore verificati:",
    optionsLabel: "Opzioni",
    scopeDisplayLabel: "Ambito e visualizzazione",
    altOk: "Nome alternativo corrispondente = OK",
    altOkTitle: "Utile nei comuni bilingui con la seconda lingua come nome alternativo",
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
    shortcutNextIssue: "CH Names: seleziona la prossima differenza",
    shortcutFixSelected: "CH Names: correggi il segmento selezionato",
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
  function getLocale() {
    return current;
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
    WRONG_STREET: { strokeColor: "#b71c1c", strokeDashstyle: "solid" },
    WRONG_CITY: { strokeColor: "#ff5ca8", strokeDashstyle: "solid" },
    NOT_FOUND: { strokeColor: "#e02020", strokeDashstyle: "solid" },
    UNNAMED: { strokeColor: "#9b59b6", strokeDashstyle: "dash" },
    UNDER_LOCK: { strokeColor: "#c2185b", strokeDashstyle: "dash" },
    MICRO_SEGMENT: { strokeColor: "#00bcd4", strokeDashstyle: "solid" },
    LOOP: { strokeColor: "#795548", strokeDashstyle: "solid" },
    NARROW_MISUSE: { strokeColor: "#3f51b5", strokeDashstyle: "dash" },
    OVER_LOCK: { strokeColor: "#90a4ae", strokeDashstyle: "dash" }
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
    sync(issues) {
      this.sdk.Map.removeAllFeaturesFromLayer({ layerName: LAYER_NAME });
      const features = [...issues.values()].map((issue) => ({
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

  // src/fix.ts
  var GROUP_FIX_CAP = 50;
  var GROUP_FIX_CONFIRM_THRESHOLD = 20;
  function formatFixError(outcome) {
    if (outcome.errorCode) return t(outcome.errorCode);
    return outcome.errorDetail ?? "?";
  }
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
      if (segment.primaryStreetId === street.id) return { segmentId, ok: true };
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
  async function fixGroup(sdk2, issues, settings, onProgress) {
    const outcomes = [];
    const batch = issues.slice(0, GROUP_FIX_CAP);
    for (const issue of batch) {
      const outcome = fixSegment(sdk2, issue, settings);
      outcomes.push(outcome);
      onProgress?.(outcomes.length, batch.length);
      if (!outcome.ok) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return outcomes;
  }
  var fixInFlight = false;
  function isFixInFlight() {
    return fixInFlight;
  }
  async function withFixLock(fn) {
    if (fixInFlight) return null;
    fixInFlight = true;
    try {
      return await fn();
    } finally {
      fixInFlight = false;
    }
  }

  // src/guidelines.ts
  var MIN_SEGMENT_LENGTH_M = 5;
  var MIN_NARROW_STREET_LENGTH_M = 50;
  var NARROW_STREET_TYPE = 22;
  var DRIVABLE_TYPES = /* @__PURE__ */ new Set([1, 2, 3, 4, 6, 7, 8, 17, 20, 22]);
  var EXPECTED_LOCK_BY_ROAD_TYPE = /* @__PURE__ */ new Map([
    [3, 5],
    // Freeway
    [6, 4],
    // Major Highway
    [7, 3],
    // Minor Highway
    [2, 2],
    // Primary Street
    [1, 1]
    // Street
  ]);
  function makeIssue(segment, status, getAddress, swissCountryId) {
    const address = getAddress(segment.id);
    if (swissCountryId !== null && address?.country && address.country.id !== swissCountryId) {
      return null;
    }
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
  function evaluateGuidelines(segments, getAddress, swissCountryId = null) {
    const issues = /* @__PURE__ */ new Map();
    const byNodePair = /* @__PURE__ */ new Map();
    for (const segment of segments) {
      if (!DRIVABLE_TYPES.has(segment.roadType)) continue;
      const isRoundabout = segment.junctionId !== null;
      if (!isRoundabout && segment.length < MIN_SEGMENT_LENGTH_M) {
        const issue = makeIssue(segment, "MICRO_SEGMENT", getAddress, swissCountryId);
        if (issue) issues.set(segment.id, issue);
      }
      if (segment.roadType === NARROW_STREET_TYPE && (isOneWay(segment) || segment.length < MIN_NARROW_STREET_LENGTH_M)) {
        if (!issues.has(segment.id)) {
          const issue = makeIssue(segment, "NARROW_MISUSE", getAddress, swissCountryId);
          if (issue) issues.set(segment.id, issue);
        }
      }
      const expectedLock = EXPECTED_LOCK_BY_ROAD_TYPE.get(segment.roadType);
      if (expectedLock !== void 0 && typeof segment.lockRank === "number" && segment.lockRank !== expectedLock && !issues.has(segment.id)) {
        const status = segment.lockRank < expectedLock ? "UNDER_LOCK" : "OVER_LOCK";
        const issue = makeIssue(segment, status, getAddress, swissCountryId);
        if (issue) {
          issue.note = { ...issue.note ?? {}, currentLock: segment.lockRank, expectedLock };
          issues.set(segment.id, issue);
        }
      }
      if (isRoundabout || segment.fromNodeId === null || segment.toNodeId === null) continue;
      if (segment.fromNodeId === segment.toNodeId) {
        const issue = makeIssue(segment, "LOOP", getAddress, swissCountryId);
        if (issue) issues.set(segment.id, issue);
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
        const issue = makeIssue(segment, "LOOP", getAddress, swissCountryId);
        if (issue) issues.set(segment.id, issue);
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
    { abbrev: "str", expansions: ["strasse"] },
    // multi-word expansions are supported (joined into the key as-is)
    { abbrev: "zi", expansions: ["zone industrielle"] },
    { abbrev: "za", expansions: ["zone artisanale"] },
    { abbrev: "gd", expansions: ["grand"] },
    { abbrev: "gde", expansions: ["grande"] },
    { abbrev: "all", expansions: ["allee"], firstTokenOnly: true },
    { abbrev: "esp", expansions: ["esplanade"], firstTokenOnly: true },
    { abbrev: "anc", expansions: ["ancien", "ancienne"] },
    { abbrev: "gen", expansions: ["general"] },
    { abbrev: "dr", expansions: ["docteur"] },
    { abbrev: "pt", expansions: ["petit"] },
    { abbrev: "pte", expansions: ["petite"] }
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
  var MULTI_WAY_TYPE_PREFIXES = [
    ["zone", "industrielle"],
    ["zone", "artisanale"],
    ["zone", "commerciale"],
    ["zona", "industriale"],
    ["zona", "artigianale"]
  ];
  function stemKey(key) {
    const tokens2 = key.split(" ");
    let rest = null;
    const first = tokens2[0];
    for (const prefix of MULTI_WAY_TYPE_PREFIXES) {
      if (tokens2.length > prefix.length && prefix.every((word, i) => tokens2[i] === word)) {
        rest = tokens2.slice(prefix.length);
        break;
      }
    }
    if (!rest && tokens2.length >= 2 && first !== void 0 && WAY_TYPE_WORDS.has(first)) {
      rest = tokens2.slice(1);
    } else if (tokens2.length === 1 && first !== void 0) {
      const m = first.match(GERMAN_SUFFIXES);
      if (m && m[1] !== void 0) rest = [m[1]];
    }
    if (!rest || rest.length === 0) return null;
    const cleaned = rest.filter((t2) => !ARTICLES.has(t2)).map((t2) => t2.replace(/^[ld]'/, ""));
    const stem = (cleaned.length > 0 ? cleaned : rest).join(" ");
    return stem.length >= 3 ? stem : null;
  }
  var ROUTE_DESIGNATION = /^[AENHT] ?\d{1,3}[a-z]?$/i;
  function isRouteDesignation(name) {
    const parts = name.split(/\s*[-/|]\s*/).filter((p) => p.length > 0);
    return parts.length > 0 && parts.every((part) => ROUTE_DESIGNATION.test(part.trim()));
  }
  function bareStem(key) {
    const stem = key.split(" ").filter((token) => !ARTICLES.has(token)).map((token) => token.replace(/^[ld]'/, "")).join(" ");
    return stem.length >= 3 ? stem : null;
  }
  function stripArticles(key) {
    const tokens2 = key.split(" ").filter((token) => !ARTICLES.has(token)).map((token) => token.replace(/^[ld]'/, ""));
    if (tokens2.length < 2) return null;
    const stripped = tokens2.join(" ");
    return stripped === key ? null : stripped;
  }
  function k2(name) {
    let s = k1(name);
    s = foldAccents(s);
    s = s.replace(/(\p{L}{2,})str\.?(?=$|\s|-)/gu, "$1strasse");
    s = s.replace(/\b(\p{L})\. ?(\p{L})\.(?=\s|$)/gu, "$1$2");
    s = s.replace(/-/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    const tokens2 = s.split(" ").filter((t2) => t2.length > 0);
    let variants = [[]];
    tokens2.forEach((token, i) => {
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
  function queryStem(primaryK2Key) {
    return stemKey(primaryK2Key) ?? bareStem(primaryK2Key);
  }
  function compareNameToCandidate(query, candidate) {
    if (k0(query) === k0(candidate)) return "exact";
    if (k1(query) === k1(candidate)) return "cosmetic";
    const queryKeys = k2(query);
    const candidateKeys = k2(candidate);
    if (queryKeys.some((key) => candidateKeys.includes(key))) return "variant";
    const q = queryKeys[0];
    const c = candidateKeys[0];
    if (q && c) {
      const maxDist = q.length < 8 ? 1 : 2;
      if (damerauLevenshtein(q, c, maxDist) <= maxDist) return "near";
      if (stemKey(q) || stemKey(c)) {
        const qs = queryStem(q);
        const cs = queryStem(c);
        if (qs && cs && qs === cs) return "stem";
      }
    }
    return null;
  }
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
    all = [];
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
          this.all.push(entry);
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
    /** Every indexed name (full labels and slash parts). */
    get list() {
      return this.all;
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
     * carries the SAME official name - two officials sharing a stem (e.g.
     * "Rue du Moulin" and "Route du Moulin") stay ambiguous and unmatched.
     */
    stemLookup(name, locality) {
      const primary = k2(name)[0];
      if (!primary) return null;
      const stem = queryStem(primary);
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

  // src/matching/spatial.ts
  var M_PER_DEG_LAT = 110574;
  var M_PER_DEG_LON_EQUATOR = 111320;
  var GRID_DEG = 1e-3;
  var NEAR_STREET_M = 25;
  var SUGGEST_MAX_M = 20;
  var FAR_STREET_M = 40;
  var MAX_BEARING_DIFF_RAD = 35 * Math.PI / 180;
  var MIN_COVERAGE = 0.6;
  var CONTEST_MARGIN_M = 5;
  var WRONG_STREET_MIN_COVERAGE = 0.8;
  function distancePointToSegmentM(p, a, b) {
    const lonScale = M_PER_DEG_LON_EQUATOR * Math.cos(p[1] * Math.PI / 180);
    const px = p[0] * lonScale;
    const py = p[1] * M_PER_DEG_LAT;
    const ax = a[0] * lonScale;
    const ay = a[1] * M_PER_DEG_LAT;
    const bx = b[0] * lonScale;
    const by = b[1] * M_PER_DEG_LAT;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    let t2 = 0;
    if (lengthSq > 0) {
      t2 = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
    }
    const cx = ax + t2 * dx;
    const cy = ay + t2 * dy;
    return Math.hypot(px - cx, py - cy);
  }
  function bearingOf(a, b) {
    const lonScale = Math.cos(a[1] * Math.PI / 180);
    const dx = (b[0] - a[0]) * lonScale;
    const dy = b[1] - a[1];
    const angle = Math.atan2(dy, dx);
    return (angle % Math.PI + Math.PI) % Math.PI;
  }
  function bearingDiff(b1, b2) {
    const d = Math.abs(b1 - b2) % Math.PI;
    return Math.min(d, Math.PI - d);
  }
  var SpatialIndex = class {
    grid = /* @__PURE__ */ new Map();
    size;
    /** Only full-label entries are indexed (slash parts share the same geometry). */
    constructor(entries) {
      let count = 0;
      for (const entry of entries) {
        if (entry.isSlashPart) continue;
        const lines = entry.street.lines;
        if (!lines) continue;
        for (const line of lines) {
          for (let i = 0; i + 1 < line.length; i++) {
            const a = line[i];
            const b = line[i + 1];
            count++;
            const seg = { entry, a, b, bearing: bearingOf(a, b) };
            const x0 = Math.floor(Math.min(a[0], b[0]) / GRID_DEG);
            const x1 = Math.floor(Math.max(a[0], b[0]) / GRID_DEG);
            const y0 = Math.floor(Math.min(a[1], b[1]) / GRID_DEG);
            const y1 = Math.floor(Math.max(a[1], b[1]) / GRID_DEG);
            for (let x = x0; x <= x1; x++) {
              for (let y = y0; y <= y1; y++) {
                const key = `${x}:${y}`;
                const cell = this.grid.get(key);
                if (cell) cell.push(seg);
                else this.grid.set(key, [seg]);
              }
            }
          }
        }
      }
      this.size = count;
    }
    /**
     * All streets within maxMeters of the point (one minimal distance per street),
     * restricted to sub-segments roughly parallel to `bearing` when provided.
     */
    candidatesAt(point, maxMeters, bearing) {
      const cx = Math.floor(point[0] / GRID_DEG);
      const cy = Math.floor(point[1] / GRID_DEG);
      const byEsid = /* @__PURE__ */ new Map();
      for (let x = cx - 1; x <= cx + 1; x++) {
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (const seg of this.grid.get(`${x}:${y}`) ?? []) {
            if (bearing !== void 0 && bearingDiff(seg.bearing, bearing) > MAX_BEARING_DIFF_RAD) {
              continue;
            }
            const d = distancePointToSegmentM(point, seg.a, seg.b);
            if (d > maxMeters) continue;
            const esid = seg.entry.street.esid;
            const known = byEsid.get(esid);
            if (!known || d < known.distanceM) byEsid.set(esid, { entry: seg.entry, distanceM: d });
          }
        }
      }
      return byEsid;
    }
  };
  var SAMPLE_FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
  function sampleWithBearings(geometry) {
    const coords = geometry.coordinates;
    if (coords.length === 0) return [];
    if (coords.length === 1) return [{ point: coords[0], bearing: null }];
    const lonScale = Math.cos(coords[0][1] * Math.PI / 180);
    const planar = (a, b) => Math.hypot((b[0] - a[0]) * lonScale, b[1] - a[1]);
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulative.push(
        cumulative[i - 1] + planar(coords[i - 1], coords[i])
      );
    }
    const total = cumulative[cumulative.length - 1];
    if (total === 0) return [{ point: coords[0], bearing: null }];
    const fractions = coords.length === 2 ? [0.5] : SAMPLE_FRACTIONS;
    return fractions.map((fraction) => {
      const target = fraction * total;
      let i = 1;
      while (i < cumulative.length - 1 && cumulative[i] < target) i++;
      const before = cumulative[i - 1];
      const stepLength = cumulative[i] - before;
      const t2 = stepLength > 0 ? (target - before) / stepLength : 0;
      const a = coords[i - 1];
      const b = coords[i];
      return {
        point: [
          a[0] + (b[0] - a[0]) * t2,
          a[1] + (b[1] - a[1]) * t2
        ],
        bearing: stepLength > 0 || planar(a, b) > 0 ? bearingOf(a, b) : null
      };
    });
  }
  function samplePoints(geometry) {
    return sampleWithBearings(geometry).map((sample) => sample.point);
  }
  function nearestOfficial(geometry, index, maxMeters = NEAR_STREET_M) {
    const samples = sampleWithBearings(geometry);
    if (samples.length === 0) return null;
    const tallies = /* @__PURE__ */ new Map();
    for (const sample of samples) {
      const candidates = index.candidatesAt(sample.point, maxMeters, sample.bearing ?? void 0);
      let best = null;
      for (const [esid, { entry, distanceM }] of candidates) {
        let tally = tallies.get(esid);
        if (!tally) {
          tally = { entry, wins: 0, presence: 0, minD: Infinity };
          tallies.set(esid, tally);
        }
        tally.presence++;
        tally.minD = Math.min(tally.minD, distanceM);
        if (!best || distanceM < best.d) best = { esid, d: distanceM };
      }
      if (best) tallies.get(best.esid).wins++;
    }
    let winner = null;
    for (const tally of tallies.values()) {
      if (!winner || tally.wins > winner.wins || tally.wins === winner.wins && tally.minD < winner.minD) {
        winner = tally;
      }
    }
    if (!winner || winner.wins === 0) return null;
    const coverage = winner.wins / samples.length;
    if (coverage < MIN_COVERAGE) return null;
    for (const tally of tallies.values()) {
      if (tally === winner) continue;
      if (tally.presence >= 2 && tally.minD - winner.minD < CONTEST_MARGIN_M) return null;
    }
    return { entry: winner.entry, distanceM: winner.minD, coverage };
  }
  function distanceToLinesM(geometry, lines) {
    let min = Infinity;
    for (const point of samplePoints(geometry)) {
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          min = Math.min(min, distancePointToSegmentM(point, line[i], line[i + 1]));
        }
      }
    }
    return min;
  }
  function distanceToEntryM(geometry, entry) {
    const lines = entry.street.lines;
    if (!lines) return Infinity;
    return distanceToLinesM(geometry, lines);
  }

  // src/matching/evaluate.ts
  var HIGHWAY_ROAD_TYPES = /* @__PURE__ */ new Set([3, 4, 6, 7]);
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
  function evaluateSegment(segment, address, index, settings, nearest = null, swissCountryId = null) {
    if (!settings.checkedRoadTypes.includes(segment.roadType)) return { kind: "skipped" };
    if (swissCountryId !== null && address.country && address.country.id !== swissCountryId) {
      return { kind: "skipped" };
    }
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
      const suggestion = nearest && nearest.distanceM <= SUGGEST_MAX_M ? nearest.entry : null;
      return {
        kind: "issue",
        issue: {
          ...baseIssue,
          status: "UNNAMED",
          suggestion: suggestion?.namePart ?? null,
          note: suggestion ? noteFor(suggestion) : null,
          fixable: suggestion !== null
        }
      };
    }
    if (HIGHWAY_ROAD_TYPES.has(segment.roadType) && isRouteDesignation(currentName)) {
      return { kind: "ok" };
    }
    const locality = settings.cityScoping !== "off" && address.city?.name ? k1(address.city.name) : void 0;
    const match = index.lookup(currentName, locality);
    if (match) {
      const ownDistanceM = nearest && nearest.distanceM <= SUGGEST_MAX_M ? Math.min(...match.candidates.map((c) => distanceToEntryM(segment.geometry, c))) : Infinity;
      if (nearest && nearest.distanceM <= SUGGEST_MAX_M && nearest.coverage >= WRONG_STREET_MIN_COVERAGE && k1(nearest.entry.namePart) !== k1(currentName) && !nearest.entry.street.label.includes(currentName) && ownDistanceM > FAR_STREET_M) {
        return {
          kind: "issue",
          issue: {
            ...baseIssue,
            status: "WRONG_STREET",
            suggestion: nearest.entry.namePart,
            note: {
              ...noteFor(nearest.entry) ?? {},
              existsIn: match.entry.street.zipLabel,
              // review aid: how far the current name's own axis really is
              ...Number.isFinite(ownDistanceM) ? { ownDistanceM: Math.round(ownDistanceM) } : {}
            },
            fixable: true
          }
        };
      }
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
    if (nearest && nearest.distanceM <= SUGGEST_MAX_M) {
      const level = compareNameToCandidate(currentName, nearest.entry.namePart);
      if (level && level !== "exact") {
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
            status: statusByLevel[level],
            suggestion: nearest.entry.namePart,
            note: noteFor(nearest.entry),
            fixable: true
          }
        };
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

  // src/scan.ts
  var CH_BBOX = [5.9, 45.8, 10.6, 47.9];
  function intersectsSwitzerland(bbox) {
    return bbox[0] <= CH_BBOX[2] && bbox[2] >= CH_BBOX[0] && bbox[1] <= CH_BBOX[3] && bbox[3] >= CH_BBOX[1];
  }
  function isEditableByRank(lockRank, userRank) {
    return userRank === null || userRank >= lockRank;
  }
  var DEBOUNCE_MS = 800;
  var BBOX_PADDING_RATIO = 0.2;
  var MAX_AREA_KM2 = 6;
  var CONTINUATION_MAX_M = 3e3;
  var CONTINUATION_ROAD_TYPES = /* @__PURE__ */ new Set([2, 3, 6, 7]);
  var MAX_CONTINUATION_LOOKUPS_PER_RUN = 10;
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
  var Scanner = class _Scanner {
    constructor(sdk2, fetcher, settings) {
      this.sdk = sdk2;
      this.fetcher = fetcher;
      this.settings = settings;
    }
    sdk;
    fetcher;
    settings;
    generation = 0;
    evalGeneration = 0;
    controller = null;
    debounceTimer;
    reevalTimer;
    lastIndex = null;
    lastSpatialIndex = null;
    /** Tile keys covered by lastIndex; segments outside are not name-checked. */
    coveredTiles = null;
    /** Session cache: street name -> nationwide official axis polylines (or null). */
    nameLinesCache = /* @__PURE__ */ new Map();
    /** Resolved once; null = not found (guard disabled), undefined = not tried yet. */
    swissCountryId;
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
    /** Until this timestamp, map-move events do not trigger an auto-scan
     *  (script-initiated navigation must not wipe the editor's working list). */
    suppressAutoScanUntil = 0;
    start() {
      const onMove = () => {
        if (Date.now() < this.suppressAutoScanUntil) return;
        const s = this.settings.get();
        if (!s.enabled || !s.autoScan) return;
        this.requestScan();
      };
      this.sdk.Events.on({ eventName: "wme-map-move-end", eventHandler: onMove });
      this.sdk.Events.on({ eventName: "wme-map-data-loaded", eventHandler: onMove });
      this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.reevaluate() });
      this.sdk.Events.on({ eventName: "wme-save-finished", eventHandler: () => this.reevaluate() });
      this.requestScan();
    }
    /** Ignore auto-scan triggers for a short while (script-driven map moves). */
    suppressAutoScan(ms = 1500) {
      this.suppressAutoScanUntil = Date.now() + ms;
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
      this.fetcher.clearAll();
      this.lastIndex = null;
      this.lastSpatialIndex = null;
      this.coveredTiles = null;
      this.requestScan();
    }
    /** Disable everything: abort, clear results, publish the disabled state. */
    disable() {
      this.controller?.abort();
      clearTimeout(this.debounceTimer);
      this.publish({ state: "disabled", issues: /* @__PURE__ */ new Map(), progress: null });
    }
    /**
     * Re-run evaluation against the last fetched official index, without
     * refetching. Debounced: wme-after-edit fires on EVERY WME edit (including
     * plain node moves) and a full synchronous re-evaluation per edit was the
     * main source of perceived jank while editing.
     */
    reevaluate() {
      if (isFixInFlight()) return;
      clearTimeout(this.reevalTimer);
      this.reevalTimer = setTimeout(() => {
        const index = this.lastIndex;
        if (isFixInFlight() || this.paused || !this.settings.get().enabled || !index) return;
        void this.runEvaluation(index).then((completed) => {
          if (completed) this.publish({ state: "done" });
        });
      }, 300);
    }
    async scan() {
      if (this.paused) return;
      if (!this.settings.get().enabled) {
        this.disable();
        return;
      }
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
        if (!intersectsSwitzerland(bbox)) {
          this.publish({ state: "outside-ch", issues: /* @__PURE__ */ new Map(), progress: null });
          return;
        }
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
        this.lastSpatialIndex = new SpatialIndex(index.list);
        this.coveredTiles = new Set(tileKeysForBbox(bbox));
        const completed = await this.runEvaluation(index);
        if (!completed || gen !== this.generation) return;
        this.publish({ state: "done", officialStreetCount: index.streetCount });
      } catch (err) {
        if (controller.signal.aborted || gen !== this.generation) return;
        log.error("Scan failed", err);
        this.publish({ state: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
    /**
     * Identify Switzerland in the loaded countries, by abbreviation or name in
     * any of the national languages. Resolved lazily and cached; null disables
     * the foreign-segment guard rather than excluding everything.
     */
    resolveSwissCountryId() {
      if (this.swissCountryId !== void 0) return this.swissCountryId;
      try {
        const swiss = this.sdk.DataModel.Countries.getAll().find((country) => {
          const abbr = (country.abbr ?? "").toUpperCase();
          const name = (country.name ?? "").toLowerCase();
          return abbr === "CH" || abbr === "CHE" || name === "switzerland" || name === "schweiz" || name === "suisse" || name === "svizzera";
        });
        this.swissCountryId = swiss ? swiss.id : null;
        if (this.swissCountryId === null) {
          log.warn("Switzerland not found in the countries data model; country guard disabled");
        }
      } catch {
        this.swissCountryId = null;
      }
      return this.swissCountryId;
    }
    /** Chunk size: keeps every main-thread task short while panning WME. */
    static EVAL_CHUNK = 250;
    /**
     * Evaluate all loaded segments in chunks, yielding to the event loop between
     * chunks. Returns false when superseded by a newer evaluation.
     */
    async runEvaluation(index) {
      const gen = ++this.evalGeneration;
      const settings = this.settings.get();
      const issues = /* @__PURE__ */ new Map();
      const stats = { ok: 0, okAlt: 0, skipped: 0, total: 0 };
      const allSegments = this.sdk.DataModel.Segments.getAll();
      const userRank = settings.editableOnly ? this.sdk.State.getUserInfo()?.rank ?? null : null;
      const segments = userRank === null ? allSegments : allSegments.filter((seg) => isEditableByRank(seg.lockRank, userRank));
      const spatial = settings.geometryMatching ? this.lastSpatialIndex : null;
      const swissCountryId = this.resolveSwissCountryId();
      for (let i = 0; i < segments.length; i++) {
        if (i > 0 && i % _Scanner.EVAL_CHUNK === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          if (gen !== this.evalGeneration) return false;
        }
        const segment = segments[i];
        stats.total++;
        if (!this.isCovered(segment)) {
          stats.skipped++;
          continue;
        }
        let verdict;
        try {
          const address = this.sdk.DataModel.Segments.getAddress({ segmentId: segment.id });
          const nearest = spatial && settings.checkedRoadTypes.includes(segment.roadType) ? nearestOfficial(segment.geometry, spatial) : null;
          verdict = evaluateSegment(segment, address, index, settings, nearest, swissCountryId);
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
            if (settings.enabledStatuses.includes(verdict.issue.status)) {
              issues.set(verdict.issue.segmentId, verdict.issue);
            } else {
              stats.skipped++;
            }
            break;
        }
      }
      if (!await this.reclassifyContinuations(issues, stats, gen)) return false;
      if (gen !== this.evalGeneration) return false;
      if (settings.guidelineChecks) {
        const getAddress = (segmentId) => {
          try {
            return this.sdk.DataModel.Segments.getAddress({ segmentId });
          } catch {
            return null;
          }
        };
        for (const issue of evaluateGuidelines(segments, getAddress, swissCountryId)) {
          if (!issues.has(issue.segmentId) && settings.enabledStatuses.includes(issue.status)) {
            issues.set(issue.segmentId, issue);
          }
        }
      }
      this.publish({ issues, stats, unsavedCount: this.safeUnsavedCount() });
      return true;
    }
    /**
     * Out-of-locality continuations: a NOT_FOUND name on a main road is accepted
     * when an official axis with the exact same name exists within 3 km, e.g.
     * "Route de Berne" between Payerne (where the register entry lives) and
     * Corcelles-près-Payerne (out of town, no register entry).
     * Returns false when superseded by a newer evaluation.
     */
    async reclassifyContinuations(issues, stats, gen) {
      let lookups = 0;
      for (const issue of [...issues.values()]) {
        if (issue.status !== "NOT_FOUND" || !issue.currentName) continue;
        if (!CONTINUATION_ROAD_TYPES.has(issue.roadType)) continue;
        let lines = this.nameLinesCache.get(issue.currentName);
        if (lines === void 0) {
          if (lookups >= MAX_CONTINUATION_LOOKUPS_PER_RUN) continue;
          lookups++;
          try {
            lines = await findStreetLinesByName(issue.currentName, this.controller?.signal);
          } catch {
            continue;
          }
          if (gen !== this.evalGeneration) return false;
          this.nameLinesCache.set(issue.currentName, lines);
        }
        if (lines && distanceToLinesM(issue.geometry, lines) <= CONTINUATION_MAX_M) {
          issues.delete(issue.segmentId);
          stats.ok++;
        }
      }
      return true;
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

  // src/shortcuts.ts
  function registerShortcuts(sdk2, scanner, settings, actions) {
    const create = (shortcutId, description, keys, callback) => {
      try {
        sdk2.Shortcuts.createShortcut({ shortcutId, description, shortcutKeys: keys, callback });
      } catch (err) {
        log.warn(`Shortcut keys "${keys}" unavailable for ${shortcutId}; registering unbound`, err);
        try {
          sdk2.Shortcuts.createShortcut({ shortcutId, description, shortcutKeys: null, callback });
        } catch {
        }
      }
    };
    create("chk-next-issue", t("shortcutNextIssue"), "A+n", () => {
      if (settings.get().enabled) actions.nextIssue();
    });
    create("chk-fix-selected", t("shortcutFixSelected"), "A+f", () => {
      if (!settings.get().enabled) return;
      const selection = sdk2.Editing.getSelection();
      if (selection?.objectType !== "segment" || selection.ids.length !== 1) return;
      const issue = scanner.getSnapshot().issues.get(selection.ids[0]);
      if (!issue?.fixable) return;
      void withFixLock(async () => fixSegment(sdk2, issue, settings.get())).then((result) => {
        if (result !== null) scanner.reevaluate();
      });
    });
  }

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
  var ALL_STATUSES = [
    "COSMETIC",
    "VARIANT",
    "NEAR",
    "WRONG_TYPE",
    "WRONG_STREET",
    "WRONG_CITY",
    "NOT_FOUND",
    "UNNAMED",
    "UNDER_LOCK",
    "MICRO_SEGMENT",
    "LOOP",
    "NARROW_MISUSE",
    "OVER_LOCK"
  ];
  var DEFAULT_SETTINGS = {
    version: 2,
    enabled: true,
    autoScan: true,
    minZoom: 15,
    checkedRoadTypes: ROAD_TYPE_OPTIONS.filter((r) => r.defaultChecked).map((r) => r.id),
    enabledStatuses: [...ALL_STATUSES],
    altNameCountsAsOk: true,
    cityScoping: "off",
    showMapLabels: true,
    keepOldNameAsAlt: false,
    language: "auto",
    guidelineChecks: true,
    editPanelHelper: true,
    geometryMatching: true,
    viewportOnly: true,
    editableOnly: false
  };
  var STORAGE_KEY = "wme-ch-name-check.settings";
  function migrateSettings(parsed) {
    if (parsed.version === 1) {
      const legacy = parsed;
      const enabledStatuses = legacy.showCosmetic === false ? ALL_STATUSES.filter((status) => status !== "COSMETIC") : [...ALL_STATUSES];
      return { ...DEFAULT_SETTINGS, ...parsed, version: 2, enabledStatuses };
    }
    if (parsed.version !== 2) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...parsed, version: 2 };
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      return migrateSettings(JSON.parse(raw));
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

  // src/geoadmin/links.ts
  function wgs84ToLv95(lon, lat) {
    const phi = (lat * 3600 - 169028.66) / 1e4;
    const lambda = (lon * 3600 - 26782.5) / 1e4;
    const e = 260007237e-2 + 211455.93 * lambda - 10938.51 * lambda * phi - 0.36 * lambda * phi * phi - 44.54 * lambda * lambda * lambda;
    const n = 120014707e-2 + 308807.95 * phi + 3745.25 * lambda * lambda + 76.63 * phi * phi - 194.56 * lambda * lambda * phi + 119.79 * phi * phi * phi;
    return { e, n };
  }
  var REGISTER_LAYER = "ch.swisstopo.amtliches-strassenverzeichnis";
  function mapGeoAdminUrl(lon, lat, locale) {
    const { e, n } = wgs84ToLv95(lon, lat);
    const params = new URLSearchParams({
      lang: locale,
      E: e.toFixed(1),
      N: n.toFixed(1),
      zoom: "11",
      layers: REGISTER_LAYER
    });
    return `https://map.geo.admin.ch/?${params.toString()}`;
  }
  function mapGeoAdminUrlForGeometry(geometry, locale) {
    const points = samplePoints(geometry);
    const mid = points[Math.floor(points.length / 2)] ?? [0, 0];
    return mapGeoAdminUrl(mid[0], mid[1], locale);
  }

  // src/ui/styles.ts
  var statusChipRules = Object.keys(STATUS_STYLES).map(
    (status) => `
.chk-badge-${status} { background: ${STATUS_STYLES[status].strokeColor}; }`
  ).join("\n");
  var tokens = `
.chk-pane, .chk-helper {
  --chk-bg: var(--wz-color-background, #ffffff);
  --chk-surface: var(--wz-color-background-variant, #f4f6f8);
  --chk-text: var(--wz-color-on-background, #1b1d20);
  --chk-muted: var(--wz-color-on-background-variant, #6b7280);
  --chk-border: var(--wz-color-hairline, #d9dde2);
  --chk-primary: var(--wz-color-primary, #2b5fa4);
  --chk-primary-contrast: var(--wz-color-on-primary, #ffffff);
  --chk-info-bg: rgba(43, 95, 164, .10);
  --chk-ok: #3f8a32;
  --chk-error: #c0392b;
  --chk-radius: 8px;
}
html.chk-theme-dark .chk-pane, html.chk-theme-dark .chk-helper {
  --chk-bg: var(--wz-color-background, #1f2226);
  --chk-surface: var(--wz-color-background-variant, #2a2e33);
  --chk-text: var(--wz-color-on-background, #e6e8eb);
  --chk-muted: var(--wz-color-on-background-variant, #9aa1aa);
  --chk-border: var(--wz-color-hairline, #3a3f45);
  --chk-primary: var(--wz-color-primary, #5b9bd5);
  --chk-info-bg: rgba(91, 155, 213, .16);
  --chk-ok: #6cc05a;
  --chk-error: #e57368;
}`;
  var CSS = `
${tokens}

.chk-pane { font-size: 12px; padding: 8px; display: flex; flex-direction: column; gap: 10px; color: var(--chk-text); }
.chk-pane button { cursor: pointer; font-family: inherit; }
.chk-pane label { display: flex; align-items: center; gap: 5px; font-weight: normal; cursor: pointer; }
.chk-pane select, .chk-pane input[type="number"] { background: var(--chk-bg); color: var(--chk-text); border: 1px solid var(--chk-border); border-radius: 5px; padding: 2px 5px; font-size: 11px; }
.chk-pane input[type="checkbox"] { accent-color: var(--chk-primary); }

.chk-brand { display: flex; align-items: center; gap: 8px; }
.chk-brand-icon { font-size: 16px; line-height: 1; }
.chk-brand-title { font-weight: bold; font-size: 14px; color: var(--chk-text); }
.chk-brand-version { margin-left: auto; font-size: 11px; color: var(--chk-muted); }

.chk-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chk-btn { font-size: 11px; padding: 4px 10px; border: 1px solid var(--chk-border); border-radius: 6px; background: var(--chk-surface); color: var(--chk-text); }
.chk-btn:hover { border-color: var(--chk-primary); color: var(--chk-primary); }
.chk-unsaved { color: #b35c00; font-weight: bold; font-size: 11px; margin-left: auto; }

.chk-banner { padding: 7px 10px; border-radius: var(--chk-radius); background: var(--chk-info-bg); color: var(--chk-text); }
.chk-banner.chk-banner-ok { background: rgba(63, 138, 50, .16); color: var(--chk-ok); font-weight: 600; }
.chk-banner.chk-error { background: rgba(192, 57, 43, .16); color: var(--chk-error); font-weight: 600; }

.chk-master { display: flex; gap: 18px; flex-wrap: wrap; padding: 8px 10px; background: var(--chk-surface); border: 1px solid var(--chk-border); border-radius: var(--chk-radius); }

.chk-switch { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.chk-switch input { position: absolute; opacity: 0; width: 0; height: 0; }
.chk-switch-track { position: relative; flex: 0 0 auto; width: 34px; height: 20px; border-radius: 10px; background: var(--chk-border); transition: background .15s; }
.chk-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.35); transition: transform .15s; }
.chk-switch input:checked + .chk-switch-track { background: var(--chk-primary); }
.chk-switch input:checked + .chk-switch-track .chk-switch-knob { transform: translateX(14px); }
.chk-switch input:focus-visible + .chk-switch-track { outline: 2px solid var(--chk-primary); outline-offset: 2px; }
.chk-switch-label { font-size: 12px; }

.chk-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chk-chip { display: inline-flex; align-items: center; border: 1px solid var(--chk-border); border-radius: 12px; padding: 2px 9px; background: var(--chk-surface); color: var(--chk-text); font-size: 11px; }
.chk-chip:hover { border-color: var(--chk-primary); }
.chk-chip.chk-chip-active { border-color: var(--chk-primary); background: var(--chk-info-bg); color: var(--chk-primary); font-weight: 600; }
.chk-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; flex-shrink: 0; }

.chk-list { position: relative; display: flex; flex-direction: column; gap: 10px; }
.chk-list.chk-busy-active { min-height: 90px; }
.chk-busy { position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 8px; z-index: 5; border-radius: var(--chk-radius); background: color-mix(in srgb, var(--chk-bg) 55%, transparent); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
.chk-list.chk-busy-active .chk-busy { display: flex; }
.chk-spinner { width: 26px; height: 26px; border: 3px solid var(--chk-border); border-top-color: var(--chk-primary); border-radius: 50%; animation: chk-spin .8s linear infinite; }
.chk-busy-text { font-size: 12px; font-weight: 600; color: var(--chk-text); }
@keyframes chk-spin { to { transform: rotate(360deg); } }

.chk-groups { display: flex; flex-direction: column; gap: 5px; max-height: 48vh; overflow-y: auto; }
.chk-group { flex-shrink: 0; border: 1px solid var(--chk-border); border-radius: var(--chk-radius); background: var(--chk-surface); }
.chk-group-header { display: flex; align-items: center; gap: 6px; padding: 5px 8px; cursor: pointer; }
.chk-group-header:hover { background: var(--chk-info-bg); }
.chk-badge { display: inline-block; min-width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
${statusChipRules}
.chk-group-names { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.chk-arrow { color: var(--chk-muted); }
.chk-suggestion { font-weight: bold; color: var(--chk-primary); }
.chk-note { color: var(--chk-muted); font-style: italic; }
.chk-count { color: var(--chk-muted); background: var(--chk-bg); border: 1px solid var(--chk-border); border-radius: 9px; padding: 0 6px; font-size: 10px; }
.chk-fix-all { font-size: 11px; padding: 3px 9px; border: none; border-radius: 6px; background: var(--chk-primary); color: var(--chk-primary-contrast); white-space: nowrap; flex-shrink: 0; }
.chk-fix-all:hover { filter: brightness(1.08); }
.chk-fix-all:disabled { opacity: .6; cursor: default; }

.chk-rows { border-top: 1px solid var(--chk-border); }
.chk-row { display: flex; align-items: center; gap: 6px; padding: 3px 8px 3px 16px; cursor: pointer; }
.chk-row:hover { background: var(--chk-info-bg); }
.chk-row.chk-selected { background: var(--chk-info-bg); box-shadow: inset 2px 0 0 var(--chk-primary); }
.chk-row-meta { color: var(--chk-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chk-locate { font-size: 13px; line-height: 1; padding: 0 5px; background: transparent; border: none; color: var(--chk-text); flex-shrink: 0; }
.chk-locate:hover { color: var(--chk-primary); }
a.chk-geolink { text-decoration: none; border: 1px solid var(--chk-border); border-radius: 4px; padding: 0 5px; color: var(--chk-primary); background: var(--chk-bg); flex-shrink: 0; }

.chk-section { border: 1px solid var(--chk-border); border-radius: var(--chk-radius); background: var(--chk-surface); overflow: hidden; }
.chk-section > summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; font-weight: bold; cursor: pointer; list-style: none; color: var(--chk-text); }
.chk-section > summary::-webkit-details-marker { display: none; }
.chk-section > summary::after { content: "▸"; margin-left: auto; color: var(--chk-muted); transition: transform .15s; }
.chk-section[open] > summary::after { transform: rotate(90deg); }
.chk-section[open] > summary { border-bottom: 1px solid var(--chk-border); }
.chk-section-icon { font-size: 14px; line-height: 1; }
.chk-section-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }

.chk-subsection { border-top: 1px solid var(--chk-border); }
.chk-subsection:first-child { border-top: none; }
.chk-subsection > summary { display: flex; align-items: center; gap: 6px; padding: 6px 0; font-weight: 600; cursor: pointer; list-style: none; color: var(--chk-text); }
.chk-subsection > summary::-webkit-details-marker { display: none; }
.chk-subsection > summary::after { content: "▸"; margin-left: auto; color: var(--chk-muted); transition: transform .15s; }
.chk-subsection[open] > summary::after { transform: rotate(90deg); }
.chk-subsection-body { padding: 4px 0 8px; display: flex; flex-direction: column; gap: 6px; }

.chk-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; margin: 2px 0; }
.chk-settings-row { display: flex; align-items: center; gap: 8px; }
.chk-settings-label { font-weight: 600; }

.chk-empty { color: var(--chk-ok); font-weight: bold; padding: 10px 0; text-align: center; }
.chk-muted { color: var(--chk-muted); }
.chk-error { color: var(--chk-error); }
.chk-footer { font-size: 11px; border-top: 1px solid var(--chk-border); padding-top: 6px; color: var(--chk-muted); }
.chk-footer a { color: var(--chk-primary); }

.chk-helper { margin: 8px; padding: 8px 10px; border: 1px solid var(--chk-border); border-radius: var(--chk-radius); font-size: 12px; background: var(--chk-surface); color: var(--chk-text); display: flex; flex-direction: column; gap: 6px; }
.chk-helper-head { display: flex; align-items: center; gap: 6px; }
.chk-helper-sug { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chk-helper button { cursor: pointer; }
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
    WRONG_STREET: "legendWRONG_STREET",
    WRONG_CITY: "legendWRONG_CITY",
    NOT_FOUND: "legendNOT_FOUND",
    UNNAMED: "legendUNNAMED",
    UNDER_LOCK: "legendUNDER_LOCK",
    MICRO_SEGMENT: "legendMICRO_SEGMENT",
    LOOP: "legendLOOP",
    NARROW_MISUSE: "legendNARROW_MISUSE",
    OVER_LOCK: "legendOVER_LOCK"
  };
  var STATE_KEYS = {
    idle: "stateIdle",
    disabled: "stateDisabled",
    "outside-ch": "stateOutsideCh",
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
  function wmeThemeIsDark(start) {
    let node = start;
    while (node) {
      const match = getComputedStyle(node).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (match && match[1]) {
        const parts = match[1].split(",").map((p) => parseFloat(p));
        const r = parts[0] ?? 0;
        const g = parts[1] ?? 0;
        const b = parts[2] ?? 0;
        const a = parts[3] ?? 1;
        if (a > 0) return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
      }
      node = node.parentElement;
    }
    return false;
  }
  function formatNote(note) {
    if (!note) return "";
    const parts = [];
    if (note.unofficial) parts.push(t("noteUnofficial"));
    if (note.planned) parts.push(t("notePlanned"));
    if (note.fullLabel) parts.push(t("noteFullLabel", { label: note.fullLabel }));
    if (note.existsIn) parts.push(t("noteExistsIn", { place: note.existsIn }));
    if (note.ownDistanceM !== void 0) parts.push(t("noteOwnDistance", { m: note.ownDistanceM }));
    if (note.currentLock !== void 0 && note.expectedLock !== void 0) {
      parts.push(t("noteLock", { current: note.currentLock, expected: note.expectedLock }));
    }
    return parts.join(", ");
  }
  var SEVERITY_ORDER = {
    COSMETIC: 0,
    VARIANT: 1,
    NEAR: 2,
    WRONG_TYPE: 3,
    WRONG_STREET: 4,
    WRONG_CITY: 5,
    NOT_FOUND: 6,
    UNNAMED: 7,
    UNDER_LOCK: 8,
    MICRO_SEGMENT: 9,
    LOOP: 10,
    NARROW_MISUSE: 11,
    OVER_LOCK: 12
  };
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
    return [...groups.values()].sort(
      (a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status] || b.issues.length - a.issues.length
    );
  }
  function geometryIntersectsBbox(geometry, bbox) {
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const point of geometry.coordinates) {
      const lon = point[0];
      const lat = point[1];
      minLon = Math.min(minLon, lon);
      minLat = Math.min(minLat, lat);
      maxLon = Math.max(maxLon, lon);
      maxLat = Math.max(maxLat, lat);
    }
    if (!Number.isFinite(minLon)) return false;
    return minLon <= bbox[2] && maxLon >= bbox[0] && minLat <= bbox[3] && maxLat >= bbox[1];
  }
  var BUSY_DELAY_MS = 250;
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
    /** Last issues map rendered into chips/groups, to skip redundant DOM rebuilds. */
    lastRenderedIssues = null;
    selectedSegmentIds = /* @__PURE__ */ new Set();
    orderedIssueIds = [];
    nextIssuePointer = -1;
    listBox;
    /** Pending timer that veils the list; null when idle or already veiled. */
    busyTimer = null;
    async init() {
      injectStyles();
      const { tabLabel, tabPane } = await this.sdk.Sidebar.registerScriptTab();
      tabLabel.textContent = "CH Names";
      this.pane = tabPane;
      document.documentElement.classList.toggle("chk-theme-dark", wmeThemeIsDark(this.pane));
      this.buildSkeleton();
      this.scanner.onUpdate((snapshot) => this.render(snapshot));
      this.sdk.Events.on({
        eventName: "wme-selection-changed",
        eventHandler: () => this.syncSelection()
      });
      this.sdk.Events.on({
        eventName: "wme-map-move-end",
        eventHandler: () => {
          if (this.settings.get().viewportOnly) this.render(this.scanner.getSnapshot(), true);
        }
      });
      this.render(this.scanner.getSnapshot());
    }
    /** Rebuild all static DOM (after a language change). */
    rebuild() {
      this.pane.replaceChildren();
      this.buildSkeleton();
      this.lastRenderedIssues = null;
      this.render(this.scanner.getSnapshot());
    }
    buildSkeleton() {
      this.pane.classList.add("chk-pane");
      const brand = el("div", "chk-brand");
      brand.append(
        el("span", "chk-brand-icon", "🇨🇭"),
        el("span", "chk-brand-title", "CH Names"),
        el("span", "chk-brand-version", `v${"1.13.0"}`)
      );
      const toolbar = el("div", "chk-toolbar");
      const rescanBtn = el("button", "chk-btn", t("rescan"));
      rescanBtn.title = t("rescanTitle");
      rescanBtn.addEventListener("click", () => this.scanner.rescan());
      const nextBtn = el("button", "chk-btn", t("nextIssue"));
      nextBtn.title = t("nextIssueTitle");
      nextBtn.addEventListener("click", () => this.selectNextIssue());
      this.unsavedBadge = el("span", "chk-unsaved", "");
      toolbar.append(rescanBtn, nextBtn, this.unsavedBadge);
      this.statusLine = el("div", "chk-banner", t("stateIdle"));
      this.chipsBox = el("div", "chk-chips");
      this.groupsBox = el("div", "chk-groups");
      this.listBox = el("div", "chk-list");
      const busy = el("div", "chk-busy");
      busy.append(el("span", "chk-spinner"), el("span", "chk-busy-text", t("updating")));
      this.listBox.append(this.chipsBox, this.groupsBox, busy);
      this.pane.append(
        brand,
        toolbar,
        this.statusLine,
        this.buildMasterToggles(),
        this.listBox,
        this.buildLegend(),
        this.buildSettings(),
        this.buildFooter()
      );
    }
    buildMasterToggles() {
      const row = el("div", "chk-master");
      const settings = this.settings.get();
      row.append(
        this.toggleSwitch(
          t("toggleEnabled"),
          settings.enabled,
          (checked) => {
            this.settings.update({ enabled: checked });
            if (checked) this.scanner.requestScan();
            else this.scanner.disable();
          },
          t("toggleEnabledTitle")
        ),
        this.toggleSwitch(
          t("toggleAutoScan"),
          settings.autoScan,
          (checked) => {
            this.settings.update({ autoScan: checked });
            if (checked && this.settings.get().enabled) this.scanner.requestScan();
          },
          t("toggleAutoScanTitle")
        )
      );
      return row;
    }
    /** iOS-style toggle: a visually hidden checkbox plus a CSS track/knob and a label. */
    toggleSwitch(text, checked, onChange, title) {
      const label = el("label", "chk-switch");
      if (title) label.title = title;
      const input = el("input");
      input.type = "checkbox";
      input.checked = checked;
      input.addEventListener("change", () => onChange(input.checked));
      const track = el("span", "chk-switch-track");
      track.appendChild(el("span", "chk-switch-knob"));
      label.append(input, track, el("span", "chk-switch-label", text));
      return label;
    }
    /** A collapsible settings sub-section with an icon header. */
    buildSubsection(icon, title, children) {
      const details = el("details", "chk-subsection");
      const summary = el("summary");
      summary.append(el("span", "chk-section-icon", icon), el("span", "", title));
      details.appendChild(summary);
      const body = el("div", "chk-subsection-body");
      for (const child of children) body.appendChild(child);
      details.appendChild(body);
      return details;
    }
    buildFooter() {
      const footer = el("div", "chk-footer");
      const link = el("a", "", "Changelog");
      link.href = "https://github.com/Neprena/WME-CH-Street-Name-Checker/blob/main/CHANGELOG.md";
      link.target = "_blank";
      link.rel = "noopener";
      footer.appendChild(link);
      return footer;
    }
    buildLegend() {
      const details = el("details", "chk-section");
      const summary = el("summary");
      summary.append(el("span", "chk-section-icon", "🎨"), el("span", "", t("legendTitle")));
      details.appendChild(summary);
      const body = el("div", "chk-section-body");
      for (const status of Object.keys(STATUS_STYLES)) {
        const row = el("div", "chk-settings-row");
        const dot = el("span", "chk-dot");
        dot.style.background = STATUS_STYLES[status].strokeColor;
        row.append(dot, el("span", "", `${status}: ${t(LEGEND_KEYS[status])}`));
        body.appendChild(row);
      }
      details.appendChild(body);
      return details;
    }
    render(snapshot, force = false) {
      const { state, issues, stats, officialStreetCount, progress, error } = snapshot;
      const inViewport = this.inViewport(issues);
      let statusText = t(STATE_KEYS[state]);
      if (state === "fetching" && progress) statusText += ` ${progress.done}/${progress.total}`;
      if (state === "done") {
        statusText = t("stateDone", {
          issues: inViewport.length,
          ok: stats.ok + stats.okAlt,
          streets: officialStreetCount
        });
      }
      if (state === "error" && error) statusText += `: ${error}`;
      this.statusLine.textContent = statusText;
      this.statusLine.classList.toggle("chk-error", state === "error");
      this.statusLine.classList.toggle("chk-banner-ok", state === "done" && inViewport.length === 0);
      this.setBusy(state === "fetching" || state === "evaluating");
      this.unsavedBadge.textContent = snapshot.unsavedCount > 0 ? t("unsavedBadge", { n: snapshot.unsavedCount }) : "";
      if (!force && issues === this.lastRenderedIssues) return;
      this.lastRenderedIssues = issues;
      const visible = this.applyStatusFilters(inViewport);
      const groups = groupIssues(visible);
      this.orderedIssueIds = groups.flatMap((g) => g.issues.map((i) => i.segmentId));
      this.renderChips(inViewport);
      this.renderGroups(groups, visible.length, state);
    }
    /**
     * Veil the issue list with a blur + spinner while a scan is in flight. Delayed
     * so the frequent, fast rescans on map moves don't make it flash.
     */
    setBusy(updating) {
      if (updating) {
        if (this.busyTimer !== null || this.listBox.classList.contains("chk-busy-active")) return;
        this.busyTimer = setTimeout(() => {
          this.busyTimer = null;
          this.listBox.classList.add("chk-busy-active");
        }, BUSY_DELAY_MS);
      } else {
        if (this.busyTimer !== null) {
          clearTimeout(this.busyTimer);
          this.busyTimer = null;
        }
        this.listBox.classList.remove("chk-busy-active");
      }
    }
    /** Read the visible map extent; null (filter disabled) on any SDK failure. */
    currentViewport() {
      try {
        return this.sdk.Map.getMapExtent();
      } catch {
        return null;
      }
    }
    /** Issues restricted to the on-screen viewport, unless the filter is off. */
    inViewport(issues) {
      const all = [...issues.values()];
      if (!this.settings.get().viewportOnly) return all;
      const bbox = this.currentViewport();
      if (!bbox) return all;
      return all.filter((issue) => geometryIntersectsBbox(issue.geometry, bbox));
    }
    applyStatusFilters(issues) {
      return issues.filter(
        (issue) => this.activeFilters.size === 0 || this.activeFilters.has(issue.status)
      );
    }
    renderChips(issues) {
      this.chipsBox.replaceChildren();
      const counts = /* @__PURE__ */ new Map();
      for (const issue of issues) {
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
          this.render(this.scanner.getSnapshot(), true);
        });
        this.chipsBox.appendChild(chip);
      }
    }
    renderGroups(groups, visibleCount, state) {
      const scrollTop = this.groupsBox.scrollTop;
      this.groupsBox.replaceChildren();
      if (visibleCount === 0) {
        if (state === "done") {
          this.groupsBox.appendChild(el("div", "chk-empty", t("allMatch")));
        } else if (state === "zoom-gated" || state === "area-gated") {
          this.groupsBox.appendChild(el("div", "chk-muted", t(STATE_KEYS[state])));
        }
        return;
      }
      for (const group of groups) {
        this.groupsBox.appendChild(this.renderGroup(group));
      }
      this.groupsBox.scrollTop = scrollTop;
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
      names.title = `${group.status}${noteText ? ` · ${noteText}` : ""}`;
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
          this.onFixGroup(group, fixAllBtn);
        });
        header.appendChild(fixAllBtn);
      }
      header.addEventListener("click", () => {
        const expanding = !this.expandedGroups.has(group.key);
        if (expanding) {
          this.expandedGroups.add(group.key);
          this.zoomToGroup(group);
        } else {
          this.expandedGroups.delete(group.key);
        }
        this.render(this.scanner.getSnapshot(), true);
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
      const geoLink = el("a", "chk-locate chk-geolink", "↗");
      geoLink.href = mapGeoAdminUrlForGeometry(issue.geometry, getLocale());
      geoLink.target = "_blank";
      geoLink.rel = "noopener";
      geoLink.title = t("geoAdminLinkTitle");
      geoLink.addEventListener("click", (ev) => ev.stopPropagation());
      row.appendChild(geoLink);
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
          this.onFixOne(issue, fixBtn);
        });
        row.appendChild(fixBtn);
      }
      row.addEventListener("click", () => this.selectSegment(issue.segmentId));
      return row;
    }
    /** Fit the map to every segment of the group, with padding for context. */
    zoomToGroup(group) {
      this.scanner.suppressAutoScan();
      let minLon = Infinity;
      let minLat = Infinity;
      let maxLon = -Infinity;
      let maxLat = -Infinity;
      for (const issue of group.issues) {
        for (const point of issue.geometry.coordinates) {
          const lon = point[0];
          const lat = point[1];
          minLon = Math.min(minLon, lon);
          minLat = Math.min(minLat, lat);
          maxLon = Math.max(maxLon, lon);
          maxLat = Math.max(maxLat, lat);
        }
      }
      if (!Number.isFinite(minLon)) return;
      const padLon = Math.max((maxLon - minLon) * 0.3, 1e-3);
      const padLat = Math.max((maxLat - minLat) * 0.3, 7e-4);
      try {
        this.sdk.Map.zoomToExtent({
          bbox: [minLon - padLon, minLat - padLat, maxLon + padLon, maxLat + padLat]
        });
        const minZoom = this.settings.get().minZoom;
        if (this.sdk.Map.getZoomLevel() < minZoom) {
          this.sdk.Map.setZoomLevel({ zoomLevel: Math.min(22, Math.max(12, minZoom)) });
        }
      } catch {
      }
    }
    locateSegment(issue) {
      this.scanner.suppressAutoScan();
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
    onFixOne(issue, button) {
      void withFixLock(async () => {
        if (button) {
          button.disabled = true;
          button.textContent = "…";
        }
        const outcome = fixSegment(this.sdk, issue, this.settings.get());
        if (!outcome.ok) {
          alert(t("fixFailed", { error: formatFixError(outcome) }));
        }
        return outcome;
      }).then((result) => {
        if (result !== null) this.scanner.reevaluate();
      });
    }
    onFixGroup(group, button) {
      const n = Math.min(group.issues.length, GROUP_FIX_CAP);
      if (n > GROUP_FIX_CONFIRM_THRESHOLD && !confirm(t("confirmGroupFix", { name: group.suggestion ?? "", n }))) {
        return;
      }
      void withFixLock(async () => {
        if (button) button.disabled = true;
        const outcomes = await fixGroup(this.sdk, group.issues, this.settings.get(), (done, total) => {
          if (button) button.textContent = `${done}/${total}…`;
        });
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
        return outcomes;
      }).then((result) => {
        if (result !== null) this.scanner.reevaluate();
      });
    }
    buildSettings() {
      const details = el("details", "chk-section");
      const summary = el("summary");
      summary.append(el("span", "chk-section-icon", "⚙️"), el("span", "", t("settingsTitle")));
      details.appendChild(summary);
      const body = el("div", "chk-section-body");
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
      const statusGrid = el("div", "chk-settings-grid");
      for (const status of ALL_STATUSES) {
        const label = el("label");
        label.title = t(LEGEND_KEYS[status]);
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = settings.enabledStatuses.includes(status);
        cb.addEventListener("change", () => {
          const current2 = new Set(this.settings.get().enabledStatuses);
          if (cb.checked) current2.add(status);
          else current2.delete(status);
          this.settings.update({ enabledStatuses: ALL_STATUSES.filter((s) => current2.has(s)) });
          this.scanner.reevaluate();
        });
        const dot = el("span", "chk-dot");
        dot.style.background = STATUS_STYLES[status].strokeColor;
        label.append(cb, dot, status);
        statusGrid.appendChild(label);
      }
      const optionToggle = (textKey, key, titleKey) => this.toggleSwitch(
        t(textKey),
        settings[key],
        (checked) => apply({ [key]: checked }),
        titleKey ? t(titleKey) : void 0
      );
      const viewportToggle = this.toggleSwitch(
        t("viewportOnly"),
        settings.viewportOnly,
        (checked) => {
          this.settings.update({ viewportOnly: checked });
          this.render(this.scanner.getSnapshot(), true);
        },
        t("viewportOnlyTitle")
      );
      const options = [
        optionToggle("altOk", "altNameCountsAsOk", "altOkTitle"),
        optionToggle("showMapLabels", "showMapLabels"),
        optionToggle("keepOldName", "keepOldNameAsAlt", "keepOldNameTitle"),
        optionToggle("guidelineChecks", "guidelineChecks", "guidelineChecksTitle"),
        optionToggle("helperSetting", "editPanelHelper"),
        optionToggle("geometryMatching", "geometryMatching", "geometryMatchingTitle"),
        optionToggle("editableOnly", "editableOnly", "editableOnlyTitle"),
        viewportToggle
      ];
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
      body.append(
        this.buildSubsection("🛣️", t("roadTypesLabel"), [grid]),
        this.buildSubsection("🏷️", t("statusesLabel"), [statusGrid]),
        this.buildSubsection("🎛️", t("optionsLabel"), options),
        this.buildSubsection("📍", t("scopeDisplayLabel"), [scopingRow, zoomRow, langRow])
      );
      details.appendChild(body);
      return details;
    }
  };

  // src/ui/edit-panel.ts
  var CONTAINER_ID = "chk-edit-helper";
  var INJECT_RETRY_DELAYS_MS = [0, 250, 750];
  var OK_COLOR = "#4a8f3c";
  function issuesInSameGroup(issues, ref) {
    const key = (i) => `${i.status}|${i.currentName ?? ""}|${i.suggestion ?? ""}`;
    const refKey = key(ref);
    return [...issues.values()].filter((i) => key(i) === refKey);
  }
  var EditPanelBox = class {
    constructor(sdk2, scanner, settings) {
      this.sdk = sdk2;
      this.scanner = scanner;
      this.settings = settings;
    }
    sdk;
    scanner;
    settings;
    retryTimers = [];
    warnedMissingPanel = false;
    init() {
      this.sdk.Events.on({ eventName: "wme-selection-changed", eventHandler: () => this.schedule() });
      this.sdk.Events.on({ eventName: "wme-after-edit", eventHandler: () => this.schedule() });
      this.scanner.onUpdate(() => this.schedule());
    }
    selectedSegmentId() {
      try {
        const selection = this.sdk.Editing.getSelection();
        if (selection?.objectType === "segment" && selection.ids.length === 1) {
          return selection.ids[0];
        }
      } catch {
      }
      return null;
    }
    schedule() {
      if (isFixInFlight()) return;
      for (const timer of this.retryTimers) clearTimeout(timer);
      this.retryTimers = [];
      const segmentId = this.selectedSegmentId();
      const s = this.settings.get();
      if (!s.editPanelHelper || !s.enabled || this.scanner.paused || segmentId === null) {
        document.getElementById(CONTAINER_ID)?.remove();
        return;
      }
      for (const delay of INJECT_RETRY_DELAYS_MS) {
        this.retryTimers.push(setTimeout(() => this.inject(segmentId), delay));
      }
    }
    inject(segmentId) {
      if (this.selectedSegmentId() !== segmentId) return;
      const panel = document.querySelector("#edit-panel");
      if (!panel) {
        if (!this.warnedMissingPanel) {
          this.warnedMissingPanel = true;
          log.warn("#edit-panel not found; the edit-panel box is unavailable in this WME version");
        }
        return;
      }
      let container = document.getElementById(CONTAINER_ID);
      if (!container) {
        container = document.createElement("div");
        container.id = CONTAINER_ID;
        container.className = "chk-helper";
        panel.prepend(container);
      }
      this.render(container, segmentId);
    }
    render(container, segmentId) {
      container.replaceChildren();
      const snapshot = this.scanner.getSnapshot();
      const issue = snapshot.issues.get(segmentId);
      const head = document.createElement("div");
      head.className = "chk-helper-head";
      const title = document.createElement("b");
      title.textContent = "CH Names";
      const dot = document.createElement("span");
      dot.className = "chk-dot";
      const statusText = document.createElement("span");
      head.append(title, dot, statusText);
      container.appendChild(head);
      if (!issue) {
        if (snapshot.state !== "done") {
          dot.style.background = "#bbb";
          statusText.textContent = t(STATE_KEYS[snapshot.state]);
          statusText.className = "chk-muted";
        } else if (this.isCheckedAndNamed(segmentId)) {
          dot.style.background = OK_COLOR;
          statusText.textContent = t("helperOk");
        } else {
          container.remove();
        }
        return;
      }
      dot.style.background = STATUS_STYLES[issue.status].strokeColor;
      statusText.textContent = issue.status;
      const geoLink = document.createElement("a");
      geoLink.textContent = "↗";
      geoLink.className = "chk-geolink";
      geoLink.href = mapGeoAdminUrlForGeometry(issue.geometry, getLocale());
      geoLink.target = "_blank";
      geoLink.rel = "noopener";
      geoLink.title = t("geoAdminLinkTitle");
      head.appendChild(geoLink);
      const detail = document.createElement("div");
      detail.className = "chk-muted";
      detail.textContent = t(LEGEND_KEYS[issue.status]);
      container.appendChild(detail);
      if (issue.suggestion && issue.suggestion !== issue.currentName) {
        const line = document.createElement("div");
        line.className = "chk-helper-sug";
        const name = document.createElement("b");
        name.textContent = `→ ${issue.suggestion}`;
        line.appendChild(name);
        const noteText = formatNote(issue.note);
        if (noteText) {
          const note = document.createElement("span");
          note.className = "chk-note";
          note.textContent = ` (${noteText})`;
          line.appendChild(note);
        }
        container.appendChild(line);
      }
      if (issue.fixable) {
        const buttons = document.createElement("div");
        buttons.className = "chk-helper-sug";
        const fixBtn = document.createElement("button");
        fixBtn.textContent = t("fix");
        fixBtn.title = t("fixTitle", { name: issue.suggestion ?? "" });
        fixBtn.addEventListener("click", () => this.onFixOne(issue, fixBtn));
        buttons.appendChild(fixBtn);
        const group = issuesInSameGroup(snapshot.issues, issue);
        if (group.length > 1) {
          const fixAllBtn = document.createElement("button");
          fixAllBtn.textContent = t("fixAll", { n: Math.min(group.length, GROUP_FIX_CAP) });
          fixAllBtn.addEventListener("click", () => this.onFixGroup(issue, group, fixAllBtn));
          buttons.appendChild(fixAllBtn);
        }
        container.appendChild(buttons);
      }
    }
    isCheckedAndNamed(segmentId) {
      try {
        const segment = this.sdk.DataModel.Segments.getById({ segmentId });
        if (!segment || !this.settings.get().checkedRoadTypes.includes(segment.roadType)) {
          return false;
        }
        const address = this.sdk.DataModel.Segments.getAddress({ segmentId });
        return Boolean(address.street?.name?.trim());
      } catch {
        return false;
      }
    }
    onFixOne(issue, button) {
      void withFixLock(async () => {
        if (button) {
          button.disabled = true;
          button.textContent = "…";
        }
        const outcome = fixSegment(this.sdk, issue, this.settings.get());
        if (!outcome.ok) {
          alert(t("fixFailed", { error: formatFixError(outcome) }));
        }
        return outcome;
      }).then((result) => {
        if (result !== null) {
          this.scanner.reevaluate();
          this.schedule();
        }
      });
    }
    onFixGroup(issue, group, button) {
      const n = Math.min(group.length, GROUP_FIX_CAP);
      if (n > GROUP_FIX_CONFIRM_THRESHOLD && !confirm(t("confirmGroupFix", { name: issue.suggestion ?? "", n }))) {
        return;
      }
      void withFixLock(async () => {
        if (button) button.disabled = true;
        const outcomes = await fixGroup(this.sdk, group, this.settings.get(), (done, total) => {
          if (button) button.textContent = `${done}/${total}…`;
        });
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
        return outcomes;
      }).then((result) => {
        if (result !== null) {
          this.scanner.reevaluate();
          this.schedule();
        }
      });
    }
  };

  // src/main.user.ts
  async function main() {
    const sdk2 = await initSdk();
    await sdk2.Events.once({ eventName: "wme-ready" });
    const settings = new SettingsStore();
    setLocale(resolveLocale(settings.get().language, sdk2.Settings.getLocale().localeCode));
    const fetcher = new TileFetcher(void 0, void 0, new IdbTileStore());
    const scanner = new Scanner(sdk2, fetcher, settings);
    const layer = new HighlightLayer(sdk2, settings);
    layer.init();
    registerLayerCheckbox(sdk2, (checked) => {
      layer.setVisible(checked);
      scanner.setPaused(!checked);
    });
    let lastSyncedIssues = null;
    scanner.onUpdate((snapshot) => {
      if (snapshot.issues !== lastSyncedIssues) {
        lastSyncedIssues = snapshot.issues;
        layer.sync(snapshot.issues);
      }
    });
    const tab = new TabUI(sdk2, scanner, settings);
    await tab.init();
    new EditPanelBox(sdk2, scanner, settings).init();
    registerShortcuts(sdk2, scanner, settings, { nextIssue: () => tab.selectNextIssue() });
    scanner.start();
    log.info(`v${"1.13.0"} ready (SDK ${sdk2.getSDKVersion()}, WME ${sdk2.getWMEVersion()})`);
  }
  main().catch((err) => log.error("Initialization failed", err));
})();
