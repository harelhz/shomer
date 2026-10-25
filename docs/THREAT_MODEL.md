# Threat model

Shomer runs with powerful permissions (`<all_urls>`, request observation, script injection) on every page a person visits. This document describes what it protects, from whom, how, and where its protection ends.

## Assets

1. **The user's cross-site identity**: the ability of third parties to recognise the same browser on different sites.
2. **The user's browsing data**: which sites are visited, what is done there.
3. **The integrity of the extension**: its settings, rules and learned data, and the privileges it holds.

## Adversaries

| Adversary                                  | Capabilities                                                                 | Goal                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **A. Tracking networks**                   | Third-party scripts, pixels and iframes on many sites; cookies; bounce links | Link visits across sites                                                     |
| **B. Fingerprinters**                      | JavaScript on the page (first or third party)                                | Identify the browser without cookies by measuring rendering, audio, hardware |
| **C. Hostile pages**                       | Arbitrary JavaScript and DOM in the page                                     | Detect or disable Shomer, poison its learning, escalate into the extension   |
| **D. Hostile or compromised filter lists** | Content of a bundled list                                                    | Abuse Shomer's privileges via crafted filters                                |
| **E. Compromised renderer**                | Can send arbitrary messages a content script could send                      | Change settings, exfiltrate data                                             |
| **F. Hostile backup file**                 | A crafted JSON the user imports                                              | Corrupt state, inject code                                                   |

Out of scope: a compromised browser or OS, network attackers (that's the job of HTTPS), and malicious extensions with equal or higher privileges.

## Mitigations

### A. Tracking networks

- Filter lists compiled to DNR block known ad and tracking endpoints before any connection is made.
- Behavioural learning blocks unknown trackers after they're seen on 3 sites. Cookie-blocking keeps site-critical domains working without letting them identify you.
- URL cleaning strips click identifiers (`gclid`, `fbclid`…) from navigations.
- GPC/DNT headers give a legal opt-out signal where laws recognise it (CCPA, CPA…).
- Cookie banners are answered with _reject_, so no consent is recorded on the user's behalf.

### B. Fingerprinters

- Canvas, WebGL and audio outputs get deterministic per-page noise; strict mode extends this to font metrics and DOM measurements and normalises hardware values.
- The noise is position-based and stable within a page, which defeats the "read twice and compare" test for random noise. It changes between pages, so hashes can't link visits.
- Patched functions are indistinguishable by `toString`, `name` or `length`.
- The "borrow pristine prototypes from a new iframe" bypass is closed from both the parent and the child side, and all frames of a page share a seed so they agree with each other.
- WebRTC is limited to the default public interface, so local IPs don't leak.

### C. Hostile pages

- **No secrets in the page.** The noise seed lives in a closure and is never written anywhere the page can read. Knowing it would allow the noise to be removed.
- **Untrusted reports.** Fingerprinting reports reach the background through a DOM event that the page could also fire. They're rate-limited (50 per frame), parsed defensively, and only count as a tracking signal if the reported script's domain actually loaded in that tab. A page can therefore inflate its own fingerprinting counter, but it can't make Shomer block an arbitrary domain. Even a successful fake report only adds one site to that domain's count.
- **Cosmetic CSS** is injected with user origin, so pages can neither override nor remove it.
- **Picker UI** lives in a closed shadow root, and page-derived strings are inserted as text, never HTML.

### D. Hostile filter lists

- Selectors containing `{`, `}`, comments or unbalanced brackets are rejected, so a filter can't escape its CSS rule to inject arbitrary styles.
- `:style()` declarations containing `url(` are dropped, so a filter can't make the browser request a URL (a tracking beacon via CSS).
- A `$domain=` list made only of entities is rejected instead of becoming global, and match-everything rules are refused.
- Untrusted cookie and storage scriptlets can only write values from a short safe list. They can't plant identifiers.
- Lists are pinned at build time. There's no remote list loading at runtime, so a hijacked list server can't change behaviour without a new release (and its review).

### E. Compromised renderer

- Every message is checked against `sender.id`. Settings-changing messages (`PRIVILEGED_MESSAGES`) are only accepted from extension pages (`sender.url` under the extension origin), never from content scripts.
- The one write a content script may request, adding a picker filter, is constrained: it must be a valid, safe selector, and it is scoped to the sender's own hostname (`host##selector`). It cannot add network rules.
- Inputs from content scripts are bounded (token counts, string lengths) and type-checked.

### F. Hostile backup files

- Imports pass through `sanitizeSettings` and `sanitizeTrackerDb`, which allowlist keys, validate domains, clamp numbers and cap string lengths. The result is always a well-formed state.
- Imported data is never evaluated or used as HTML.

## Design principles

- **Least data.** Shomer stores only what it needs (settings, learned tracker domains with the sites they were seen on), locally. It makes no network requests of its own and has no telemetry.
- **No remote code.** Everything that runs is packaged and reviewable. The extension-page CSP is `script-src 'self'`.
- **Fail closed for privacy, open for usability.** If a step of `applyAll()` fails, the others still run, and the error is shown in the dashboard instead of the extension silently doing nothing.
- **Refuse rather than mistranslate.** A filter that can't be expressed exactly is reported as unsupported, never approximated in a way that could over-block or under-block.

## Known limitations

| Limitation                                   | Why                                                                                                                        | Impact                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shomer's presence is detectable              | Noise can be detected statistically; patched functions add frames to error stack traces                                    | A site can tell _some_ protection is active. It can't recover the true fingerprint. This adds entropy, as with every anti-fingerprinting tool except Tor Browser's uniformity approach. |
| Workers aren't covered                       | Content scripts don't run in Web Workers, so `OffscreenCanvas` inside a worker is unprotected                              | A determined fingerprinter could render in a worker. On the roadmap.                                                                                                                    |
| Learned blocks are themselves a fingerprint  | The set of blocked trackers reflects browsing history; a site can probe which trackers load (a known Privacy Badger issue) | Learning can be turned off in the dashboard; the lists still apply.                                                                                                                     |
| Lists update with releases only              | MV3 static rulesets can't change at runtime                                                                                | New ads may slip through until the next release. "My filters" works immediately.                                                                                                        |
| `$popup`, `$csp`, `$replace`, HTML filtering | Not expressible in DNR                                                                                                     | These filters are reported as unsupported (about 2.3% of the bundled lists).                                                                                                            |
| GPC JS property is visible                   | It's meant to be: the GPC spec defines it                                                                                  | None                                                                                                                                                                                    |
| Firefox block counter                        | Firefox lacks DNR match feedback for the badge                                                                             | The count relies on webRequest error reporting, which may differ by version.                                                                                                            |

## Reporting

See [SECURITY.md](../SECURITY.md).
