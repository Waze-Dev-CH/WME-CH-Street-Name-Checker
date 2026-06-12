---
name: release
description: Release a new version of the WME CH Street Name Checker userscript — bump the version, update the CHANGELOG, run the verification loop, rebuild dist, commit, tag, and (after explicit confirmation) push so GitHub raw and Greasy Fork auto-update. Use when the user wants to ship, publish, release, or cut a new version.
---

# Release the userscript

Distribution model: `dist/wme-ch-street-name-checker.user.js` is **committed** on `main`
and served by `raw.githubusercontent.com` via the userscript `@updateURL`/`@downloadURL`.
Pushing to `main` therefore deploys to every user immediately. Greasy Fork (once set up,
see `docs/greasy-fork.md`) re-syncs automatically from the same raw URL whenever `@version`
increases — so no manual Greasy Fork action is needed per release.

## Absolute rule — push

**Never run `git push` except as the final, explicitly confirmed step below.** Prepare and
advise the action (show the exact command, the version, the diff), but only push on an
explicit "go" from the user. Everything before the push is local and reversible.

## Procedure

1. **Preconditions.** Confirm the current branch is `main` and the working tree contains
   only the intended changes (`git status`). If unrelated changes are staged, stop and ask.

2. **Choose the bump** (SemVer): `patch` for fixes, `minor` for new features, `major` for
   breaking changes. Infer it from the diff; if ambiguous, ask the user.

3. **Verification loop — mandatory and blocking.** Run:
   ```
   npm run typecheck && npm test && npm run lint
   ```
   If anything fails, stop and fix before going further. A release never ships red.

4. **Update `CHANGELOG.md`.** Insert a new section at the top, above the latest one:
   ```
   ## [X.Y.Z] - YYYY-MM-DD
   ```
   Use today's real date. Group entries under Keep a Changelog headings (`Added` /
   `Changed` / `Fixed`), written from the actual diff in the project's existing style
   (full sentences explaining the user-visible effect, see prior entries).

5. **Bump + build:** `npm run release <patch|minor|major>`. This rewrites the version in
   `package.json`, rebuilds `dist/`, and asserts the built `@version` matches `package.json`
   (aborts on mismatch). Do not hand-edit the version or dist.

6. **Commit** the release together:
   ```
   git add package.json CHANGELOG.md dist/wme-ch-street-name-checker.user.js
   # plus any src/ changes that belong to this release
   git commit
   ```
   Message: an imperative one-line summary matching the CHANGELOG entry (repo style),
   followed by the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

7. **Annotated tag:** `git tag -a vX.Y.Z -m "vX.Y.Z"`.

8. **Confirm, then push (the ONLY push in the project).** Show the recap — new version,
   committed files, tag, `git log -1` — and the exact command:
   ```
   git push origin main --follow-tags
   ```
   Execute it **only** after the user explicitly says go. Without confirmation: stop here,
   everything stays local, and tell the user it is ready to push when they are.

9. **Post-release.** Print the install/update URL
   (`https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js`)
   and remind that installed clients auto-update via `@updateURL` and Greasy Fork re-syncs
   on its own.

## Notes

- The bump must always increase monotonically — that is what lets clients and Greasy Fork
  detect the update. `npm run release` guarantees this; never reuse or lower a version.
- Test-only or tooling changes that leave `dist/` byte-identical do not need a release:
  commit them plainly (still no push without confirmation).
