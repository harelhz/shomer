# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.1] — 2026-10-25

### Changed
- Links point to the project's GitHub repository.
- Reproducible builds: timestamps come from `releaseDate`, and the reviewer source package includes the filter-list snapshot.

## [1.0.0] — 2026-10-25

### Added

- **Ads & content blocking**: ABP/uBO filter compiler targeting Manifest V3 `declarativeNetRequest`; bundled EasyList, EasyPrivacy, uBlock filters (+ Privacy, + Cookie notices) and Peter Lowe's list; cosmetic filtering with lowly-generic optimisation; procedural filters; 36 uBO-compatible scriptlets; redirect surrogates; element picker and zapper; "My filters" editor.
- **Tracker learning**: cookie-entropy and fingerprinting heuristics, 3-site threshold, yellowlist cookie-blocking, multi-domain first parties, per-domain Block / Cookies / Allow controls, Global Privacy Control, URL cleaning.
- **Fingerprint shield**: deterministic canvas, WebGL and audio noise; native-looking patched functions; iframe-bypass protection with a shared per-page seed; strict mode for fonts, DOM rects and hardware info; WebRTC IP-leak protection.
- **Cookie banners**: reject rules for 33 consent platforms, a multilingual heuristic (including Hebrew), banner hiding and scroll restoration.
- Popup, dashboard and onboarding; Chrome and Firefox builds; unit and end-to-end test suites; CI.
