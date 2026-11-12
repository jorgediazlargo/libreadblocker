// Service worker. No hace nada en segundo plano: Chrome lo despierta solo al instalar
// o actualizar, cuando cambia la configuración (storage.sync, también desde otro equipo),
// cuando el popup pide un cambio o cuando una regla de cookies necesita ejecutar un
// fragmento en la página. El bloqueo lo hace Chrome con las reglas DNR.

import { evalSnippets } from '@duckduckgo/autoconsent';
import { ALLOWLIST_KEY, isValidHost, setSiteEnabled } from './shared/allowlist.ts';
import { applyConfig } from './shared/apply.ts';
import { MODULES_KEY, isModuleName, setModule } from './shared/settings.ts';

// La configuración solo es accesible desde las páginas de la extensión: los content scripts
// (que viven en el proceso de la página) no pueden leerla ni escribirla.
void chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('')).origin;

let queue: Promise<unknown> = Promise.resolve();
function enqueue(task: () => Promise<void>): Promise<unknown> {
  queue = queue.then(task).catch((e) => console.error('[largo]', e));
  return queue;
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  void chrome.action.setBadgeBackgroundColor({ color: '#5b6470' });
  void enqueue(applyConfig);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (ALLOWLIST_KEY in changes || MODULES_KEY in changes)) void enqueue(applyConfig);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return;
  // Los cambios de configuración solo los pide el popup. `origin` lo fija el navegador, así que
  // un content script (o un renderer comprometido) no puede hacerse pasar por la extensión.
  const fromExtensionPage = sender.origin === EXTENSION_ORIGIN;
  const change =(task: () => Promise<void>) => {
    void enqueue(async () => {
      await task();
      await applyConfig();
    }).then(() => sendResponse(true));
    return true;
  };

  if (msg?.type === 'set-site' && fromExtensionPage) {
    const { host, enabled } = msg as { host: unknown; enabled: unknown };
    if (typeof host !== 'string' || !isValidHost(host) || typeof enabled !== 'boolean') return;
    return change(() => setSiteEnabled(host, enabled));
  }

  if (msg?.type === 'set-module' && fromExtensionPage) {
    const { module, enabled } = msg as { module: unknown; enabled: unknown };
    if (!isModuleName(module) || typeof enabled !== 'boolean') return;
    return change(() => setModule(module, enabled));
  }

  // Autoconsent (content/consent.js) pide ejecutar en el mundo de la página uno de sus
  // fragmentos predefinidos. Solo se acepta el nombre: nunca código que llegue en el mensaje.
  if (msg?.type === 'consent-eval') {
    const { snippetId } = msg as { snippetId: unknown };
    const tabId = sender.tab?.id;
    if (typeof snippetId !== 'string' || !Object.hasOwn(evalSnippets, snippetId) || tabId === undefined) return;
    chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        func: evalSnippets[snippetId as keyof typeof evalSnippets] as () => unknown,
      })
      .then(
        ([r]) => sendResponse(r?.result ?? false),
        () => sendResponse(false),
      );
    return true;
  }
});
