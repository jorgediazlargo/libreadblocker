# Cómo publicar Largo Ad Blocker en la Chrome Web Store

Estos pasos los haces tú con tu cuenta de Google. Tardan unos 20 minutos más la revisión de Google.

## 1. Cuenta de desarrollador (solo la primera vez)

1. Entra en https://chrome.google.com/webstore/devconsole con la cuenta de Google con la que quieras
   publicar (la personal, no la de trabajo).
2. Acepta el acuerdo de desarrollador y paga la cuota única de **5 US$** con tarjeta.
3. En **Cuenta**, rellena el nombre de editor que verá la gente (por ejemplo «Jorge Díaz Largo» o
   «Largo») y un **correo de contacto**. Google lo verifica con un enlace: sin verificarlo no deja
   publicar.
4. Si te pide verificar la identidad o activar la verificación en dos pasos, hazlo: es obligatorio.
5. Indica si eres «comerciante» o no (trader, por la Ley de Servicios Digitales de la UE). Para una
   extensión gratuita y personal, elige que **no** eres comerciante.

## 2. Publicar la política de privacidad

La tienda necesita una URL pública. Elige una:

- **Hacer público el repositorio** `jorgediazlargo/libreadblocker` y usar
  `https://github.com/jorgediazlargo/libreadblocker/blob/main/PRIVACY.md`. Es lo recomendable:
  la licencia GPLv3 obliga a ofrecer el código fuente a quien instale la extensión, y un repo
  público lo resuelve.
- Si quieres mantenerlo privado: crea un **gist público** con el contenido de `PRIVACY.md` y usa su
  URL (y entonces el código fuente tendrías que ofrecerlo de otra forma).

## 3. Crear el elemento

1. `pnpm package` en `~/dev/personal/libreadblocker` → `largo-ad-blocker-0.1.0.zip`.
2. En el panel: **Nuevo elemento** → sube el zip.
3. Rellena las pestañas con el contenido de `store/FICHA.md`:
   - **Ficha de Play Store:** descripción, categoría, idioma, imágenes.
   - **Prácticas de privacidad:** finalidad única, justificación de cada permiso, código remoto
     (no), uso de datos y URL de la política.
   - **Distribución:** pública, todas las regiones.
4. Pulsa **Enviar para revisión**. Puedes marcar «publicar automáticamente tras la aprobación» o
   publicarla tú cuando la aprueben.

## 4. Revisión

- Al pedir acceso a todos los sitios (`<all_urls>`), Google hace una **revisión en profundidad**:
  cuenta con varios días, a veces un par de semanas. Te avisan por correo.
- Si la rechazan, el correo indica la política concreta (código de infracción). Pásamelo y lo
  corregimos.

## 5. Actualizaciones

1. Sube `version` en `package.json` (la tienda rechaza un zip con la misma versión).
2. `pnpm update-lists && pnpm package` para llevar las listas al día.
3. Panel → el elemento → **Paquete → Subir paquete nuevo** → Enviar para revisión.

Las listas de filtros van dentro del paquete (Manifest V3 no permite descargar reglas), así que
para que estén al día hay que publicar versiones nuevas de vez en cuando; una al mes es razonable.
