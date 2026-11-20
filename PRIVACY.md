# Largo Ad Blocker privacy policy

_Last updated: November 20, 2026_

Largo Ad Blocker is a Chrome extension that blocks ads and trackers, strips tracking parameters from
links, rejects cookie banners and has a reader view. This policy explains what data it handles.

## Summary

**Largo Ad Blocker does not collect, store on servers, sell or share any personal data.** It has no
telemetry, analytics, user accounts or servers of its own, and it makes no network requests of its
own.

## What data it handles, and where

- **The pages you visit.** To block ads, Chrome checks each request against the rules bundled with
  the extension (the `declarativeNetRequest` API). Chrome does that matching itself, on your device;
  the extension does not see or store the URLs you visit.
- **Page content.** Content scripts hide ad elements with CSS and look for the "reject" button on
  cookie banners. All of this happens inside the page, on your device, and nothing is sent anywhere.
- **Reader view.** On each page, a content script keeps a copy of the page as it loaded, in the tab's
  memory, so that reader view can show the article when you open it. The copy is not saved or sent
  anywhere and disappears when you leave the page. Reader view only uses what the page already
  loaded and makes no network requests. Your text size and theme for reader view are saved with
  `chrome.storage.local`, on your device only.
- **Your settings.** The list of sites where you turned blocking off and the state of the two
  switches ("Strip tracking from links" and "Reject cookie banners") are saved with
  `chrome.storage.sync`. If Chrome sync is on, Google syncs them across your devices like the rest of
  your Chrome data. The developer has no access to them.
- **The block counter.** The number on the icon is computed by Chrome for each tab and disappears
  when you close it.

## What it doesn't do

- It doesn't send data to the developer or to third parties.
- It doesn't use cookies, identifiers or fingerprinting.
- It doesn't download or run remote code: the rules and scripts ship inside the extension and only
  change when a new version is published on the Chrome Web Store.
- It doesn't show ads and has no "acceptable ads" list.

## Changes

If a future version changes how data is handled, this page will be updated and the change announced
on the Chrome Web Store listing before that version is published.

## Contact

For any question about this policy, open an issue at
https://github.com/jorgediazlargo/libreadblocker/issues or use the contact address on the Chrome Web
Store listing.

---

# Política de privacidad (español)

**Largo Ad Blocker no recoge, guarda en servidores, vende ni comparte ningún dato personal.** No
tiene telemetría, analítica, cuentas ni servidores, y no hace peticiones de red propias. El bloqueo
lo hace el propio Chrome con las reglas incluidas en la extensión (`declarativeNetRequest`); los
scripts de contenido ocultan anuncios y pulsan "rechazar" en los avisos de cookies dentro de la
página, en tu equipo. El modo lectura guarda en la memoria de la pestaña una copia de la página tal y
como se cargó, para poder mostrar el artículo cuando lo abras; esa copia no se guarda ni se envía a
ningún sitio, y el modo lectura no hace peticiones. Lo único que se guarda es tu configuración: los
sitios en los que has desactivado el bloqueo y los dos interruptores, en `chrome.storage.sync`, que
Chrome sincroniza entre tus equipos si usas la sincronización, y el tamaño de letra y el tema del
modo lectura, en `chrome.storage.local`, solo en tu equipo. El desarrollador no tiene acceso a ella.
No se descarga ni se ejecuta código remoto.
