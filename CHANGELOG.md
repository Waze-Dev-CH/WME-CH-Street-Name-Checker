# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [1.9.0] - 2026-06-13

### Changed
- Geometry now takes precedence over name-only verdicts. When a segment's name only needed a small fix (cosmetic, variant, typo or way-type) but a different official street clearly runs underneath, the script reports WRONG_STREET right away instead of first suggesting the spelling fix and only flagging the wrong street on the next scan. This avoids editing the same segment twice. The safeguard is unchanged: WRONG_STREET still requires the matched name's own axis to be far away (> 40 m) with the other street covering most of the segment, so a genuine typo on the correct street is left as a plain name fix.

## [1.8.1] - 2026-06-12

### Fixed
- Nothing was detected anymore since 1.7.0: the foreign-segment guard compared the country abbreviation to a hardcoded "CH", which does not match what WME actually stores, so every Swiss segment was skipped. Switzerland is now identified at runtime from the countries data model (abbreviation CH/CHE or name in any national language) and the guard fails open when it cannot be resolved.

## [1.8.0] - 2026-06-12

### Added
- Direct link to map.geo.admin.ch on every issue (list rows and edit-panel box): opens the spot centered with the official street register layer enabled, in the interface language. WGS84 to LV95 conversion via the official swisstopo approximation formulas.

## [1.7.0] - 2026-06-12

### Added
- Outside Switzerland the script now stays completely silent ("Outside Switzerland" state, no API calls) instead of flagging everything NOT_FOUND. In border viewports, segments whose country is not Switzerland are skipped by the name checks and the Swiss guideline checks alike.

## [1.6.2] - 2026-06-12

### Fixed
- Clicking a group or a locate button no longer makes you lose your place: script-initiated map moves do not trigger an auto-rescan anymore (the list stays as it was), the group zoom never lands below the minimum scan zoom (that state used to clear the list entirely), and the list keeps its scroll position when results refresh.

## [1.6.1] - 2026-06-12

### Added
- WRONG_STREET notes now show how far the current name's own official axis is ("its official axis is ~230 m away"), so borderline overlaps and clear-cut register disagreements can be told apart before fixing.

## [1.6.0] - 2026-06-12

### Changed
- Geometry matching hardened against false positives:
  - bearing filter: official sub-segments must be roughly parallel (within 35°) to the local Waze direction, so cross streets at junctions never compete; the comparison is local per sample, curved streets keep matching;
  - coverage requirement: the winning street must be the closest at 60% of the samples or more, and WRONG_STREET demands 80%;
  - contested vote: when another street runs within 5 m of the winner along the segment, the matcher abstains instead of guessing;
  - acting thresholds tightened from 25 m to 20 m (search radius unchanged).

## [1.5.2] - 2026-06-12

### Fixed
- Freeways named with route designations ("A9", "E62", "A9 - E62", "A1/E25") were NOT_FOUND when freeway checking was enabled: numbered designations (A/E/N/H/T + number, single or combined) are now accepted on highway-class road types. The register never names highways; the Waze numbering convention is the correct one there.

## [1.5.1] - 2026-06-12

### Fixed
- Bare names whose official form carries a multi-word way type were NOT_FOUND (real case: "La Palaz A" vs official "Zone Industrielle La Palaz A" in Payerne). "Zone industrielle/artisanale/commerciale" and Italian "zona industriale/artigianale" now count as way-type prefixes for stem matching.

## [1.5.0] - 2026-06-12

### Added
- Per-status checkboxes in the settings: choose which issue types are reported, applied everywhere at once (map layer, list, counters, next-issue navigation, edit-panel box). Counter chips remain the quick per-session filter on top.

### Changed
- The "show cosmetic differences" toggle is absorbed by the new grid (existing setting migrated automatically).

## [1.4.0] - 2026-06-12

### Changed
- The sidebar list is now sorted by severity then volume: safe fixes first (COSMETIC, VARIANT), then NEAR and WRONG_TYPE, then WRONG_STREET/WRONG_CITY/NOT_FOUND, UNNAMED and guideline checks last. "Next issue" follows the same order.

## [1.3.1] - 2026-06-12

### Added
- Clicking a group in the sidebar list now fits the map to the area covering every segment of the group (and expands it); clicking again collapses without moving the map.

## [1.3.0] - 2026-06-12

### Added
- Multi-word and Romandie abbreviations in the matcher: Z.I. / Z. I. / ZI -> Zone industrielle (reported on "Z.I. Champ Cheval"), ZA -> Zone artisanale, Gd/Gde -> Grand/Grande, All. -> Allee, Esp. -> Esplanade, Anc. -> Ancien/Ancienne, Gen. -> General, Dr -> Docteur, Pt/Pte -> Petit/Petite. Spaced initialisms ("Z. I.") are collapsed before expansion.

