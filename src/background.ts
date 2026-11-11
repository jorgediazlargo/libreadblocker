// Service worker. No hace nada en segundo plano: Chrome lo despierta solo al instalar
// o actualizar, cuando cambia la lista blanca (storage.sync, también desde otro equipo)
// o cuando el popup pide cambiar un sitio. El bloqueo lo hace Chrome con las reglas DNR.

import { ALLOWLIST_KEY, applyAllowlist, isValidHost, setSiteEnabled } from './shared/allowlist.ts';

let queue: Promise<unknown> = Promise.resolve();
function enqueue(task: () => Promise<void>): Promise<unknown> {
  queue = queue.then(task).catch((e) => console.error('[libreadblocker]', e));
  return queue;
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: true });
  void chrome.action.setBadgeBackgroundColor({ color: '#5b6470' });
  void enqueue(() => applyAllowlist());
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && ALLOWLIST_KEY in changes) void enqueue(() => applyAllowlist());
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || msg?.type !== 'set-site') return;
  const { host, enabled } = msg as { host: unknown; enabled: unknown };
  if (typeof host !== 'string' || !isValidHost(host) || typeof enabled !== 'boolean') return;
  void enqueue(() => setSiteEnabled(host, enabled)).then(() => sendResponse(true));
  return true;
});
