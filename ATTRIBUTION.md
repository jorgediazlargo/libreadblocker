# Atribución

Largo Ad Blocker incluye reglas derivadas de estas listas de filtros:

- **EasyList** — https://easylist.to/ — © The EasyList authors
  (https://github.com/easylist/easylist/graphs/contributors)
- **EasyPrivacy** — https://easylist.to/ — © The EasyList authors
- **Adblock Warning Removal List** — https://github.com/easylist/antiadblockfilters — © The EasyList authors

Las tres listas se distribuyen con doble licencia, a elegir:

- GNU General Public License v3 o posterior (https://www.gnu.org/licenses/gpl-3.0.html)
- Creative Commons Attribution-ShareAlike 3.0 Unported (https://creativecommons.org/licenses/by-sa/3.0/)

Licencia de las listas: https://easylist.to/pages/licence.html

Las reglas de `rules/` y los selectores de `content/` son una transformación automática de
esas listas (conversión a reglas declarativeNetRequest de Chrome y a CSS) hecha por
`scripts/update-lists.ts`. Se han descartado los filtros que Chrome no puede expresar.
Este trabajo derivado se distribuye bajo GPLv3 (ver `LICENSE`).

## Autoconsent

El rechazo automático de avisos de cookies (`content/consent.js`, `content/consent-frame.js` y
los fragmentos que ejecuta `background.js`) incluye, sin modificar, la biblioteca y las reglas de
**Autoconsent** — https://github.com/duckduckgo/autoconsent — © Duck Duck Go, Inc.

Se distribuye bajo la Mozilla Public License 2.0 (https://www.mozilla.org/MPL/2.0/). El código
fuente de la versión incluida (la fijada en `package.json`) está en
https://www.npmjs.com/package/@duckduckgo/autoconsent y en el repositorio anterior.
