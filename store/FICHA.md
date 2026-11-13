# Ficha para la Chrome Web Store

Todo lo que pide el panel de desarrollador, listo para copiar y pegar. Las imágenes están en
`store/imagenes/`.

## Paquete

```bash
pnpm package        # build limpio + largo-ad-blocker-<versión>.zip en la raíz (ignorado por git)
```

Sube ese zip en **Paquete → Subir paquete nuevo**. Tiene `manifest.json` en la raíz.

## Ficha de Play Store → Detalles del producto

- **Idioma:** Español (la interfaz solo está en español).
- **Título:** Largo Ad Blocker (sale del manifest).
- **Resumen** (sale del manifest, 97 caracteres): Bloquea anuncios y rastreadores con EasyList y
  EasyPrivacy. Sin telemetría ni peticiones propias.
- **Categoría:** Privacidad y seguridad.

**Descripción:**

```
Largo Ad Blocker quita los anuncios y los rastreadores de las páginas que visitas, sin pedirte nada a cambio.

QUÉ HACE
• Bloquea anuncios y rastreadores con las listas EasyList y EasyPrivacy, y quita los avisos de «desactiva tu bloqueador» con la Adblock Warning Removal List.
• Enlaces sin rastreo: quita de los enlaces los parámetros que solo sirven para seguirte (utm_*, fbclid, gclid…). No toca los códigos de afiliación, para no romper descuentos ni comisiones.
• Cookies rechazadas: pulsa «rechazar» en los avisos de cookies por ti, con las reglas de Autoconsent de DuckDuckGo. Si un aviso no permite rechazar, lo deja como está: nunca acepta en tu nombre.
• El icono muestra cuántas peticiones se han bloqueado en la pestaña.
• Desde el botón puedes desactivar el bloqueo en un sitio concreto y apagar o encender los enlaces sin rastreo y el rechazo de cookies.

PRIVACIDAD
• Sin telemetría, sin analítica, sin cuentas y sin servidores: la extensión no hace ninguna petición de red propia.
• Sin anuncios «aceptables» ni listas blancas pagadas.
• El bloqueo lo hace el propio Chrome con reglas declarativeNetRequest (Manifest V3), así que la extensión no lee tu tráfico.
• Tu lista de sitios permitidos se guarda en tu cuenta de Chrome y se sincroniza entre tus equipos.

CÓDIGO ABIERTO
Código bajo licencia GPLv3. Filtros © The EasyList authors (GPLv3 / CC BY-SA 3.0). Autoconsent © Duck Duck Go, Inc. (MPL 2.0).
```

**Recursos gráficos** (`store/imagenes/`):

| Campo | Archivo | Tamaño |
|---|---|---|
| Icono de la tienda | `icono-tienda-128.png` | 128×128 (dibujo de 96 px con margen) |
| Capturas de pantalla (1–5) | `screenshot-1-antes-despues.png`, `screenshot-2-popup.png`, `screenshot-3-privacidad.png` | 1280×800 |
| Mosaico promocional pequeño | `promo-pequena-440x280.png` | 440×280 |
| Mosaico de marquesina (opcional) | `promo-marquesina-1400x560.png` | 1400×560 |

Las capturas usan una página de ejemplo inventada («El Diario de Ejemplo»), no webs reales, y la
extensión real cargada en Chromium: los 9 rastreadores de la página aparecen como bloqueados.

**Enlaces adicionales** (opcionales): página de inicio = el repositorio de GitHub, si lo haces público.

## Prácticas de privacidad

**Finalidad única:**

```
Bloquear anuncios, rastreadores y molestias de privacidad mientras navegas: bloquea las peticiones de anuncios y rastreo, oculta los huecos publicitarios, quita los parámetros de rastreo de los enlaces y rechaza los avisos de cookies.
```

**Justificación de permisos:**

- **declarativeNetRequest:**
  ```
  Es el mecanismo de bloqueo: las reglas estáticas (EasyList, EasyPrivacy, Adblock Warning Removal List y limpieza de parámetros de rastreo) van dentro del paquete y Chrome las aplica sin que la extensión vea el tráfico. Una regla dinámica allowAllRequests desactiva el bloqueo en los sitios que el usuario elige, y displayActionCountAsBadgeText muestra el contador en el icono.
  ```
- **storage:**
  ```
  Guarda en chrome.storage.sync la lista de sitios en los que el usuario ha desactivado el bloqueo y el estado de los dos interruptores (enlaces sin rastreo y rechazo de cookies). No guarda nada más.
  ```
- **scripting:**
  ```
  Registra con chrome.scripting.registerContentScripts los scripts de contenido incluidos en el paquete (ocultación de anuncios con CSS y rechazo de avisos de cookies), excluyendo los sitios que el usuario ha permitido. Además, algunas reglas de Autoconsent necesitan leer una variable de la página (por ejemplo window.Cookiebot): el service worker ejecuta con executeScript una de las funciones predefinidas de la biblioteca, elegida por nombre; nunca ejecuta código recibido de la página ni de la red.
  ```
- **activeTab:**
  ```
  Al abrir el popup, permite llamar a declarativeNetRequest.getMatchedRules en la pestaña actual para mostrar cuántas peticiones se han bloqueado en ella, sin pedir el permiso declarativeNetRequestFeedback para todas las pestañas.
  ```
- **Permiso de host (<all_urls>):**
  ```
  Un bloqueador de anuncios tiene que actuar en cualquier web: los scripts de contenido ocultan los huecos publicitarios y rechazan los avisos de cookies en todos los sitios, y la regla de limpieza de enlaces redirige la navegación sin los parámetros de rastreo. La extensión no lee ni envía el contenido de las páginas.
  ```

**¿Usas código remoto?** No, no uso código remoto.

**Uso de datos:** no marques ninguna categoría (la extensión no recoge datos de usuario). Marca las
tres certificaciones:

- No vendo ni transfiero datos de usuario a terceros, salvo en los casos de uso aprobados.
- No uso ni transfiero datos de usuario para fines no relacionados con la finalidad única.
- No uso ni transfiero datos de usuario para determinar la solvencia ni para conceder préstamos.

**URL de la política de privacidad:** la de `PRIVACY.md` publicada (ver la guía de publicación).

## Distribución

- **Visibilidad:** Pública (o «No listada» si primero quieres probarla tú con el enlace).
- **Regiones:** Todas.
- **Precio:** gratis (la tienda ya no cobra extensiones).
