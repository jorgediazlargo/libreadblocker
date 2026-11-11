# Tamiz

Extensión de Chrome (Manifest V3) que bloquea anuncios y rastreadores con
[EasyList](https://easylist.to/), EasyPrivacy y la Adblock Warning Removal List, que quita los
avisos de "desactiva tu bloqueador". No tiene telemetría, cuentas ni peticiones de red
propias. Tampoco tiene anuncios aceptables ni procesos en segundo plano.

`dist/` ocupa ~4,6 MB. Al cargarla, Chrome añade ~4,2 MB de índices de reglas en
`dist/_metadata`, así que la extensión instalada ocupa ~8,8 MB.

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

## Arreglos propios

`filters/tamiz.txt` es una lista propia con sintaxis de Adblock Plus que se convierte junto con
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
| `background.js` | Registra los content scripts y la regla de lista blanca | Al instalar, al cambiar la lista blanca o al usar el popup |
| `popup.html` | Interruptor por sitio y contador | Al abrir el popup |

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
(© The EasyList authors, GPLv3 / CC BY-SA 3.0); ver `ATTRIBUTION.md`, que se incluye en `dist/`.

La extensión **no está publicada** en la Chrome Web Store.
