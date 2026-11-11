// Lista blanca de sitios (chrome.storage.sync) y su aplicación:
//  - una regla DNR dinámica allowAllRequests con los sitios permitidos;
//  - los content scripts cosméticos se registran con excludeMatches para esos sitios.

import { hostPattern, isMatchableHost } from '../convert/buckets.ts';

export const ALLOWLIST_KEY = 'allowlist';
const ALLOW_RULE_ID = 1;
/** Por encima de cualquier regla estática (1 normal, 2 $important). */
const ALLOW_PRIORITY = 1000;

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
  await applyAllowlist(list);
}

interface Registry {
  buckets: { id: string; matches: string[] }[];
  elemhide: string[];
  generichide: string[];
}

let lastApplied: string | undefined;

export async function applyAllowlist(list?: string[]): Promise<void> {
  const hosts = list ?? (await getAllowlist());
  const key = JSON.stringify(hosts);
  if (key === lastApplied) return;

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [ALLOW_RULE_ID],
    addRules: hosts.length
      ? [
          {
            id: ALLOW_RULE_ID,
            priority: ALLOW_PRIORITY,
            action: { type: 'allowAllRequests' as chrome.declarativeNetRequest.RuleActionType },
            condition: {
              requestDomains: hosts,
              resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType],
            },
          },
        ]
      : [],
  });

  const registry: Registry = await (await fetch(chrome.runtime.getURL('content/registry.json'))).json();
  const allowed = hosts.map((h) => (isMatchableHost(h) ? hostPattern(h) : `*://${h}/*`));
  const exclude = [...allowed, ...registry.elemhide];
  const common = { runAt: 'document_start' as const, persistAcrossSessions: true };
  const scripts: chrome.scripting.RegisteredContentScript[] = [
    {
      ...common,
      id: 'generic',
      css: ['content/generic.css'],
      matches: ['<all_urls>'],
      excludeMatches: [...exclude, ...registry.generichide],
      allFrames: true,
      matchOriginAsFallback: true,
    },
    { ...common, id: 'always', js: ['content/always.js'], matches: ['<all_urls>'], excludeMatches: exclude },
    ...registry.buckets.map((b) => ({
      ...common,
      id: b.id,
      js: [`content/${b.id}.js`],
      matches: b.matches,
      excludeMatches: exclude,
    })),
  ];

  // Reemplazo completo: más simple que calcular diferencias y no deja estados a medias.
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  await chrome.scripting.registerContentScripts(scripts);
  lastApplied = key;
}
