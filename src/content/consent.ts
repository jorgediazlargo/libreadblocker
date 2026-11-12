// Rechazo automático de avisos de cookies con Autoconsent (DuckDuckGo, MPL 2.0): detecta
// el gestor de consentimiento (OneTrust, Didomi, Sourcepoint…) y pulsa "rechazar". Si el
// aviso no ofrece rechazo no hace nada: ni lo oculta ni acepta.
// build.ts genera content/consent.js (página) y content/consent-frame.js (iframes),
// cada uno con sus reglas incrustadas.

import autoconsent, {
  filterCompactRules,
  type BackgroundMessage,
  type Config,
  type ContentScriptMessage,
  type IndexedCMPRuleset,
} from '@duckduckgo/autoconsent';

// Con nodenext los tipos del paquete se leen como CommonJS, pero esbuild empaqueta su
// build ESM, donde la exportación por defecto ya es la clase.
const AutoConsent = autoconsent as unknown as typeof autoconsent.default;

export function run(rules: IndexedCMPRuleset, mainFrame: boolean): void {
  if ((window.top === window) !== mainFrame) return;

  const init: BackgroundMessage = {
    type: 'initResp',
    rules: { autoconsent: [], compact: filterCompactRules(rules, { url: location.href, mainFrame }) },
    // Autoconsent completa el resto con sus valores por defecto.
    config: {
      enabled: true,
      autoAction: 'optOut',
      enablePrehide: true,
      // Ocultar un aviso sin responderlo deja la página a medias (scroll bloqueado, consentimiento sin guardar).
      enableCosmeticRules: false,
      enableGeneratedRules: true,
      // Avisos de gestores sin regla propia: pulsa el botón solo si es de rechazo.
      heuristicMode: 'reject',
    } satisfies Partial<Config> as Config,
  };

  // Autoconsent está pensado para pedir su configuración y sus evaluaciones al service
  // worker. Aquí la configuración se responde en el propio content script, para no
  // despertarlo en cada página: solo se le escribe cuando una regla necesita ejecutar un
  // fragmento en el mundo de la página (p. ej. llamar a la API del gestor). Los avisos de
  // progreso se descartan.
  const send = async (msg: ContentScriptMessage): Promise<void> => {
    if (msg.type === 'init') {
      // En una microtarea: el constructor aún no ha terminado cuando envía este mensaje.
      queueMicrotask(() => void consent.receiveMessageCallback(init));
    } else if (msg.type === 'eval' && msg.snippetId) {
      const result: unknown = await chrome.runtime
        .sendMessage({ type: 'consent-eval', snippetId: msg.snippetId })
        .catch(() => false);
      void consent.receiveMessageCallback({ type: 'evalResp', id: msg.id, result });
    }
  };

  const consent = new AutoConsent(send);
}
