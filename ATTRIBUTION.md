# Attribution

Largo Ad Blocker includes rules derived from these filter lists:

- **EasyList** — https://easylist.to/ — © The EasyList authors
  (https://github.com/easylist/easylist/graphs/contributors)
- **EasyPrivacy** — https://easylist.to/ — © The EasyList authors
- **Adblock Warning Removal List** — https://github.com/easylist/antiadblockfilters — © The EasyList authors

All three lists are dual-licensed, at your choice, under:

- GNU General Public License v3 or later (https://www.gnu.org/licenses/gpl-3.0.html)
- Creative Commons Attribution-ShareAlike 3.0 Unported (https://creativecommons.org/licenses/by-sa/3.0/)

List license: https://easylist.to/pages/licence.html

The rules in `rules/` and the selectors in `content/` are an automatic transformation of those lists
(conversion to Chrome declarativeNetRequest rules and to CSS) made by `scripts/update-lists.ts`.
Filters that Chrome cannot express have been dropped. This derived work is distributed under GPLv3
(see `LICENSE`).

## Autoconsent

Automatic cookie banner rejection (`content/consent.js`, `content/consent-frame.js` and the snippets
run by `background.js`) includes, unmodified, the library and rules of **Autoconsent** —
https://github.com/duckduckgo/autoconsent — © Duck Duck Go, Inc.

It is distributed under the Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/). The source
code of the included version (the one pinned in `package.json`) is available at
https://www.npmjs.com/package/@duckduckgo/autoconsent and in the repository above.
