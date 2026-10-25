# Filter syntax

Shomer understands the Adblock Plus / uBlock Origin filter syntax used by EasyList and uBlock's lists. You can write your own filters under **Dashboard → My filters**. This page lists what is supported.

## Network filters

| Filter             | Meaning                                                                |
| ------------------ | ---------------------------------------------------------------------- |
| `                  |                                                                        | ads.example.com^`             | Block requests to `ads.example.com` and its subdomains |
| `                  | https://example.com/ad`                                                | Block URLs starting with this |
| `/banner/*/ad.gif` | Block URLs containing this (`*` = anything)                            |
| `^`                | Separator: anything but a letter, digit or `_-.%`                      |
| `/regex/`          | Regular expression (RE2-compatible: no look-around or back-references) |
| `@@                |                                                                        | cdn.example.com^`             | Exception: never block this                            |
| `! comment`        | Comment                                                                |

### Options (`$…`)

| Option                                                                                                                                                        | Meaning                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script`, `image`, `stylesheet`/`css`, `xmlhttprequest`/`xhr`, `subdocument`/`frame`, `font`, `media`, `object`, `ping`/`beacon`, `websocket`, `other`, `all` | Only these request types; prefix with `~` to exclude                                                                                                                                                                      |
| `document`/`doc`                                                                                                                                              | Block the page itself; on an exception, disable blocking on that site                                                                                                                                                     |
| `third-party`/`3p`, `first-party`/`1p`                                                                                                                        | Only third- or first-party requests                                                                                                                                                                                       |
| `domain=a.com\|~b.a.com` (or `from=`)                                                                                                                         | Only on these sites (`~` excludes)                                                                                                                                                                                        |
| `to=a.com\|~b.com`                                                                                                                                            | Only requests to these domains                                                                                                                                                                                            |
| `denyallow=a.com\|b.com`                                                                                                                                      | Except requests to these domains                                                                                                                                                                                          |
| `method=post\|~get`                                                                                                                                           | Only these HTTP methods                                                                                                                                                                                                   |
| `important`                                                                                                                                                   | Beats exceptions                                                                                                                                                                                                          |
| `match-case`                                                                                                                                                  | Case-sensitive pattern                                                                                                                                                                                                    |
| `redirect=noopjs`                                                                                                                                             | Serve a harmless replacement (`noopjs`, `noopcss`, `nooptext`, `noopframe`, `1x1.gif`, `2x2.png`, `google-analytics_analytics.js`, `googletagservices_gpt.js`, `googlesyndication_adsbygoogle.js`, `amazon_apstag.js`, …) |
| `removeparam=utm_source`                                                                                                                                      | Remove a query parameter (literal names only); empty removes the whole query                                                                                                                                              |
| `badfilter`                                                                                                                                                   | Cancel an identical filter                                                                                                                                                                                                |
| `generichide`, `elemhide`, `specifichide` (exceptions only)                                                                                                   | Disable generic / all / specific element hiding on a site                                                                                                                                                                 |

Not supported, because Manifest V3 can't express them: `popup`, `csp`, `replace`, `header`, `permissions`, `redirect-rule`, `urlskip`, `uritransform`, regex `removeparam`, regex or entity (`example.*`) values in `domain=` for network filters.

## Element hiding

| Filter                                          | Meaning                                           |
| ----------------------------------------------- | ------------------------------------------------- |
| `##.ad-banner`                                  | Hide on every site                                |
| `example.com##.sidebar-ad`                      | Hide on example.com and its subdomains            |
| `example.*##.ad`                                | Hide on example.com, example.de, example.co.il, … |
| `example.com,~shop.example.com##.ad`            | …but not on shop.example.com                      |
| `example.com#@#.ad`                             | Exception                                         |
| `example.com##.box:style(height: 0 !important)` | Apply CSS instead of hiding (no `url()`)          |
| `example.com#$#.box { height: 0 }`              | Same, AdGuard syntax                              |

### Procedural operators (site-specific only)

| Operator                                                       | Matches elements…                                                                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `:has-text(Sponsored)`, `:has-text(/sponsor(ed)?/i)`           | whose text contains the string or matches the regex (aliases: `:contains()`, `:-abp-contains()`) |
| `:has(> .ad)` / `:-abp-has()`                                  | that contain a match (native `:has()` is used when possible)                                     |
| `:not(:has-text(News))`                                        | that don't match                                                                                 |
| `:upward(2)`, `:upward(.card)`                                 | the ancestor N levels up / the closest ancestor matching                                         |
| `:matches-css(position: fixed)`                                | with this computed style (`-before`/`-after` variants)                                           |
| `:matches-attr(/^data-ad/)`, `:matches-attr("class"="/^ad-/")` | with a matching attribute                                                                        |
| `:min-text-length(100)`                                        | with at least N characters of text                                                               |
| `:matches-path(/\/news\//)`                                    | only if the page path matches                                                                    |
| `:xpath(//div[@data-ad])`                                      | selected by XPath                                                                                |
| `:remove()`                                                    | remove instead of hide                                                                           |
| `:remove-attr(onclick)`, `:remove-class(sticky)`               | remove an attribute or class                                                                     |

## Scriptlets

Scriptlet filters (`example.com##+js(set-constant, adsEnabled, false)`) are supported in the bundled lists, but not in "My filters", because MV3 only allows injecting code that ships with the extension. Supported scriptlets (uBO names and aliases):

`set-constant` (`set`), `abort-on-property-read` (`aopr`), `abort-on-property-write` (`aopw`), `abort-current-script` (`acs`), `abort-on-stack-trace` (`aost`), `prevent-addEventListener` (`aeld`), `prevent-setTimeout` (`nostif`), `prevent-setInterval` (`nosiif`), `adjust-setTimeout` (`nano-stb`), `adjust-setInterval` (`nano-sib`), `prevent-requestAnimationFrame` (`norafif`), `prevent-window-open` (`nowoif`), `prevent-eval` (`noeval`), `prevent-fetch` (`no-fetch-if`), `prevent-xhr` (`no-xhr-if`), `json-prune`, `set-cookie`, `set-cookie-reload`, `trusted-set-cookie`, `trusted-set-cookie-reload`, `set-local-storage-item`, `trusted-set-local-storage-item`, `set-session-storage-item`, `trusted-set-session-storage-item`, `cookie-remover` (`remove-cookie`), `trusted-click-element`, `remove-attr` (`ra`), `remove-class` (`rc`), `set-attr`, `remove-node-text` (`rmnt`), `replace-node-text` (`rpnt`), `href-sanitizer`, `refresh-defuser`, `disable-newtab-links`, `nowebrtc`, `fuckadblock-defuser` (`nofab`).
