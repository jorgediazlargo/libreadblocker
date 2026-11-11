# Atribución

libreadblocker incluye reglas derivadas de estas listas de filtros:

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