## [1.2.1] - 2026-06-12

### Fixed
- Fixing a segment whose street was already correct (stale list, repeated group fix) created an empty edit in the WME stack; it is now a no-op.

## [1.2.0] - 2026-06-12

### Added
- Out-of-locality continuation check: a NOT_FOUND name on a main road (Primary Street, Minor/Major Highway, Freeway) is accepted when an official axis with the exact same name exists within 3 km, via a cached nationwide exact-name lookup (max 10 new lookups per scan). Fixes "Route de Berne" in Corcelles-près-Payerne being flagged although the register entry belongs to neighboring Payerne and the GeoNV register does not name out-of-town stretches.

## [1.1.6] - 2026-06-12

### Fixed
- Names lacking their way-type word were reported NOT_FOUND (real case: Waze "Vers-Chez-Cherbuin" vs official "Rue Vers-chez-Cherbuin" in Corcelles-près-Payerne). Bare names now stem-match against typed official names, with the same single-candidate ambiguity guard, both in the area lookup and in the geometry-based one-to-one comparison.

## [1.1.5] - 2026-06-12

### Changed
- Repository renamed to WME-CH-Street-Name-Checker; homepage, support, download and update URLs updated (GitHub redirects the old name, existing installs keep updating).

## [1.1.4] - 2026-06-12

### Changed
- WME navigation fluidity: segment evaluation now runs in chunks of 250 with event-loop breathing room instead of one long main-thread task; re-evaluation after an edit is debounced (wme-after-edit fires on every WME edit, each one used to trigger a full synchronous pass); the map layer and the sidebar list only rebuild when results actually change instead of on every fetch progress tick; spatial lookups are skipped for unchecked road types.

## [1.1.3] - 2026-06-12

### Changed
- Typography cleanup: em dashes removed from every UI string and document (the name-normalization regex keeps handling them in street names, on purpose).

## [1.1.2] - 2026-06-12

### Fixed
- False `WRONG_STREET` on segments with dense vertices near a junction (reported on "Chemin de la Poste" in Avenches, wrongly suggesting the cross street "Rue René Grandjean"): spatial samples are now spread by arc length (5 points at 10-90% of the segment's real length) instead of by coordinate index, so vertex clusters at curves and junctions no longer skew the nearest-street vote.

## [1.1.1] - 2026-06-12

### Fixed
- Every street reported `NOT_FOUND` with "0 official streets" since 1.0.0: in geojson mode the identify API returns the register fields under `properties`, not `attributes`, so every fetched entry was silently dropped. An integration test against the real API now guards the response shape.
- The persistent cache poisoned by 1.1.0 (empty tiles) is dropped automatically on update (IndexedDB schema bump).

## [1.1.0] - 2026-06-12

### Added
- Keyboard shortcuts, remappable in the native WME keyboard settings: Alt+N selects the next issue, Alt+F fixes the selected segment. On key collision with another script they register unbound.
- Persistent tile cache (IndexedDB): areas scanned in the last 24 h survive a WME reload with zero network requests. Degrades silently to memory-only when IndexedDB is unavailable; Rescan clears both levels.

## [1.0.0] - 2026-06-12

### Added
- Geometry matching (toggleable, on by default): official street axes are fetched with the register entries and matched spatially against Waze segments.
  - `UNNAMED` segments now get a one-click suggestion: the official street underneath.
  - New `WRONG_STREET` status (dark red): the segment's name is official somewhere in the area, but the street underneath carries another name.
  - Ambiguous cases the name-based cascade used to drop (two stems or two fuzzy candidates) are disambiguated by distance.
- Geometries handle real register shapes: MultiLineString, GeometryCollection, and named-area polygons (excluded from spatial matching on purpose).

### Changed
- Tiles now carry geometries (~5-10x heavier, measured ~400 KB on the densest Lausanne tile); the in-memory cache cap is reduced from 300 to 120 tiles accordingly.

## [0.9.0] - 2026-06-12

### Fixed
- Fix buttons gave no feedback and allowed double-clicks: they are now disabled while applying, group fixes show live progress ("3/25…"), and a shared lock ignores any other fix click until the current one finishes. Intermediate re-evaluations during a batch are skipped, making large group fixes noticeably faster.

## [0.8.0] - 2026-06-12

### Added
- Master toggles at the top of the sidebar tab: "Enabled" (disables scanning, the map layer and the edit-panel box entirely, persisted) and "Auto scan" (off = scan only via the Rescan button).

### Fixed
- The edit-panel box now disappears when the layer checkbox is unchecked, instead of showing stale results.

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
