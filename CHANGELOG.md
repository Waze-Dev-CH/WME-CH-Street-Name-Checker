# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [0.7.0] - 2026-06-12

### Added
- Issue box in the segment edit panel: selecting a segment shows its scan verdict (status, explanation, current name -> official suggestion) with Fix and Fix all buttons. Unlike the 0.4.0 experiment, there is no search field. Toggleable in the settings.

## [0.6.0] - 2026-06-12

### Added
- `WRONG_TYPE` status: detects a wrong way-type word when the rest of the name is unique in the area ("Chemin de la Guérite" -> official "Route de la Guérite" in Avenches; "Bahnhofweg" -> "Bahnhofstrasse"). One-click fixable. Ambiguous stems (e.g. both "Rue du Moulin" and "Route du Moulin" exist) are deliberately left unmatched.

## [0.5.0] - 2026-06-12

### Fixed
- Massive false `NOT_FOUND` reports near the viewport edges: the WME data model loads segments well beyond the visible area, and those segments were checked against an official-name index that did not cover them. Segments outside the fetched tiles are now skipped until you pan over them. (Reported on Poliez-Pittet, where "Chemin des Essinges" was flagged although it is in the federal register.)

### Added
- Article-insensitive matching (French/Italian function words): "Chemin de Montaz" now matches the official "Chemin de la Montaz" and is reported as a fixable `VARIANT` instead of `NOT_FOUND`. German articles are deliberately not stripped (integral to names like "Im Grund").

## [0.4.3] - 2026-06-12

### Added
- This changelog, linked from the sidebar tab footer (version number + link).
- README rewritten with collapsible sections in French, German, Italian and English.

## [0.4.2] - 2026-06-12

### Added
- Locate button (⌖) on every issue row: centers the map on the segment and selects it.

## [0.4.1] - 2026-06-12

### Removed
- Segment edit panel helper (introduced in 0.4.0), after field feedback. The sidebar tab and map layer remain the single workflow.

## [0.4.0] - 2026-06-12

### Added
- Companion helper injected in the segment edit panel: status badge, one-click apply, search over official names.

## [0.3.0] - 2026-06-12

### Added
- Swiss guideline checks computed from the loaded data model, no extra API calls (toggleable): `MICRO_SEGMENT` (drivable segment < 5 m, roundabouts excluded), `LOOP` (loops made of fewer than 3 segments, same-endpoint pairs and self-loops), `NARROW_MISUSE` (Narrow Street one-way or < 50 m).

## [0.2.0] - 2026-06-12

### Added
- UI localized in English, French, German and Italian; follows the WME locale by default, override in the settings.

### Changed
- Suggestion notes and fix errors became structured codes, localized at display time.

## [0.1.1] - 2026-06-12

### Added
- Collapsible legend in the sidebar tab explaining every status color.

## [0.1.0] - 2026-06-12

### Added
- Initial release: validation of Waze street names against the official Swiss street register (`ch.swisstopo.amtliches-strassenverzeichnis`, api3.geo.admin.ch) for the current viewport.
- Three-level matching (cosmetic / abbreviation-accent variants / bounded fuzzy with unique suggestion), bilingual `A/B` labels, alternate names counting as OK.
- Map highlight layer with per-status colors, layer switcher checkbox.
- Sidebar tab: scan state, filterable counters, grouped issue list, per-segment and per-group fixes (capped, confirmed, never auto-saved).
- Tile cache (LRU, 24 h TTL), 30 req/min rate limiting, request abort on map moves.
