<p align="center">
  <img src="assets/logo.png" alt="WME CH Street Name Checker" width="440">
</p>

# WME CH Street Name Checker

**[➜ Installer / Installieren / Installa / Install](https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js)** · [Changelog](CHANGELOG.md) · Licence MIT · © Data: swisstopo

Userscript Tampermonkey pour le [Waze Map Editor](https://www.waze.com/editor) - validation des noms de rues contre le répertoire officiel suisse. Interface disponible en français, allemand, italien et anglais.

<details open>
<summary><strong>🇫🇷 Français</strong></summary>

## Description

Compare les noms de rues des segments visibles avec le **répertoire officiel des rues** de la Confédération (swisstopo, base légale [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/393/fr)), via l'API [api3.geo.admin.ch](https://api3.geo.admin.ch). Le répertoire fédéral est agrégé quotidiennement depuis les données de la mensuration officielle cantonale/communale: rien à gagner à interroger les guichets cantonaux en plus.

## Fonctionnalités

- Scan automatique du viewport (debounce, zoom minimum, cache de tuiles, max 30 req/min - conforme au fair use FSDI de 40 req/min). Hors de Suisse: script inactif, zéro requête; en zone frontalière, les segments étrangers sont ignorés.
- Surlignage des segments sur la carte, couleur par statut (tableau ci-dessous).
- Onglet latéral **CH Names**: compteurs filtrables, liste groupée par `nom actuel → nom officiel` triée par sévérité puis volume, clic sur un groupe = zoom sur le secteur, clic sur une ligne = sélection du segment, bouton ⌖ = centrer la carte, bouton "Écart suivant".
- Encadré dans le panneau d'édition: à la sélection d'un segment, verdict du scan (statut, explication, suggestion) avec boutons Corriger / Tout corriger (désactivable).
- Interrupteurs en tête d'onglet: "Actif" (coupe tout: scan, couche, encadré) et "Scan auto" (désactivé = scan manuel via Rescanner). Décocher la couche masque aussi l'encadré.
- Raccourcis clavier (remappables dans les réglages WME): Alt+N = écart suivant, Alt+F = corriger le segment sélectionné. Cache persistant (IndexedDB): les zones scannées survivent au rechargement de WME pendant 24 h.
- Correction 1-clic par segment ou par groupe (cap 50, confirmation au-delà de 20). **Rien n'est sauvegardé automatiquement**: les modifications entrent dans la pile d'édition WME, tu relis et sauves toi-même (Ctrl+S, undo natif).
- Matching géométrique (désactivable): les axes officiels sont appariés spatialement aux segments - suggestions 1-clic pour les segments sans nom, détection de la mauvaise rue, désambiguïsation par distance. Anti-faux-positifs: filtre d'orientation (les transversales ne concourent pas), couverture minimale du segment, abstention en cas de rues quasi équidistantes.
- Routes cantonales/nationales hors localité: un nom introuvable sur une route principale est accepté si un axe officiel du même nom existe à moins de 3 km (prolongement du nom de la commune voisine, ex. Route de Berne entre Payerne et Corcelles). Les désignations numérotées (A9, E62, A9 - E62) sont acceptées sur les types autoroutiers.
- Communes bilingues (Biel/Bienne…): les libellés officiels `A/B` sont acceptés en entier et pour chaque partie; un nom alternatif Waze qui correspond compte comme OK (réglable).
- Contrôles des règles d'édition de Suisse romande (sans donnée externe, désactivables): micro-segments, boucles à 1-2 segments, mauvais usage du type Rue étroite. Statuts informatifs, sans correction automatique.
- Réglages persistants: types de routes ET types d'erreurs vérifiés (case par statut), scoping par localité (off/warn/strict), labels carte, zoom minimal, conservation de l'ancien nom en alternatif, langue.

## Statuts

| Statut | Signification | Couleur |
|---|---|---|
| `COSMETIC` | Différence typographique (apostrophe, casse, espaces) | jaune pointillé |
| `VARIANT` | Abréviation, accent ou article manquant (Av. → Avenue, Chemin de Montaz → Chemin de la Montaz) | jaune |
| `NEAR` | Probable faute de frappe, suggestion unique | orange |
| `WRONG_TYPE` | Type de voie différent ou manquant (Chemin → Route, La Palaz A → Zone Industrielle La Palaz A), radical unique dans le secteur | orange foncé pointillé |
| `WRONG_STREET` | Nom valide, mais la rue officielle sous le segment porte un autre nom | rouge foncé |
| `WRONG_CITY` | Le nom existe, mais dans une autre localité (mode scoping) | rose |
| `NOT_FOUND` | Introuvable dans le répertoire officiel | rouge |
| `UNNAMED` | Segment vérifiable sans nom; la rue officielle dessous est proposée en 1 clic | violet pointillé |
| `MICRO_SEGMENT` | Segment carrossable < 5 m (ronds-points exclus) | cyan |
| `LOOP` | Boucle de moins de 3 segments (nœuds d'extrémité identiques) | brun |
| `NARROW_MISUSE` | Rue étroite à sens unique ou < 50 m | indigo pointillé |

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (sous Chrome: activer le mode développeur dans `chrome://extensions`).
2. [Cliquer ici pour installer le script](https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js) - les mises à jour sont ensuite automatiques.

</details>

<details>
<summary><strong>🇩🇪 Deutsch</strong></summary>

## Beschreibung

Vergleicht die Strassennamen der sichtbaren Segmente mit dem **amtlichen Strassenverzeichnis** des Bundes (swisstopo, Rechtsgrundlage [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/393/de)) über die API [api3.geo.admin.ch](https://api3.geo.admin.ch). Das Bundesverzeichnis wird täglich aus den Daten der amtlichen Vermessung (Kantone/Gemeinden) aktualisiert - kantonale Geoportale bringen daher keinen Mehrwert.

## Funktionen

- Automatischer Scan des Kartenausschnitts (Debounce, Mindestzoom, Kachel-Cache, max. 30 Anfragen/Min. - innerhalb der BGDI-Fair-Use-Grenze von 40/Min.). Ausserhalb der Schweiz bleibt das Skript inaktiv; in Grenzgebieten werden ausländische Segmente ignoriert.
- Farbliche Hervorhebung der Segmente auf der Karte, Farbe je Status (Tabelle unten).
- Seitentab **CH Names**: filterbare Zähler, gruppierte Liste `aktueller Name → amtlicher Name` sortiert nach Schweregrad und Anzahl, Klick auf eine Gruppe = Zoom auf das Gebiet, Klick auf eine Zeile = Segment auswählen, ⌖ = Karte zentrieren, "Nächste Abweichung".
- Box im Bearbeitungspanel: bei Auswahl eines Segments erscheint das Scan-Ergebnis (Status, Erklärung, Vorschlag) mit Korrigieren / Alle korrigieren (abschaltbar).
- Hauptschalter oben im Tab: "Aktiv" (deaktiviert alles) und "Auto-Scan" (aus = nur manuell per Neu scannen). Eine deaktivierte Ebene blendet auch die Box aus.
- Tastaturkürzel (in den WME-Einstellungen anpassbar): Alt+N = nächste Abweichung, Alt+F = ausgewähltes Segment korrigieren. Persistenter Cache (IndexedDB): gescannte Gebiete überleben einen WME-Reload 24 h lang.
- 1-Klick-Korrektur pro Segment oder Gruppe (max. 50, Bestätigung ab 20). **Nichts wird automatisch gespeichert**: Änderungen landen im WME-Bearbeitungsstapel - prüfen und selbst speichern (Ctrl+S, natives Undo).
- Geometrie-Matching (abschaltbar): amtliche Strassenachsen werden räumlich den Segmenten zugeordnet - 1-Klick-Vorschläge für unbenannte Segmente, Falsche-Strasse-Erkennung, Distanz-Disambiguierung. Gegen Fehlalarme: Richtungsfilter (Querstrassen konkurrieren nie), Mindestabdeckung des Segments, Enthaltung bei fast gleich nahen Strassen.
- Ausserortsstrecken von Kantons-/Nationalstrassen: ein unauffindbarer Name auf einer Hauptstrasse wird akzeptiert, wenn eine gleichnamige amtliche Achse innerhalb von 3 km existiert (Fortsetzung aus der Nachbargemeinde). Nummerierte Bezeichnungen (A9, E62, A9 - E62) werden auf Autobahn-Typen akzeptiert.
- Zweisprachige Gemeinden (Biel/Bienne…): amtliche `A/B`-Bezeichnungen werden als Ganzes und je Teil akzeptiert; ein passender Alternativname zählt als OK (einstellbar).
- Schweizer Regelprüfungen (ohne externe Daten, abschaltbar): Mikrosegmente, Schleifen aus 1-2 Segmenten, falsch verwendete enge Strassen. Nur informativ, keine automatische Korrektur.
- Persistente Einstellungen: geprüfte Strassentypen UND Fehlertypen (Checkbox je Status), Ortschafts-Scoping, Kartenbeschriftung, Mindestzoom, alten Namen als Alternative behalten, Sprache.

## Status

| Status | Bedeutung | Farbe |
|---|---|---|
| `COSMETIC` | Nur Typografie (Apostroph, Gross-/Kleinschreibung, Leerzeichen) | gelb gestrichelt |
| `VARIANT` | Abkürzung, fehlender Akzent oder Artikel (Bahnhofstr. → Bahnhofstrasse) | gelb |
| `NEAR` | Wahrscheinlicher Tippfehler, eindeutiger Vorschlag | orange |
| `WRONG_TYPE` | Anderer oder fehlender Strassentyp (Bahnhofweg → Bahnhofstrasse, X → Strasse X), eindeutiger Namensstamm in der Umgebung | dunkelorange gestrichelt |
| `WRONG_STREET` | Gültiger Name, aber die amtliche Strasse unter dem Segment heisst anders | dunkelrot |
| `WRONG_CITY` | Name existiert, aber in anderer Ortschaft (Scoping-Modus) | rosa |
| `NOT_FOUND` | Nicht im amtlichen Verzeichnis | rot |
| `UNNAMED` | Geprüfter Strassentyp ohne Namen; die amtliche Strasse darunter wird mit 1 Klick vorgeschlagen | violett gestrichelt |
| `MICRO_SEGMENT` | Befahrbares Segment < 5 m (Kreisel ausgenommen) | cyan |
| `LOOP` | Schleife aus weniger als 3 Segmenten (gleiche Endknoten) | braun |
| `NARROW_MISUSE` | Enge Strasse als Einbahn oder < 50 m | indigo gestrichelt |

## Installation

1. [Tampermonkey](https://www.tampermonkey.net/) installieren (Chrome: Entwicklermodus in `chrome://extensions` aktivieren).
2. [Hier klicken, um das Skript zu installieren](https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js) - Updates erfolgen danach automatisch.

</details>

<details>
<summary><strong>🇮🇹 Italiano</strong></summary>

## Descrizione

Confronta i nomi delle strade dei segmenti visibili con il **repertorio ufficiale delle strade** della Confederazione (swisstopo, base legale [OGeoN](https://www.fedlex.admin.ch/eli/cc/2008/393/it)) tramite l'API [api3.geo.admin.ch](https://api3.geo.admin.ch). Il repertorio federale è aggiornato ogni giorno dai dati della misurazione ufficiale (cantoni/comuni) - i geoportali cantonali non aggiungono nulla.

## Funzionalità

- Scansione automatica della vista (debounce, zoom minimo, cache a tessere, max 30 richieste/min - entro il fair use IFDG di 40/min). Fuori dalla Svizzera lo script resta inattivo; nelle zone di confine i segmenti esteri sono ignorati.
- Evidenziazione dei segmenti sulla mappa, colore per stato (tabella sotto).
- Scheda laterale **CH Names**: contatori filtrabili, elenco raggruppato `nome attuale → nome ufficiale` ordinato per gravità e volume, clic su un gruppo = zoom sulla zona, clic su una riga = seleziona il segmento, ⌖ = centra la mappa, "Prossima differenza".
- Riquadro nel pannello di modifica: selezionando un segmento appare il verdetto della scansione (stato, spiegazione, proposta) con Correggi / Correggi tutti (disattivabile).
- Interruttori in cima alla scheda: "Attivo" (disattiva tutto) e "Scansione auto" (off = solo manuale con Riscansiona). Nascondere il livello nasconde anche il riquadro.
- Scorciatoie da tastiera (rimappabili nelle impostazioni WME): Alt+N = prossima differenza, Alt+F = correggi il segmento selezionato. Cache persistente (IndexedDB): le zone scansionate sopravvivono al ricaricamento di WME per 24 h.
- Correzione in 1 clic per segmento o per gruppo (max 50, conferma oltre 20). **Nulla viene salvato automaticamente**: le modifiche entrano nello stack di WME - rivedi e salva tu stesso (Ctrl+S, undo nativo).
- Matching geometrico (disattivabile): gli assi ufficiali sono abbinati spazialmente ai segmenti - suggerimenti in 1 clic per i segmenti senza nome, rilevamento della strada errata, disambiguazione per distanza. Contro i falsi positivi: filtro di orientamento (le trasversali non competono), copertura minima del segmento, astensione con strade quasi equidistanti.
- Strade cantonali/nazionali fuori località: un nome introvabile su una strada principale è accettato se un asse ufficiale omonimo esiste entro 3 km (continuazione dal comune vicino). Le designazioni numerate (A9, E62, A9 - E62) sono accettate sui tipi autostradali.
- Comuni bilingui (Biel/Bienne…): le denominazioni ufficiali `A/B` sono accettate per intero e per ciascuna parte; un nome alternativo corrispondente conta come OK (regolabile).
- Controlli delle regole svizzere (senza dati esterni, disattivabili): micro-segmenti, anelli di 1-2 segmenti, uso scorretto del tipo Strada stretta. Solo informativi, nessuna correzione automatica.
- Impostazioni persistenti: tipi di strada E tipi di errore verificati (casella per stato), scoping per località, etichette sulla mappa, zoom minimo, mantenere il vecchio nome come alternativo, lingua.

## Stati

| Stato | Significato | Colore |
|---|---|---|
| `COSMETIC` | Solo tipografia (apostrofo, maiuscole, spazi) | giallo tratteggiato |
| `VARIANT` | Abbreviazione, accento o articolo mancante | giallo |
| `NEAR` | Probabile errore di battitura, proposta unica | arancione |
| `WRONG_TYPE` | Tipo di via diverso o mancante (Chemin → Route, X → Via X), radice unica nella zona | arancione scuro tratteggiato |
| `WRONG_STREET` | Nome valido, ma la strada ufficiale sotto il segmento ha un altro nome | rosso scuro |
| `WRONG_CITY` | Il nome esiste, ma in un'altra località (scoping) | rosa |
| `NOT_FOUND` | Assente dal repertorio ufficiale | rosso |
| `UNNAMED` | Tipo verificato senza nome; la strada ufficiale sottostante è proposta in 1 clic | viola tratteggiato |
| `MICRO_SEGMENT` | Segmento percorribile < 5 m (rotatorie escluse) | ciano |
| `LOOP` | Anello con meno di 3 segmenti (stessi nodi) | marrone |
| `NARROW_MISUSE` | Strada stretta a senso unico o < 50 m | indaco tratteggiato |

## Installazione

1. Installare [Tampermonkey](https://www.tampermonkey.net/) (Chrome: attivare la modalità sviluppatore in `chrome://extensions`).
2. [Clicca qui per installare lo script](https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js) - gli aggiornamenti sono poi automatici.

</details>

<details>
<summary><strong>🇬🇧 English</strong></summary>

## Description

Compares the street names of visible segments with the Swiss federal **official directory of streets** (swisstopo, legal basis [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/393/en)) through the [api3.geo.admin.ch](https://api3.geo.admin.ch) API. The federal register is refreshed daily from cantonal/communal cadastral surveying data - cantonal portals add nothing for street names.

## Features

- Automatic viewport scan (debounce, minimum zoom, tile cache, max 30 req/min - within the FSDI fair-use limit of 40/min). Outside Switzerland the script stays inactive; in border viewports foreign segments are ignored.
- Map highlighting of segments, one color per status (table below).
- **CH Names** sidebar tab: filterable counters, list grouped by `current name → official name` sorted by severity then volume, click a group = zoom to the area, click a row = select the segment, ⌖ = center the map, "Next issue".
- Box in the edit panel: selecting a segment shows the scan verdict (status, explanation, suggestion) with Fix / Fix all buttons (toggleable).
- Master toggles at the top of the tab: "Enabled" (turns everything off) and "Auto scan" (off = manual Rescan only). Unchecking the layer also hides the box.
- Keyboard shortcuts (remappable in the WME settings): Alt+N = next issue, Alt+F = fix the selected segment. Persistent cache (IndexedDB): scanned areas survive a WME reload for 24 h.
- One-click fix per segment or per group (capped at 50, confirmation above 20). **Nothing is ever auto-saved**: edits go into the WME edit stack - review and save yourself (Ctrl+S, native undo).
- Geometry matching (toggleable): official street axes are matched spatially against segments - one-click suggestions for unnamed segments, wrong-street detection, distance disambiguation. False-positive guards: bearing filter (cross streets never compete), minimum segment coverage, abstention when two streets are nearly equidistant.
- Out-of-locality cantonal/national roads: a NOT_FOUND name on a main road is accepted when a same-named official axis exists within 3 km (continuation from the neighboring commune, e.g. Route de Berne between Payerne and Corcelles). Numbered designations (A9, E62, A9 - E62) are accepted on highway types.
- Bilingual communes (Biel/Bienne…): official `A/B` labels accepted as a whole and per part; a matching alternate name counts as OK (configurable).
- Swiss guideline checks (no external data, toggleable): micro-segments, 1-2 segment loops, Narrow Street misuse. Informational only, no automatic fix.
- Persistent settings: checked road types AND issue types (checkbox per status), city scoping, map labels, minimum zoom, keep old name as alternate, language.

## Statuses

| Status | Meaning | Color |
|---|---|---|
| `COSMETIC` | Typography only (apostrophe, case, spacing) | dashed yellow |
| `VARIANT` | Abbreviation, missing accent or article | yellow |
| `NEAR` | Probable typo, unique suggestion | orange |
| `WRONG_TYPE` | Different or missing way type (Chemin → Route, La Palaz A → Zone Industrielle La Palaz A), unique stem in the area | dashed dark orange |
| `WRONG_STREET` | Valid name, but the official street under the segment has another name | dark red |
| `WRONG_CITY` | Name exists, but in another locality (scoping mode) | pink |
| `NOT_FOUND` | Not in the official register | red |
| `UNNAMED` | Checked road type without a name; the official street underneath is suggested in one click | dashed violet |
| `MICRO_SEGMENT` | Drivable segment < 5 m (roundabouts excluded) | cyan |
| `LOOP` | Loop made of fewer than 3 segments (same endpoints) | brown |
| `NARROW_MISUSE` | Narrow Street one-way or < 50 m | dashed indigo |

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) (Chrome: enable developer mode in `chrome://extensions`).
2. [Click here to install the script](https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js) - updates are then automatic.

</details>

## Data & license

Data: © swisstopo / geo.admin.ch, official directory of streets (`ch.swisstopo.amtliches-strassenverzeichnis`), free, no API key, FSDI fair use: 40 req/min.

Code: MIT.
