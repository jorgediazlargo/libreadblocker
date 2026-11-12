# Largo Ad Blocker

Extensión de Chrome (Manifest V3) que bloquea anuncios y rastreadores con
[EasyList](https://easylist.to/), EasyPrivacy y la Adblock Warning Removal List, que quita los
avisos de "desactiva tu bloqueador". Además quita los parámetros de rastreo de los enlaces
(`utm_*`, `fbclid`, `gclid`…) y pulsa "rechazar" en los avisos de cookies. No tiene telemetría,
cuentas ni peticiones de red propias. Tampoco tiene anuncios aceptables.

`dist/` ocupa ~5,3 MB. Al cargarla, Chrome añade ~4,2 MB de índices de reglas en
`dist/_metadata`, así que la extensión instalada ocupa ~9,7 MB.

## Uso

```bash
pnpm install
pnpm build          # deja dist/ listo
```

En `chrome://extensions`, activa el modo de desarrollador, pulsa **Cargar descomprimida** y elige `dist/`.

El icono muestra cuántas peticiones se han bloqueado en la pestaña. El popup permite desactivar el
bloqueo en el sitio actual. La lista blanca se guarda en `chrome.storage.sync`, así que se comparte
entre equipos con la misma cuenta de Chrome; caben unos 400 sitios por el límite de 8 KB por clave.

## Actualizar las listas

```bash
pnpm update-lists   # descarga las listas y regenera generated/
pnpm build
```

Después, pulsa ↻ en la tarjeta de la extensión en `chrome://extensions`. Las reglas generadas
(`generated/`) se versionan en el repo, de modo que el build no necesita red.
`pnpm update-lists --offline` reutiliza las listas guardadas en `.cache/lists`.

## Enlaces sin rastreo

`filters/largo-links.txt` lista los parámetros que solo sirven para rastrear campañas y clics, con
la sintaxis `$removeparam=nombre`. Se convierten en reglas DNR `redirect` con
`queryTransform.removeParams` en un ruleset aparte (`links`), que se apaga desde el popup.

- Solo nombres exactos: DNR no admite regex ni comodines, así que `utm_*` va parámetro a parámetro.
- Sin tipo de recurso, la regla se aplica solo a la navegación principal (`main_frame`).
- Una regla sin patrón de URL solo salta si la URL lleva el parámetro (`^nombre=`) y los quita todos
  en una sola redirección.
- No incluye identificadores de afiliación (`irclickid`, `tag`…): quitarlos rompe cashback y comisiones.
- En los sitios de la lista blanca no se toca la URL.

## Avisos de cookies

Usa [Autoconsent](https://github.com/duckduckgo/autoconsent) de DuckDuckGo (MPL 2.0), con sus
reglas para varios cientos de gestores de consentimiento y sitios: detecta el aviso y pulsa
"rechazar" (o llama a la API del gestor). Si no hay regla, busca un botón de rechazo por su texto.
Si el aviso no permite rechazar, se queda como está: **nunca acepta ni oculta**.

- Los muros de "acepta o suscríbete" (Marca, La Vanguardia…) no ofrecen rechazo gratuito y se
  quedan como están.
- Algunas reglas necesitan leer variables de la página (`window.Cookiebot`, por ejemplo). El
  content script se lo pide al service worker, que ejecuta con `chrome.scripting` uno de los
  fragmentos predefinidos de Autoconsent, elegido por nombre; nunca código que llegue en el
  mensaje. Por eso, con este módulo activo, el service worker se despierta al cargar cada página.
- La versión de Autoconsent está fijada en `package.json`; sus reglas se actualizan subiendo esa
  versión y ejecutando `pnpm build`.
- `node scripts/_modules.ts [links|cookies] [url…]` prueba los dos módulos en Chrome real y deja
  capturas con y sin extensión en `.cache/modules/`.

## Arreglos propios

`filters/largo.txt` es una lista propia con sintaxis de Adblock Plus que se convierte junto con
EasyList y las demás listas. Sirve para casos que esas listas no cubren, como el muro
anti-bloqueador de Google Funding Choices (El País, por ejemplo). Después de editarla, ejecuta
`pnpm update-lists --offline && pnpm build`.

## Cómo funciona

| Pieza | Qué hace | Cuándo se ejecuta |
|---|---|---|
| `rules/*.json` | Reglas estáticas `declarativeNetRequest` generadas en build | Las aplica Chrome; la extensión no ejecuta código |
| `content/generic.css` | Selectores genéricos de EasyList | Chrome inyecta el CSS en cada frame (sin JS) |
| `content/always.js` | ~300 selectores genéricos con excepciones por sitio y reglas para `ejemplo.*` | Cada página, `document_start`, ~48 KB |
| `content/bNN.js` | Selectores propios de ~7.800 sitios, repartidos en 32 grupos | Solo en los sitios de su grupo (`matches`) |
| `rules/links.json` | Reglas `redirect` que quitan parámetros de rastreo | Las aplica Chrome en cada navegación |
| `content/consent.js` | Autoconsent con todas sus reglas (~550 KB) | Cada página (solo el frame principal), `document_start` |
| `content/consent-frame.js` | Autoconsent con las reglas para iframes (~115 KB) | Cada iframe, `document_start` |
| `background.js` | Registra los content scripts, la regla de lista blanca y el ruleset de enlaces; ejecuta los fragmentos de Autoconsent | Al instalar, al cambiar la configuración, al usar el popup o cuando lo pide una regla de cookies |
| `popup.html` | Interruptor por sitio, contador e interruptores de enlaces y cookies | Al abrir el popup |

- **Lista blanca:** una regla dinámica `allowAllRequests` (prioridad 1000) con los sitios permitidos,
  más `excludeMatches` en los content scripts.
- **Contador:** `displayActionCountAsBadgeText` de DNR. No hace falta `webRequest` ni el permiso
  `declarativeNetRequestFeedback`.
- **Sin `MutationObserver`:** las reglas CSS ya se aplican a los elementos que se añaden después.

### Conversión de filtros (`src/convert/`)

- `||dominio^` (con o sin opciones) se agrupa en reglas con `requestDomains`. Así ~85.000 filtros
  de dominio caben en unas pocas reglas.
- Las opciones `$third-party`/`$first-party`, `$domain=` (`initiatorDomains` y
  `excludedInitiatorDomains`), los tipos de recurso, `$match-case`, `$important` y `$method=` se
  traducen a las condiciones equivalentes de DNR.
- `@@` se convierte en `allow`; `@@…$document`, en `allowAllRequests`; `@@||host^$elemhide` y
  `$generichide`, en exclusiones cosméticas.
- `$removeparam=nombre` se convierte en `redirect` con `queryTransform.removeParams`; los que
  comparten condición se agrupan en una regla. Las formas con regex, negación o sin nombre se descartan.
- **Se descartan** `$popup`, `$rewrite`, `$redirect`, `$csp`, `$sitekey`, regex que RE2 no
  soporta (lookaround, referencias hacia atrás), entidades `ejemplo.*` en `$domain=` (exclusiones)
  y filtros cosméticos extendidos (`#?#`, `:-abp-*`, `:has-text`, inyección de estilos `{…}`).
  `generated/report.json` detalla cuántos y por qué.
- **Regex:** `pnpm update-lists` abre Chrome sin interfaz y descarta las que
  `isRegexSupported` rechaza. Chrome limita cada regex a 2 KB de memoria compilada, y
  repeticiones como `.{100,}` lo superan. Si no encuentra Chrome (`CHROME_PATH`), avisa y
  las deja todas.
- **Límites de Chrome** (comprobados en la documentación de DNR, noviembre de 2026): 30.000 reglas
  estáticas garantizadas por extensión y 1.000 regex. Si hubiera que recortar, se conservan primero
  las excepciones, después las reglas de dominio, los patrones anclados a host, el resto de
  patrones y, por último, las regex.

## Desarrollo

```bash
pnpm test        # tests del conversor (node:test)
pnpm typecheck
pnpm verify      # Chrome real con perfil temporal: páginas con y sin extensión, popup, lista blanca
```

`pnpm verify` usa el Chrome instalado (`CHROME_PATH` para cambiarlo). Guarda capturas y un informe
en `.cache/verify/`.

## Licencia y atribución

Código bajo GPLv3 o posterior (`LICENSE`). Las reglas derivan de EasyList, EasyPrivacy y la Adblock Warning Removal List
(© The EasyList authors, GPLv3 / CC BY-SA 3.0), y el rechazo de cookies usa Autoconsent
(© Duck Duck Go, Inc., MPL 2.0); ver `ATTRIBUTION.md`, que se incluye en `dist/`.

La extensión **no está publicada** en la Chrome Web Store.
