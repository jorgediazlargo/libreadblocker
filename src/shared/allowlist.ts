// Lista blanca de sitios (chrome.storage.sync). La aplica applyConfig (apply.ts).

export const ALLOWLIST_KEY = 'allowlist';

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

export function isValidHost(host: string): boolean {
  return HOST_RE.test(host) && host.length <= 253;
}

/** Clave guardada para un sitio: el hostname sin "www.". */
export function siteKey(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

/** Entrada de la lista blanca que cubre este host (el propio host o un dominio padre). */
export function matchingEntry(hostname: string, list: string[]): string | undefined {
  const host = hostname.toLowerCase();
  return list.find((e) => host === e || host.endsWith(`.${e}`));
}

export function toggleInList(list: string[], hostname: string, enabled: boolean): string[] {
  const host = hostname.toLowerCase();
  const next = enabled
    ? list.filter((e) => !(host === e || host.endsWith(`.${e}`)))
    : [...list, siteKey(host)];
  return [...new Set(next)].filter(isValidHost).sort();
}

export async function getAllowlist(): Promise<string[]> {
  const v = await chrome.storage.sync.get(ALLOWLIST_KEY);
  const list = v[ALLOWLIST_KEY];
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && isValidHost(e)) : [];
}

export async function setSiteEnabled(hostname: string, enabled: boolean): Promise<void> {
  const list = toggleInList(await getAllowlist(), hostname, enabled);
  await chrome.storage.sync.set({ [ALLOWLIST_KEY]: list });
}
