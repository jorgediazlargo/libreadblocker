# Política de privacidad de Largo Ad Blocker

_Última actualización: 13 de noviembre de 2026_

Largo Ad Blocker es una extensión de Chrome que bloquea anuncios y rastreadores, quita los
parámetros de rastreo de los enlaces y rechaza los avisos de cookies. Esta política explica qué
datos trata.

## Resumen

**Largo Ad Blocker no recoge, guarda en servidores, vende ni comparte ningún dato personal.**
No tiene telemetría, analítica, cuentas de usuario ni servidores propios, y no hace peticiones de
red propias.

## Qué datos trata y dónde

- **Las páginas que visitas.** Para bloquear anuncios, Chrome compara cada petición con las reglas
  incluidas en la extensión (API `declarativeNetRequest`). Esa comparación la hace el propio
  navegador en tu equipo; la extensión no ve ni guarda las URL que visitas.
- **El contenido de las páginas.** Los scripts de contenido ocultan elementos publicitarios con
  CSS y buscan el botón de "rechazar" de los avisos de cookies. Todo ocurre dentro de la página, en
  tu equipo, y no se envía nada a ningún sitio.
- **Tu configuración.** La lista de sitios en los que has desactivado el bloqueo y el estado de los
  interruptores ("Quitar el rastreo de los enlaces" y "Rechazar los avisos de cookies") se guardan
  con `chrome.storage.sync`. Si tienes activada la sincronización de Chrome, Google la sincroniza
  entre tus equipos como el resto de datos de Chrome. El desarrollador no tiene acceso a ella.
- **El contador de bloqueos.** El número que aparece en el icono lo calcula Chrome para cada
  pestaña y desaparece al cerrarla.

## Lo que no hace

- No envía datos al desarrollador ni a terceros.
- No usa cookies, identificadores ni huellas digitales.
- No descarga ni ejecuta código remoto: las reglas y los scripts van dentro de la extensión y solo
  cambian cuando se publica una versión nueva en la Chrome Web Store.
- No muestra anuncios ni tiene una lista de anuncios "aceptables".

## Cambios

Si alguna versión futura cambiara cómo se tratan los datos, se actualizará esta página y se avisará
en la ficha de la Chrome Web Store antes de publicar esa versión.

## Contacto

Para cualquier duda sobre esta política, escribe a la dirección de contacto que figura en la
ficha de la extensión en la Chrome Web Store.

---

# Privacy policy (English)

**Largo Ad Blocker does not collect, store on servers, sell or share any personal data.** It has no
telemetry, analytics, accounts or servers, and makes no network requests of its own. Ad blocking is
done by Chrome itself with the rules bundled in the extension (`declarativeNetRequest`); content
scripts hide ad elements and click "reject" on cookie banners locally, inside the page. The only
data stored is your settings (sites where blocking is off and the two module switches), kept in
`chrome.storage.sync`, which Chrome syncs between your devices if you use Chrome sync; the developer
has no access to it. No remote code is downloaded or executed.
