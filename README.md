# WME CH Street Name Checker

**[➜ Installer / Installieren / Installa / Install](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js)** · [Changelog](CHANGELOG.md) · Licence MIT · © Data: swisstopo

Userscript Tampermonkey pour le [Waze Map Editor](https://www.waze.com/editor) — validation des noms de rues contre le répertoire officiel suisse. Interface disponible en français, allemand, italien et anglais.

<details open>
<summary><strong>🇫🇷 Français</strong></summary>

## Description

Compare les noms de rues des segments visibles avec le **répertoire officiel des rues** de la Confédération (swisstopo, base légale [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/272/fr)), via l'API [api3.geo.admin.ch](https://api3.geo.admin.ch). Le répertoire fédéral est agrégé quotidiennement depuis les données de la mensuration officielle cantonale/communale: rien à gagner à interroger les guichets cantonaux en plus.

## Fonctionnalités

- Scan automatique du viewport (debounce, zoom minimum, cache de tuiles, max 30 req/min — conforme au fair use FSDI de 40 req/min).
- Surlignage des segments sur la carte, couleur par statut (tableau ci-dessous).
- Onglet latéral **CH Names**: compteurs filtrables, liste groupée par `nom actuel → nom officiel`, clic = sélection du segment, bouton ⌖ = centrer la carte, bouton "Écart suivant".
- Encadré dans le panneau d'édition: à la sélection d'un segment, verdict du scan (statut, explication, suggestion) avec boutons Corriger / Tout corriger (désactivable).
- Interrupteurs en tête d'onglet: "Actif" (coupe tout: scan, couche, encadré) et "Scan auto" (désactivé = scan manuel via Rescanner). Décocher la couche masque aussi l'encadré.
- Correction 1-clic par segment ou par groupe (cap 25, confirmation au-delà de 5). **Rien n'est sauvegardé automatiquement**: les modifications entrent dans la pile d'édition WME, tu relis et sauves toi-même (Ctrl+S, undo natif).
- Matching géométrique (désactivable): les axes officiels sont appariés spatialement aux segments — suggestions 1-clic pour les segments sans nom, détection de la mauvaise rue, désambiguïsation par distance.
- Communes bilingues (Biel/Bienne…): les libellés officiels `A/B` sont acceptés en entier et pour chaque partie; un nom alternatif Waze qui correspond compte comme OK (réglable).
- Contrôles des règles d'édition de Suisse romande (sans donnée externe, désactivables): micro-segments, boucles à 1-2 segments, mauvais usage du type Rue étroite. Statuts informatifs, sans correction automatique.
- Réglages persistants: types de routes vérifiés, scoping par localité (off/warn/strict), labels carte, zoom minimal, conservation de l'ancien nom en alternatif, langue.

## Statuts

| Statut | Signification | Couleur |
|---|---|---|
| `COSMETIC` | Différence typographique (apostrophe, casse, espaces) | jaune pointillé |
| `VARIANT` | Abréviation, accent ou article manquant (Av. → Avenue, Chemin de Montaz → Chemin de la Montaz) | jaune |
| `NEAR` | Probable faute de frappe, suggestion unique | orange |
| `WRONG_TYPE` | Type de voie différent (Chemin de la Guérite → Route de la Guérite), radical unique dans le secteur | orange foncé pointillé |
| `WRONG_STREET` | Nom valide, mais la rue officielle sous le segment porte un autre nom | rouge foncé |
| `WRONG_CITY` | Le nom existe, mais dans une autre localité (mode scoping) | rose |
| `NOT_FOUND` | Introuvable dans le répertoire officiel | rouge |
| `UNNAMED` | Segment vérifiable sans nom | violet pointillé |
| `MICRO_SEGMENT` | Segment carrossable < 5 m (ronds-points exclus) | cyan |
| `LOOP` | Boucle de moins de 3 segments (nœuds d'extrémité identiques) | brun |
| `NARROW_MISUSE` | Rue étroite à sens unique ou < 50 m | indigo pointillé |

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (sous Chrome: activer le mode développeur dans `chrome://extensions`).
2. [Cliquer ici pour installer le script](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js) — les mises à jour sont ensuite automatiques.

</details>

<details>
<summary><strong>🇩🇪 Deutsch</strong></summary>

## Beschreibung

Vergleicht die Strassennamen der sichtbaren Segmente mit dem **amtlichen Strassenverzeichnis** des Bundes (swisstopo, Rechtsgrundlage [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/272/de)) über die API [api3.geo.admin.ch](https://api3.geo.admin.ch). Das Bundesverzeichnis wird täglich aus den Daten der amtlichen Vermessung (Kantone/Gemeinden) aktualisiert — kantonale Geoportale bringen daher keinen Mehrwert.

## Funktionen

- Automatischer Scan des Kartenausschnitts (Debounce, Mindestzoom, Kachel-Cache, max. 30 Anfragen/Min. — innerhalb der BGDI-Fair-Use-Grenze von 40/Min.).
- Farbliche Hervorhebung der Segmente auf der Karte, Farbe je Status (Tabelle unten).
- Seitentab **CH Names**: filterbare Zähler, gruppierte Liste `aktueller Name → amtlicher Name`, Klick = Segment auswählen, ⌖ = Karte zentrieren, "Nächste Abweichung".
- Box im Bearbeitungspanel: bei Auswahl eines Segments erscheint das Scan-Ergebnis (Status, Erklärung, Vorschlag) mit Korrigieren / Alle korrigieren (abschaltbar).
- Hauptschalter oben im Tab: "Aktiv" (deaktiviert alles) und "Auto-Scan" (aus = nur manuell per Neu scannen). Eine deaktivierte Ebene blendet auch die Box aus.
- 1-Klick-Korrektur pro Segment oder Gruppe (max. 25, Bestätigung ab 5). **Nichts wird automatisch gespeichert**: Änderungen landen im WME-Bearbeitungsstapel — prüfen und selbst speichern (Ctrl+S, natives Undo).
- Geometrie-Matching (abschaltbar): amtliche Strassenachsen werden räumlich den Segmenten zugeordnet — 1-Klick-Vorschläge für unbenannte Segmente, Falsche-Strasse-Erkennung, Distanz-Disambiguierung.
- Zweisprachige Gemeinden (Biel/Bienne…): amtliche `A/B`-Bezeichnungen werden als Ganzes und je Teil akzeptiert; ein passender Alternativname zählt als OK (einstellbar).
- Schweizer Regelprüfungen (ohne externe Daten, abschaltbar): Mikrosegmente, Schleifen aus 1-2 Segmenten, falsch verwendete enge Strassen. Nur informativ, keine automatische Korrektur.
- Persistente Einstellungen: geprüfte Strassentypen, Ortschafts-Scoping, Kartenbeschriftung, Mindestzoom, alten Namen als Alternative behalten, Sprache.

## Status

| Status | Bedeutung | Farbe |
|---|---|---|
| `COSMETIC` | Nur Typografie (Apostroph, Gross-/Kleinschreibung, Leerzeichen) | gelb gestrichelt |
| `VARIANT` | Abkürzung, fehlender Akzent oder Artikel (Bahnhofstr. → Bahnhofstrasse) | gelb |
| `NEAR` | Wahrscheinlicher Tippfehler, eindeutiger Vorschlag | orange |
| `WRONG_TYPE` | Anderer Strassentyp (Bahnhofweg → Bahnhofstrasse), eindeutiger Namensstamm in der Umgebung | dunkelorange gestrichelt |
| `WRONG_STREET` | Gültiger Name, aber die amtliche Strasse unter dem Segment heisst anders | dunkelrot |
| `WRONG_CITY` | Name existiert, aber in anderer Ortschaft (Scoping-Modus) | rosa |
| `NOT_FOUND` | Nicht im amtlichen Verzeichnis | rot |
| `UNNAMED` | Geprüfter Strassentyp ohne Namen | violett gestrichelt |
| `MICRO_SEGMENT` | Befahrbares Segment < 5 m (Kreisel ausgenommen) | cyan |
| `LOOP` | Schleife aus weniger als 3 Segmenten (gleiche Endknoten) | braun |
| `NARROW_MISUSE` | Enge Strasse als Einbahn oder < 50 m | indigo gestrichelt |

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren (Chrome: Entwicklermodus in `chrome://extensions` aktivieren).
2. [Hier klicken, um das Skript zu installieren](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js) — Updates erfolgen danach automatisch.

</details>

<details>
<summary><strong>🇮🇹 Italiano</strong></summary>

## Descrizione

Confronta i nomi delle strade dei segmenti visibili con il **repertorio ufficiale delle strade** della Confederazione (swisstopo, base legale [OGeoN](https://www.fedlex.admin.ch/eli/cc/2008/272/it)) tramite l'API [api3.geo.admin.ch](https://api3.geo.admin.ch). Il repertorio federale è aggiornato ogni giorno dai dati della misurazione ufficiale (cantoni/comuni) — i geoportali cantonali non aggiungono nulla.

## Funzionalità

- Scansione automatica della vista (debounce, zoom minimo, cache a tessere, max 30 richieste/min — entro il fair use IFDG di 40/min).
- Evidenziazione dei segmenti sulla mappa, colore per stato (tabella sotto).
- Scheda laterale **CH Names**: contatori filtrabili, elenco raggruppato `nome attuale → nome ufficiale`, clic = seleziona il segmento, ⌖ = centra la mappa, "Prossima differenza".
- Riquadro nel pannello di modifica: selezionando un segmento appare il verdetto della scansione (stato, spiegazione, proposta) con Correggi / Correggi tutti (disattivabile).
- Interruttori in cima alla scheda: "Attivo" (disattiva tutto) e "Scansione auto" (off = solo manuale con Riscansiona). Nascondere il livello nasconde anche il riquadro.
- Correzione in 1 clic per segmento o per gruppo (max 25, conferma oltre 5). **Nulla viene salvato automaticamente**: le modifiche entrano nello stack di WME — rivedi e salva tu stesso (Ctrl+S, undo nativo).
- Matching geometrico (disattivabile): gli assi ufficiali sono abbinati spazialmente ai segmenti — suggerimenti in 1 clic per i segmenti senza nome, rilevamento della strada errata, disambiguazione per distanza.
- Comuni bilingui (Biel/Bienne…): le denominazioni ufficiali `A/B` sono accettate per intero e per ciascuna parte; un nome alternativo corrispondente conta come OK (regolabile).
- Controlli delle regole svizzere (senza dati esterni, disattivabili): micro-segmenti, anelli di 1-2 segmenti, uso scorretto del tipo Strada stretta. Solo informativi, nessuna correzione automatica.
- Impostazioni persistenti: tipi di strada verificati, scoping per località, etichette sulla mappa, zoom minimo, mantenere il vecchio nome come alternativo, lingua.

## Stati

| Stato | Significato | Colore |
|---|---|---|
| `COSMETIC` | Solo tipografia (apostrofo, maiuscole, spazi) | giallo tratteggiato |
| `VARIANT` | Abbreviazione, accento o articolo mancante | giallo |
| `NEAR` | Probabile errore di battitura, proposta unica | arancione |
| `WRONG_TYPE` | Tipo di via diverso (Chemin → Route), radice unica nella zona | arancione scuro tratteggiato |
| `WRONG_STREET` | Nome valido, ma la strada ufficiale sotto il segmento ha un altro nome | rosso scuro |
| `WRONG_CITY` | Il nome esiste, ma in un'altra località (scoping) | rosa |
| `NOT_FOUND` | Assente dal repertorio ufficiale | rosso |
| `UNNAMED` | Tipo verificato senza nome | viola tratteggiato |
| `MICRO_SEGMENT` | Segmento percorribile < 5 m (rotatorie escluse) | ciano |
| `LOOP` | Anello con meno di 3 segmenti (stessi nodi) | marrone |
| `NARROW_MISUSE` | Strada stretta a senso unico o < 50 m | indaco tratteggiato |

## Installazione

1. Installare [Tampermonkey](https://www.tampermonkey.net/) (Chrome: attivare la modalità sviluppatore in `chrome://extensions`).
2. [Clicca qui per installare lo script](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js) — gli aggiornamenti sono poi automatici.

</details>

<details>
<summary><strong>🇬🇧 English</strong></summary>

## Description

Compares the street names of visible segments with the Swiss federal **official directory of streets** (swisstopo, legal basis [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/272/en)) through the [api3.geo.admin.ch](https://api3.geo.admin.ch) API. The federal register is refreshed daily from cantonal/communal cadastral surveying data — cantonal portals add nothing for street names.

## Features

- Automatic viewport scan (debounce, minimum zoom, tile cache, max 30 req/min — within the FSDI fair-use limit of 40/min).
- Map highlighting of segments, one color per status (table below).
- **CH Names** sidebar tab: filterable counters, list grouped by `current name → official name`, click = select the segment, ⌖ = center the map, "Next issue".
- Box in the edit panel: selecting a segment shows the scan verdict (status, explanation, suggestion) with Fix / Fix all buttons (toggleable).
- Master toggles at the top of the tab: "Enabled" (turns everything off) and "Auto scan" (off = manual Rescan only). Unchecking the layer also hides the box.
- One-click fix per segment or per group (capped at 25, confirmation above 5). **Nothing is ever auto-saved**: edits go into the WME edit stack — review and save yourself (Ctrl+S, native undo).
- Geometry matching (toggleable): official street axes are matched spatially against segments — one-click suggestions for unnamed segments, wrong-street detection, distance disambiguation.
- Bilingual communes (Biel/Bienne…): official `A/B` labels accepted as a whole and per part; a matching alternate name counts as OK (configurable).
- Swiss guideline checks (no external data, toggleable): micro-segments, 1-2 segment loops, Narrow Street misuse. Informational only, no automatic fix.
- Persistent settings: checked road types, city scoping, map labels, minimum zoom, keep old name as alternate, language.

## Statuses

| Status | Meaning | Color |
|---|---|---|
| `COSMETIC` | Typography only (apostrophe, case, spacing) | dashed yellow |
| `VARIANT` | Abbreviation, missing accent or article | yellow |
| `NEAR` | Probable typo, unique suggestion | orange |
| `WRONG_TYPE` | Different way type (Chemin de la Guérite → Route de la Guérite), unique stem in the area | dashed dark orange |
| `WRONG_STREET` | Valid name, but the official street under the segment has another name | dark red |
| `WRONG_CITY` | Name exists, but in another locality (scoping mode) | pink |
| `NOT_FOUND` | Not in the official register | red |
| `UNNAMED` | Checked road type without a name | dashed violet |
| `MICRO_SEGMENT` | Drivable segment < 5 m (roundabouts excluded) | cyan |
| `LOOP` | Loop made of fewer than 3 segments (same endpoints) | brown |
| `NARROW_MISUSE` | Narrow Street one-way or < 50 m | dashed indigo |

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome: enable developer mode in `chrome://extensions`).
2. [Click here to install the script](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js) — updates are then automatic.

</details>

## Development

```sh
npm install
npm test            # unit tests (matching, normalization, tiles, guidelines, i18n)
npm run typecheck
npm run build       # produces dist/wme-ch-street-name-checker.user.js
npm run dev         # watch mode
```

Fast dev loop: install `dist/dev.user.js` once in Tampermonkey (enable "Allow access to file URLs" for the extension), run `npm run dev`, then reload WME after each change.

### Architecture

```
src/
├── main.user.ts        # WME SDK bootstrap + wiring
├── sdk.ts              # getWmeSdk initialization (through unsafeWindow)
├── i18n.ts             # EN/FR/DE/IT strings (typed, community-extensible)
├── settings.ts         # settings + localStorage
├── geoadmin/           # identify client + 0.02° tiles + LRU/TTL cache
├── matching/           # K0/K1/K2 normalization, Damerau-Levenshtein, index, evaluation
├── guidelines.ts       # Swiss guideline checks (micro-segments, loops, narrow streets)
├── scan.ts             # orchestrator (events, debounce, generations)
├── map-layer.ts        # highlight layer + layer switcher checkbox
├── fix.ts              # applying official names (never calls save)
└── ui/                 # sidebar tab
```

Matching uses three normalization levels: K0 (raw), K1 (cosmetic, accents kept), K2 (accents folded, hyphen ↔ space, abbreviations expanded — extensible table in `src/matching/normalize.ts`). Fuzzy matching only suggests when the candidate is unique.

### Field-test checklist

- Lausanne (FR), Bern (DE), Biel/Bienne (bilingual), Lugano (IT).
- A viewport spanning two communes.
- A freeway junction: everything should be skipped (unchecked types).
- Introduce a deliberate typo → NEAR status with suggestion → fix → Ctrl+Z (do not save).
- Network: ≤ 30 req/min, zero requests when returning to an already-scanned area (< 24 h).

### Release process

Update [CHANGELOG.md](CHANGELOG.md), `npm version patch|minor`, `npm run build`, commit and push — installed userscripts auto-update from the committed `dist/` build.

## Data & license

Data: © swisstopo / geo.admin.ch, official directory of streets (`ch.swisstopo.amtliches-strassenverzeichnis`), free, no API key, FSDI fair use: 40 req/min.

Code: MIT.
