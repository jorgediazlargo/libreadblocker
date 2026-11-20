# Chrome Web Store listing

Everything the developer dashboard asks for, ready to copy and paste. Images are in
`store/images/en/` (default) and `store/images/es/` (Spanish listing).

## Package

```bash
pnpm package        # clean build + largo-ad-blocker-<version>.zip at the repo root (git-ignored)
```

Upload that zip under **Package → Upload new package**. `manifest.json` is at its root. The
extension's default locale is English (`default_locale: "en"`) with a Spanish translation, so the
store shows the name and summary in both languages automatically.

## Store listing → Product details

- **Language:** English (default). Then add **Spanish** from the language selector at the top of the
  Store listing tab and paste the Spanish texts below.
- **Title:** Largo Ad Blocker (from the manifest).
- **Summary** (from the manifest): Blocks ads and trackers with EasyList and EasyPrivacy, plus a
  reader view. No telemetry, no requests of its own.
- **Category:** Privacy & Security.

**Description (English):**

```
Largo Ad Blocker removes ads and trackers from the pages you visit, and asks for nothing in return.

WHAT IT DOES
• Blocks ads and trackers with the EasyList and EasyPrivacy filter lists, and removes "turn off your ad blocker" walls with the Adblock Warning Removal List.
• Clean links: strips parameters that only exist to follow you (utm_*, fbclid, gclid…) from the links you open. Affiliate codes are left alone, so discounts and commissions keep working.
• Cookies rejected: clicks "reject" on cookie banners for you, using DuckDuckGo's Autoconsent rules. If a banner has no way to reject, it is left as it is: it never accepts on your behalf.
• Reader view: shows just the article, without menus, pop-ups or clutter, in light, sepia or dark and with the text size you like. Open it with Alt+Shift+R (⌥⇧R on Mac), from the toolbar button or by right-clicking the page.
• The icon shows how many requests were blocked on the current tab.
• From the toolbar button you can turn blocking off for a single site, open reader view, and switch clean links and cookie rejection on or off.

PRIVACY
• No telemetry, no analytics, no accounts and no servers: the extension makes no network requests of its own.
• No "acceptable ads" and no paid allowlists.
• Blocking is done by Chrome itself with declarativeNetRequest rules (Manifest V3), so the extension never reads your traffic.
• Reader view works on your device with what the page already loaded: it makes no requests and sends nothing anywhere.
• Your list of allowed sites is saved in your Chrome account and synced across your devices.

OPEN SOURCE
Code licensed under GPLv3: https://github.com/jorgediazlargo/libreadblocker
Filters © The EasyList authors (GPLv3 / CC BY-SA 3.0). Autoconsent © Duck Duck Go, Inc. (MPL 2.0). Readability © Arc90 Inc and Mozilla (Apache 2.0).
```

**Description (Spanish):**

```
Largo Ad Blocker quita los anuncios y los rastreadores de las páginas que visitas, sin pedirte nada a cambio.

QUÉ HACE
• Bloquea anuncios y rastreadores con las listas EasyList y EasyPrivacy, y quita los avisos de «desactiva tu bloqueador» con la Adblock Warning Removal List.
• Enlaces sin rastreo: quita de los enlaces los parámetros que solo sirven para seguirte (utm_*, fbclid, gclid…). No toca los códigos de afiliación, para no romper descuentos ni comisiones.
• Cookies rechazadas: pulsa «rechazar» en los avisos de cookies por ti, con las reglas de Autoconsent de DuckDuckGo. Si un aviso no permite rechazar, lo deja como está: nunca acepta en tu nombre.
• Modo lectura: muestra solo el artículo, sin menús, ventanas emergentes ni distracciones, en claro, sepia u oscuro y con el tamaño de letra que prefieras. Se abre con Alt+Mayús+R (⌥⇧R en Mac), desde el botón o con clic derecho en la página.
• El icono muestra cuántas peticiones se han bloqueado en la pestaña.
• Desde el botón puedes desactivar el bloqueo en un sitio concreto, abrir el modo lectura y apagar o encender los enlaces sin rastreo y el rechazo de cookies.

PRIVACIDAD
• Sin telemetría, sin analítica, sin cuentas y sin servidores: la extensión no hace ninguna petición de red propia.
• Sin anuncios «aceptables» ni listas blancas pagadas.
• El bloqueo lo hace el propio Chrome con reglas declarativeNetRequest (Manifest V3), así que la extensión no lee tu tráfico.
• El modo lectura funciona en tu equipo con lo que la página ya ha cargado: no hace peticiones ni envía nada a ningún sitio.
• Tu lista de sitios permitidos se guarda en tu cuenta de Chrome y se sincroniza entre tus equipos.

CÓDIGO ABIERTO
Código bajo licencia GPLv3: https://github.com/jorgediazlargo/libreadblocker
Filtros © The EasyList authors (GPLv3 / CC BY-SA 3.0). Autoconsent © Duck Duck Go, Inc. (MPL 2.0). Readability © Arc90 Inc y Mozilla (Apache 2.0).
```

