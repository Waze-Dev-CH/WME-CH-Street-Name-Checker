# Publishing on Greasy Fork

The script is distributed today straight from GitHub: the userscript `@updateURL` /
`@downloadURL` point at
`https://raw.githubusercontent.com/Neprena/WME-CH-Street-Name-Checker/main/dist/wme-ch-street-name-checker.user.js`,
and installed clients auto-update from there.

[Greasy Fork](https://greasyfork.org) is the standard userscript marketplace. Listing the
script there gives it discoverability and a second, trusted install source. Greasy Fork can
**sync automatically** from our raw GitHub URL, so once it is set up there is **nothing to do
per release** — it pulls each new version on its own as long as `@version` keeps increasing.

## One-time setup

1. Create a Greasy Fork account (sign in with GitHub).
2. **Post a script → Import from a URL**, and paste the raw `@downloadURL` above.
3. Enable **"Set this script to sync from a URL"** (automatic updates) pointing at the same
   raw URL. Greasy Fork then re-imports whenever the remote `@version` is higher than the
   listed one.
4. Greasy Fork generates its own install/update URLs for users who install from the listing;
   those users are served by Greasy Fork, which mirrors our GitHub release.

## What the release flow already guarantees

The `/release` skill and `npm run release` keep the listing healthy automatically:

- **Monotonic `@version`** — `npm run release` only ever bumps the SemVer forward, which is
  exactly the signal Greasy Fork (and Tampermonkey clients) use to detect an update.
- **Header completeness** — `userscript-header.txt` already carries every metadata key
  Greasy Fork requires: `@name`, `@namespace`, `@version`, `@description`, `@license` (MIT),
  `@homepageURL`, `@supportURL`.
- **Readable source** — the bundle is built by esbuild **without minification**; Greasy Fork
  rejects heavily obfuscated/minified code, so keep `build.mjs` minify-free.

## After the listing exists

Add the Greasy Fork install link next to the existing GitHub install links in the four
language "Installation" sections of `README.md` (and the header link on line 7). It is left
out for now to avoid shipping a dead link before the page is created.
