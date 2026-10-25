# Reproducible build (for add-on store reviewers)

Shomer's JavaScript is bundled and minified with esbuild, and its filter lists are compiled at build time. The source package submitted to addons.mozilla.org contains everything needed to rebuild the uploaded file byte for byte, including a snapshot of the filter lists used (`.cache/lists/`), so no network access is needed apart from `npm ci`.

## Requirements

- Linux, macOS or Windows (WSL)
- Node.js 22 (any 22.x) and npm 10
- `zip`/`unzip` are not needed; packaging is done in Node

## Steps

```bash
npm ci                       # exact dependency versions from package-lock.json
npm run build:reproducible   # compile lists from .cache/lists (offline) → build → package
```

The result is `artifacts/shomer-firefox-<version>.zip` (and the Chrome equivalent). It should be identical to the uploaded package:

```bash
sha256sum artifacts/shomer-firefox-*.zip
```

## What the build does

1. `scripts/compile-lists.ts --offline` parses the filter lists in `.cache/lists/` and the Public Suffix List, and writes declarativeNetRequest rulesets, cosmetic and scriptlet data to `build/` (and `src/generated/psl.ts`).
2. `scripts/build.ts` bundles the TypeScript in `src/` with esbuild (one file per entry point, no remote code) and writes the manifest for each browser to `dist/<browser>/`.
3. `scripts/package.ts` zips `dist/<browser>/` with fixed timestamps and file order.

Timestamps come from `releaseDate` in `package.json` (or `SOURCE_DATE_EPOCH`), never from the clock.

## Notes for reviewers

- The add-on makes **no network requests of its own** and loads no remote code. All rules and scripts ship in the package.
- `rulesets/easyprivacy.json` contains names of cryptocurrency-mining domains because it **blocks** them; the add-on does not mine anything.
- Scripts registered in the page's MAIN world (`content/fingerprint-*.js`, `scriptlets/*.js`, `content/gpc.js`) are the fingerprint shield and filter-list scriptlets; their source is in `src/content/fingerprint/` and `src/scriptlets/`.
