// Content script del modo lectura (document_start, solo el marco principal). Guarda una copia
// del documento tal y como llega del servidor, en cuanto el analizador termina (readyState
// "interactive"): antes de los scripts diferidos y de los manejadores de DOMContentLoaded, que es
// donde muchas páginas recortan o tapan el texto. No hace ninguna petición: solo copia el
// documento ya cargado. La copia es inerte (sin contexto de navegación: no ejecuta scripts ni
// carga recursos) y vive en el mundo aislado de la extensión; la página no puede verla.

declare global {
  // eslint-disable-next-line no-var
  var __largoSnapshot: Document | undefined;
}

if (document.contentType === 'text/html') {
  const take = () => {
    try {
      globalThis.__largoSnapshot = document.cloneNode(true) as Document;
    } catch {
      /* documento raro: el modo lectura usará el DOM actual */
    }
  };
  if (document.readyState === 'loading') document.addEventListener('readystatechange', take, { once: true });
  else take();
}

export {};
