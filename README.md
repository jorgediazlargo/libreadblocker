# Largo Ad Blocker

A Chrome extension (Manifest V3) that blocks ads and trackers with [EasyList](https://easylist.to/),
EasyPrivacy and the Adblock Warning Removal List, which removes "turn off your ad blocker" walls. It
also strips tracking parameters from links (`utm_*`, `fbclid`, `gclid`…) and clicks "reject" on
cookie banners. No telemetry, no accounts and no network requests of its own. No "acceptable ads"
either.

The UI is in English, with a Spanish translation (`static/_locales/`); Chrome picks one based on
the browser language.

`dist/` is ~5.3 MB. When loaded, Chrome adds ~4.2 MB of rule indexes in `dist/_metadata`, so the
installed extension takes ~9.7 MB.

## Usage

```bash
pnpm install
pnpm build          # builds dist/
pnpm package        # clean build + largo-ad-blocker-<version>.zip for the Chrome Web Store
```

In `chrome://extensions`, turn on developer mode, click **Load unpacked** and pick `dist/`.

The icon shows how many requests were blocked on the tab. The popup turns blocking off for the
current site. The allowlist is stored in `chrome.storage.sync`, so it is shared across computers
signed in to the same Chrome account; it fits about 400 sites because of the 8 KB per-key limit.

## Updating the lists

```bash
pnpm update-lists   # downloads the lists and regenerates generated/
pnpm build
```

Then click ↻ on the extension card in `chrome://extensions`. The generated rules (`generated/`) are
committed, so the build needs no network. `pnpm update-lists --offline` reuses the lists cached in
`.cache/lists`.

Manifest V3 doesn't allow downloading rules at runtime, so users only get new filters when a new
version is published. The popup footer shows the date of the oldest bundled list.

## Clean links

`filters/largo-links.txt` lists the parameters that only exist to track campaigns and clicks, using
the `$removeparam=name` syntax. They become DNR `redirect` rules with `queryTransform.removeParams`
in a separate ruleset (`links`), which can be switched off from the popup.

- Exact names only: DNR has no regex or wildcards here, so `utm_*` is listed one parameter at a time.
- With no resource type, a rule only applies to top-level navigation (`main_frame`).
- A rule with no URL pattern only fires when the URL carries the parameter (`^name=`) and removes all
  of them in a single redirect.
- Affiliate identifiers (`irclickid`, `tag`…) are not included: removing them breaks cashback and
  commissions.
- URLs on allowlisted sites are left untouched.

## Cookie banners

Uses DuckDuckGo's [Autoconsent](https://github.com/duckduckgo/autoconsent) (MPL 2.0), with its rules
for several hundred consent managers and sites: it detects the banner and clicks "reject" (or calls
the consent manager's API). If there is no rule, it looks for a reject button by its text. If the
banner has no way to reject, it is left alone: **it never accepts and never hides**.

- "Accept or subscribe" walls offer no free reject option and are left as they are.
- Some rules need to read page variables (`window.Cookiebot`, for example). The content script asks
  the service worker, which runs one of Autoconsent's predefined snippets, chosen by name, with
  `chrome.scripting`; never code that arrives in the message. That is why, with this module on, the
  service worker wakes up on every page load.
- The Autoconsent version is pinned in `package.json`; its rules are updated by bumping that version
  and running `pnpm build`.
- `node scripts/_modules.ts [links|cookies] [url…]` tests both modules in real Chrome and saves
  screenshots with and without the extension in `.cache/modules/`.

## Custom fixes

`filters/largo.txt` is our own list in Adblock Plus syntax, converted together with EasyList and the
other lists. It covers cases those lists miss, such as Google Funding Choices' anti-adblock wall.
After editing it, run `pnpm update-lists --offline && pnpm build`.

## How it works

| Piece | What it does | When it runs |
|---|---|---|
| `rules/*.json` | Static `declarativeNetRequest` rules generated at build time | Applied by Chrome; the extension runs no code |
| `content/generic.css` | EasyList generic selectors | Chrome injects the CSS into every frame (no JS) |
| `content/always.js` | ~300 generic selectors with per-site exceptions and rules for `example.*` | Every page, `document_start`, ~48 KB |
| `content/bNN.js` | Site-specific selectors for ~7,800 sites, split into 32 groups | Only on the sites in its group (`matches`) |
| `rules/links.json` | `redirect` rules that strip tracking parameters | Applied by Chrome on every navigation |
| `content/consent.js` | Autoconsent with all its rules (~550 KB) | Every page (top frame only), `document_start` |
| `content/consent-frame.js` | Autoconsent with the iframe rules (~115 KB) | Every iframe, `document_start` |
| `background.js` | Registers the content scripts, the allowlist rule and the links ruleset; runs Autoconsent snippets | On install, on settings changes, from the popup, or when a cookie rule asks |
| `popup.html` | Per-site switch, counter, and switches for links and cookies | When the popup opens |

- **Allowlist:** one dynamic `allowAllRequests` rule (priority 1000) with the allowed sites, plus
  `excludeMatches` on the content scripts.
- **Counter:** DNR's `displayActionCountAsBadgeText`. No `webRequest` and no
  `declarativeNetRequestFeedback` permission needed.
- **No `MutationObserver`:** CSS rules already apply to elements added later.

### Filter conversion (`src/convert/`)

- `||domain^` (with or without options) is grouped into rules with `requestDomains`, so ~85,000
  domain filters fit in a few rules.
- `$third-party`/`$first-party`, `$domain=` (`initiatorDomains` and `excludedInitiatorDomains`),
  resource types, `$match-case`, `$important` and `$method=` map to the equivalent DNR conditions.
- `@@` becomes `allow`; `@@…$document` becomes `allowAllRequests`; `@@||host^$elemhide` and
  `$generichide` become cosmetic exclusions.
- `$removeparam=name` becomes `redirect` with `queryTransform.removeParams`; those sharing a condition
  are grouped into one rule. Regex, negated or nameless forms are dropped.
- **Dropped:** `$popup`, `$rewrite`, `$redirect`, `$csp`, `$sitekey`, regexes RE2 can't handle
  (lookaround, backreferences), `example.*` entities in `$domain=` (exclusions) and extended cosmetic
  filters (`#?#`, `:-abp-*`, `:has-text`, style injection `{…}`). `generated/report.json` lists how
  many and why.
- **Regex:** `pnpm update-lists` opens headless Chrome and drops the ones `isRegexSupported` rejects.
  Chrome caps each regex at 2 KB of compiled memory, and repetitions like `.{100,}` exceed it. If it
  can't find Chrome (`CHROME_PATH`), it warns and keeps them all.
- **Chrome limits** (checked against the DNR docs, November 2026): 30,000 guaranteed static rules per
  extension and 1,000 regex rules. If trimming were needed, exceptions are kept first, then domain
  rules, host-anchored patterns, other patterns and, last, regexes.

## Development

```bash
pnpm test        # converter tests (node:test)
pnpm typecheck
pnpm verify      # real Chrome with a temporary profile: pages with and without the extension, popup, allowlist
```

`pnpm verify` uses the installed Chrome (`CHROME_PATH` to change it) and saves screenshots and a
report in `.cache/verify/`.

## Chrome Web Store

The listing text, permission justifications, privacy answers and images are in [`store/`](store/);
the step-by-step guide is [`store/PUBLISHING.md`](store/PUBLISHING.md) and the privacy policy is
[`PRIVACY.md`](PRIVACY.md).

## License and attribution

Code under GPLv3 or later (`LICENSE`). The rules derive from EasyList, EasyPrivacy and the Adblock
Warning Removal List (© The EasyList authors, GPLv3 / CC BY-SA 3.0), and cookie rejection uses
Autoconsent (© Duck Duck Go, Inc., MPL 2.0); see `ATTRIBUTION.md`, which ships in `dist/`.
