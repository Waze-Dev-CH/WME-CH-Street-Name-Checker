# WME CH Street Name Checker

Userscript Tampermonkey pour le [Waze Map Editor](https://www.waze.com/editor) qui compare les noms de rues des segments visibles avec le **répertoire officiel des rues** de la Confédération (swisstopo, base légale [GeoNV](https://www.fedlex.admin.ch/eli/cc/2008/272/fr)), via l'API [api3.geo.admin.ch](https://api3.geo.admin.ch). Le répertoire fédéral est agrégé quotidiennement depuis les données de la mensuration officielle cantonale/communale: il n'y a donc rien à gagner à interroger les guichets cantonaux en plus.

## Fonctionnalités

- Scan automatique du viewport (debounce, zoom minimum, cache de tuiles, max 30 req/min, conforme au fair use FSDI de 40 req/min).
- Surlignage des segments sur la carte, couleur par statut:

| Statut | Signification | Couleur |
|---|---|---|
| `COSMETIC` | Différence typographique (apostrophe, casse, espaces) | jaune pointillé |
| `VARIANT` | Abréviation ou accent manquant (Av. → Avenue, Eglise → Église) | jaune |
| `NEAR` | Probable faute de frappe, suggestion unique à distance ≤ 1-2 | orange |
| `WRONG_CITY` | Le nom existe, mais dans une autre localité (mode scoping) | rose |
| `NOT_FOUND` | Introuvable dans le répertoire officiel | rouge |
| `UNNAMED` | Segment vérifiable sans nom | violet pointillé |
| `MICRO_SEGMENT` | Segment carrossable < 5 m (ronds-points exclus) | cyan |
| `LOOP` | Boucle de moins de 3 segments (nœuds d'extrémité identiques) | brun |
| `NARROW_MISUSE` | Rue étroite à sens unique ou < 50 m | indigo pointillé |

- Onglet latéral **CH Names** (panneau Scripts): compteurs filtrables, liste groupée par `nom actuel → nom officiel`, clic sur une ligne = sélection du segment, bouton "Next issue".
- Assistant dans le panneau d'édition du segment: à la sélection d'un segment, affiche le statut de son nom, la suggestion avec bouton Appliquer, et une recherche dans les noms officiels du secteur (localité du segment en premier) — un clic applique le nom, plus besoin de le taper.
- Correction 1-clic par segment ou par groupe (cap 25, confirmation au-delà de 5). **Rien n'est sauvegardé automatiquement**: les modifications entrent dans la pile d'édition WME, tu relis et sauves toi-même (Ctrl+S, undo natif).
- Communes bilingues (Biel/Bienne…): les libellés officiels `A/B` sont acceptés en entier et pour chaque partie; un nom alternatif Waze qui correspond compte comme OK (réglable).
- Réglages persistants: types de routes vérifiés, scoping par localité (off/warn/strict), labels carte, zoom minimal, conservation de l'ancien nom en alternatif, langue (auto = locale WME, ou EN/FR/DE/IT).
- Contrôles des règles d'édition de Suisse romande (sans donnée externe, désactivables): micro-segments, boucles à 1-2 segments, mauvais usage du type Rue étroite. Les trois statuts dédiés sont informatifs (pas de correction automatique: ces erreurs demandent une intervention géométrique manuelle). Le reste des règles romandes (parkings, chemins piétons, voies privées, demi-tours, culs-de-sac) relève du jugement visuel et n'est pas vérifiable automatiquement.

## Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (sous Chrome: activer le mode développeur dans `chrome://extensions`).
2. [Cliquer ici pour installer le script](https://raw.githubusercontent.com/Neprena/wme-ch-street-name-checker/main/dist/wme-ch-street-name-checker.user.js) — Tampermonkey détecte le `.user.js` et propose l'installation. Les mises à jour sont ensuite automatiques (`@updateURL`).

Ou depuis les sources:

```sh
npm install
npm run build   # produit dist/wme-ch-street-name-checker.user.js
```

## Développement

```sh
npm install
npm test            # tests unitaires (matching, normalisation, tuiles)
npm run typecheck
npm run dev         # build en mode watch
```

Boucle de dev rapide: installer une seule fois `dist/dev.user.js` dans Tampermonkey (activer "Autoriser l'accès aux URL de fichier" pour l'extension dans le navigateur), lancer `npm run dev`, puis recharger WME après chaque modification.

### Architecture

```
src/
├── main.user.ts        # bootstrap SDK WME + câblage
├── sdk.ts              # initialisation getWmeSdk (via unsafeWindow)
├── settings.ts         # réglages + localStorage
├── geoadmin/           # client identify + tuiles 0.02° + cache LRU/TTL
├── matching/           # normalisation K0/K1/K2, Damerau-Levenshtein, index, évaluation
├── scan.ts             # orchestrateur (événements, debounce, générations)
├── map-layer.ts        # couche de surlignage + checkbox layer switcher
├── fix.ts              # application du nom officiel (jamais de save)
└── ui/                 # onglet latéral
```

Le matching utilise trois niveaux de normalisation: K0 (brut), K1 (cosmétique, accents conservés), K2 (accents pliés, tiret ↔ espace, abréviations étendues — table extensible dans `src/matching/normalize.ts`). Le fuzzy ne propose une correction que si le candidat est unique.

## Checklist de test terrain

- Lausanne (FR), Berne (DE), Biel/Bienne (bilingue), Lugano (IT).
- Un viewport à cheval sur deux communes.
- Une jonction autoroutière: tout doit être ignoré (types non vérifiés).
- Introduire une typo volontaire → statut NEAR avec suggestion → fix → Ctrl+Z (ne pas sauvegarder).
- Réseau: ≤ 30 req/min, zéro requête en revenant sur une zone déjà scannée (< 24 h).

## Hypothèses à valider en conditions réelles (v0.1)

1. Seuil de zoom par défaut (15) vs chargement du data model segments.
2. Séparateur `/` des libellés bilingues dans les données réelles.
3. Correspondance `zip_label` ↔ ville Waze (d'où le scoping `off` par défaut).
4. Taille de tuile 0.02° en zone urbaine dense (pagination).

## Roadmap

- v0.2-v0.3: livré dans cette version initiale (groupes, fuzzy, bilingue, scoping, navigation).
- v2 (idées): matching géométrique (`returnGeometry=true`, appariement à la ligne officielle la plus proche — détecte "bon nom, mauvaise rue"), audit hors-ligne par commune via le CSV quotidien de data.geo.admin.ch, UI fr/de.

## Données et licence

Données: © swisstopo / geo.admin.ch, répertoire officiel des rues (`ch.swisstopo.amtliches-strassenverzeichnis`), gratuit et sans clé API, limites d'usage FSDI: 40 req/min.

Code: MIT.
