// Aplica la configuración guardada (lista blanca + módulos):
//  - una regla DNR dinámica allowAllRequests con los sitios permitidos;
//  - el ruleset de limpieza de enlaces, activado o no;
//  - los content scripts (cosmética y rechazo de cookies), con excludeMatches para esos sitios.

import { hostPattern, isMatchableHost } from '../convert/buckets.ts';
import { getAllowlist } from './allowlist.ts';
import { getModules, LINKS_RULESET } from './settings.ts';

const ALLOW_RULE_ID = 1;
/** Por encima de cualquier regla estática (1 normal, 2 $important). */
const ALLOW_PRIORITY = 1000;

interface Registry {
  buckets: { id: string; matches: string[] }[];
  elemhide: string[];
  generichide: string[];
}

let lastApplied: string | undefined;

export async function applyConfig(): Promise<void> {
  const [hosts, modules] = await Promise.all([getAllowlist(), getModules()]);
  const key = JSON.stringify([hosts, modules]);
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

  // Chrome recuerda los rulesets activos entre sesiones, pero no entre actualizaciones.
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    modules.links ? { enableRulesetIds: [LINKS_RULESET] } : { disableRulesetIds: [LINKS_RULESET] },
  );

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
  if (modules.cookies) {
    // Dos scripts: el de la página lleva todas las reglas; el de los iframes, solo las pocas
    // que se ejecutan dentro de un frame (avisos servidos desde otro origen, como Sourcepoint).
    const consent = { ...common, matches: ['<all_urls>'], ...(allowed.length ? { excludeMatches: allowed } : {}) };
    scripts.push(
      { ...consent, id: 'consent', js: ['content/consent.js'] },
      { ...consent, id: 'consent-frame', js: ['content/consent-frame.js'], allFrames: true },
    );
  }

  // Reemplazo completo: más simple que calcular diferencias y no deja estados a medias.
  const existing = await chrome.scripting.getRegisteredContentScripts();
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: existing.map((s) => s.id) });
  await chrome.scripting.registerContentScripts(scripts);
  lastApplied = key;
}