**Graphic assets** (use `images/en/` for English and `images/es/` for Spanish):

| Field | File | Size |
|---|---|---|
| Store icon | `store-icon-128.png` | 128×128 (96 px artwork with padding) |
| Screenshots (1–5) | `screenshot-1-before-after.png`, `screenshot-2-popup.png`, `screenshot-3-features.png`, `screenshot-4-reader.png` | 1280×800 |
| Small promo tile | `promo-small-440x280.png` | 440×280 |
| Marquee promo tile (optional) | `promo-marquee-1400x560.png` | 1400×560 |

The screenshots use a made-up example news page, not real websites, with the real extension loaded
in Chrome: all 9 trackers on the page show up as blocked. Screenshots 2–4 are regenerated with
`node scripts/store-images.ts` after `pnpm build`.

**Additional fields:** Homepage URL = https://github.com/jorgediazlargo/libreadblocker · Support URL
= https://github.com/jorgediazlargo/libreadblocker/issues

## Privacy practices

**Single purpose:**

```
Remove ads, trackers and clutter from the pages you read: it blocks ad and tracking requests, hides ad slots, strips tracking parameters from links, rejects cookie banners and offers a reader view that shows just the article.
```

**Permission justifications:**

- **declarativeNetRequest:**
  ```
  This is the blocking mechanism: static rules (EasyList, EasyPrivacy, Adblock Warning Removal List and tracking-parameter removal) ship inside the package and Chrome applies them without the extension seeing any traffic. One dynamic allowAllRequests rule turns blocking off on the sites the user chooses, and displayActionCountAsBadgeText shows the counter on the icon.
  ```
- **storage:**
  ```
  Saves in chrome.storage.sync the list of sites where the user turned blocking off and the state of the two switches (clean links and cookie rejection). Nothing else is stored.
  ```
- **scripting:**
  ```
  Registers, with chrome.scripting.registerContentScripts, the content scripts bundled in the package (hiding ad elements with CSS and rejecting cookie banners), excluding the sites the user allowed. Some Autoconsent rules also need to read a page variable (for example window.Cookiebot): the service worker runs, with executeScript, one of the library's predefined functions chosen by name; it never runs code received from the page or the network. Reader view uses executeScript to inject the bundled reader/reader.js into the current tab when the user opens it (shortcut, popup button or context menu), and a registered content script (reader/snapshot.js) keeps an in-memory copy of the page as it loaded, so the reader can show the article.
  ```
- **contextMenus:**
  ```
  Adds one "Reader view" item to the page's right-click menu, which opens reader view on that page. It adds no other menu items.
  ```
- **activeTab:**
  ```
  When the popup opens, it lets the extension call declarativeNetRequest.getMatchedRules on the current tab to show how many requests were blocked there, without requesting the declarativeNetRequestFeedback permission for every tab.
  ```
- **Host permission (<all_urls>):**
  ```
  An ad blocker has to work on any website: content scripts hide ad slots and reject cookie banners on every site, the clean-links rule redirects navigations without tracking parameters, and reader view must be able to open on any article. Page content is only read on the device to hide ads and, when the user opens reader view, to show the article; it is never sent anywhere.
  ```

**Are you using remote code?** No, I am not using remote code.

**Data usage:** tick none of the categories (the extension collects no user data). Tick the three
certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/jorgediazlargo/libreadblocker/blob/main/PRIVACY.md

## Distribution

- **Visibility:** Public (or Unlisted if you want to try it yourself from the link first).
- **Regions:** All regions.
