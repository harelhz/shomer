# Contributing to Shomer

Thanks for helping! Whether it's a broken-site report, a filter, a cookie-consent rule or code, contributions are welcome.

## Reporting a broken site

Use the **Report issue** button in the popup, or open a [broken site](../../issues/new?template=broken_site.yml) issue. Tell us which module you had to turn off (Ads, Trackers, Fingerprint or Cookie banners) for the site to work: it narrows the problem down a lot.

## Development setup

Requirements: Node.js 20+ (see `.nvmrc`), and Chromium for the end-to-end tests (`npx playwright install chromium`).

```bash
npm ci
npm run build:dev      # unminified build with sourcemaps → dist/chrome, dist/firefox
npm run check          # typecheck + lint + unit tests
npm run build:chrome && npm run test:e2e
```

Load `dist/chrome` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked) and reload it after each build.

## Guidelines

- **Tests.** Every behaviour change comes with a test. Pure logic goes in `tests/unit`. Anything involving the browser's DNR engine, injection timing or real pages goes in `tests/e2e`.
- **Keep shared code pure.** `src/shared/` runs both in Node (build) and in the extension; it must not use browser or Node APIs.
- **Untrusted input.** Treat everything coming from web pages, filter lists, content scripts and imported files as hostile. Read [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) before touching messaging, injection or the filter compiler.
- **No remote code, no telemetry.** Pull requests that add network requests or analytics will not be accepted.
- **Style.** Prettier and ESLint are enforced in CI (`npm run format`, `npm run lint`). Comments explain _why_, not _what_.
- **Commits.** Small, focused commits with descriptive messages.

## Adding a cookie-consent rule

Rules live in `src/data/cookie-rules.ts`. A rule needs a `detect` selector for the dialog and `reject` steps that _refuse_ consent. Rules must never accept. Add a unit test if the rule uses `if`/`else` branches, and check the selectors on a live site.

## Adding a filter

High-confidence domains and fixes go in `filters/shomer-base.txt`. Check first whether EasyList, EasyPrivacy or uBlock's lists already cover it, and report it upstream when it belongs there.

## License

By contributing you agree that your contributions are licensed under the GPL-3.0-or-later.
