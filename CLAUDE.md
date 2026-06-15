# CLAUDE.md — WME CH Street Name Checker

Project-specific guidance for Claude Code. **These instructions override the generic global
`~/.claude/CLAUDE.md`** wherever they conflict (notably the TypeScript style rules below).

## Overview

Tampermonkey userscript (TypeScript, bundled with esbuild) for the **Waze Map Editor (WME)**.
It validates Waze street names against the **official Swiss street register** (swisstopo /
GeoNV) via the `api3.geo.admin.ch` API, highlights mismatches in a side tab and a map layer,
and offers one-click fixes. The build produces a single committed userscript,
`dist/wme-ch-street-name-checker.user.js`, served to users straight from GitHub raw.

## Commands

```sh
npm run build       # bundle src/main.user.ts -> dist/...user.js (version from package.json)
npm run dev         # esbuild --watch (use dist/dev.user.js loader in Tampermonkey)
npm test            # vitest run
npm run test:watch  # vitest watch
npm run typecheck   # tsc --noEmit
npm run lint        # eslint src test
npm run format      # prettier
npm run release <patch|minor|major>   # bump + build + assert @version (see Release)
```

**Verification loop — run before every commit:**

```sh
npm run typecheck && npm test && npm run lint
```

A previous release shipped a broken test because the suite was never run; do not skip this.

## Release & deployment (CRITICAL)

- `dist/...user.js` is **committed** and **is** the deployment: the userscript `@updateURL`
  points at `raw.githubusercontent.com/.../main/dist/...`. **Pushing to `main` updates every
  installed user immediately.**
- One remote: `origin` (GitHub) is the **deployment** remote read by `@updateURL`/Greasy Fork.
  `/release` pushes it.
- Always release through the **`/release` skill** (`.claude/skills/release/`). It runs the
  verification loop, updates `CHANGELOG.md`, bumps + builds, commits, tags `vX.Y.Z`, and pushes to GitHub.
- **Push only via `/release`, and only after explicit user confirmation.** Never run
  `git push` otherwise. Local commits and builds are fine without asking; the push is not.
- Bump the version only with `npm run release <patch|minor|major>` — it rewrites
  `package.json`, rebuilds `dist/`, and asserts the built `@version` matches. Never hand-edit
  the version or `dist/`.
- Greasy Fork (once listed) re-syncs automatically from the raw URL on each version bump — no
  per-release action. See `docs/greasy-fork.md`.
- Doc/tooling/test-only changes that leave `dist/` byte-identical do **not** need a release:
  commit them plainly (still no push without confirmation).

## Architecture

- `src/main.user.ts` — entry point: init WME SDK, wire Scanner, layer, tab, edit-panel, shortcuts.
- `src/scan.ts` — `Scanner`: orchestration. Debounced scan on map moves, gating (min zoom,
  inside-Switzerland, max area), chunked evaluation with generations to cancel stale runs,
  re-evaluation on edits.
- `src/geoadmin/` — `client` (API), `tiles` (bbox→tiles), `idb-store` (IndexedDB cache),
  `links` (map.geo.admin.ch permalinks, WGS84→LV95), `types`.
- `src/matching/` — `normalize` (K0/K1/K2), `official-index` (cascade lookup), `evaluate`
  (per-segment verdict), `spatial` + `distance` (geometry matching).
- `src/ui/` — `tab`, `edit-panel`, `styles`. Plus `map-layer`, `i18n` (fr/de/it/en),
  `settings`, `guidelines`, `fix`, `shortcuts`, `sdk`, `log`.

## Matching model

- Three normalization levels in `normalize.ts`: **K0** raw, **K1** cosmetic (typography/case),
  **K2** expanded (accent folding, abbreviations, hyphen/space). Accents are kept at K1.
- `official-index.ts` cascade: exact → cosmetic → variant → bounded fuzzy → stem, with ranking
  and ambiguity guards.
- `evaluate.ts` produces a `Verdict`; issue statuses are ordered by severity in
  `settings.ts ALL_STATUSES`.
- **Geometry takes precedence over name-only verdicts** (since 1.9.0): when a different official
  street clearly runs under the segment, `WRONG_STREET` is emitted regardless of the name-match
  level. Safeguards: the matched name's own axis must be far (`ownDistanceM > FAR_STREET_M`, 40 m)
  and the other street must cover ≥ `WRONG_STREET_MIN_COVERAGE` (0.8) of the samples.

## Conventions

- **TypeScript style (overrides the global rules):** `interface` and `type` are both used freely —
  do **not** "convert" interfaces. Use **string-literal unions** for closed sets (`IssueStatus`,
  `ScanState`, `CityScoping`); **never `enum`**.
- `tsconfig` is `strict` with `noUncheckedIndexedAccess`: indexed access needs explicit `as`
  casts / guards (this is intentional, not sloppy).
- Comments explain the **why**, not the what. Match the surrounding density.
- Commits: imperative English one-line summary (like the CHANGELOG entry), then a
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- `CHANGELOG.md`: Keep a Changelog format, dated, sentences describing the user-visible effect.
- Tests: vitest, fixtures in `test/fixtures/`. Add a test for every behavior change.
- Not linted: `dist/` and `*.mjs` (so `build.mjs` / `scripts/release.mjs` are outside eslint).

## Gotchas

- The WME SDK package is **types-only**: road-type ids are restated in `settings.ts`.
- Foreign-segment guard is **fail-open**: if Switzerland can't be resolved in the countries
  data model, nothing is excluded (rather than skipping everything).
- The `coveredTiles` guard name-checks only segments inside the fetched area, otherwise every
  edge segment becomes a false `NOT_FOUND`.
- Outside Switzerland the script stays silent (no API calls, no highlights).
