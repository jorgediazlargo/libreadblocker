import { getAllowlist, matchingEntry, isValidHost } from '../shared/allowlist.ts';
import { getModules, type ModuleName } from '../shared/settings.ts';
import meta from '../../generated/meta.json' with { type: 'json' };
import allowIdsJson from '../../generated/allow-ids.json' with { type: 'json' };

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function currentTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const allowIds = new Map(Object.entries(allowIdsJson).map(([k, v]) => [k, new Set(v)]));

async function blockedCount(tabId: number): Promise<number | null> {
  // El número del icono (displayActionCountAsBadgeText) no se puede leer desde la API:
  // getBadgeText devuelve un marcador. getMatchedRules funciona gracias a activeTab
  // (se concede al pulsar el icono) y aquí se descuentan las reglas de excepción.
  try {
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
    return rulesMatchedInfo.filter(
      (m) => m.rule.rulesetId !== '_dynamic' && !allowIds.get(m.rule.rulesetId)?.has(m.rule.ruleId),
    ).length;
  } catch {
    return null;
  }
}

function render(host: string, enabled: boolean) {
  $<HTMLInputElement>('toggle').checked = enabled;
  $('status').textContent = enabled ? 'Bloqueo activo en este sitio' : 'Bloqueo desactivado en este sitio';
  document.body.classList.toggle('off', !enabled);
  $('host').textContent = host;
}

/** Interruptores de los módulos: valen para todos los sitios y se aplican en la siguiente carga. */
async function modules() {
  const state = await getModules();
  for (const input of document.querySelectorAll<HTMLInputElement>('input[data-module]')) {
    const module = input.dataset.module as ModuleName;
    input.checked = state[module];
    input.addEventListener('change', async () => {
      input.disabled = true;
      await chrome.runtime.sendMessage({ type: 'set-module', module, enabled: input.checked });
      input.checked = (await getModules())[module];
      input.disabled = false;
    });
  }
}

async function main() {
  const versions = meta.lists.map((l) => `${l.name} ${l.version ?? ''}`.trim()).join(' · ');
  $('lists').textContent = versions;
  void modules();

  const tab = await currentTab();
  const url = tab?.url ? new URL(tab.url) : null;
  if (!tab?.id || !url || !/^https?:$/.test(url.protocol) || !isValidHost(url.hostname)) {
    document.body.classList.add('na');
    $('host').textContent = 'Página no compatible';
    return;
  }
  const tabId = tab.id;
  const host = url.hostname;

  const entry = matchingEntry(host, await getAllowlist());
  render(entry ?? host.replace(/^www\./, ''), !entry);

  const count = await blockedCount(tabId);
  $('count').textContent = count === null ? '—' : count.toLocaleString('es-ES');

  $<HTMLInputElement>('toggle').addEventListener('change', async (e) => {
    const enabled = (e.target as HTMLInputElement).checked;
    const input = e.target as HTMLInputElement;
    input.disabled = true;
    await chrome.runtime.sendMessage({ type: 'set-site', host, enabled });
    const now = matchingEntry(host, await getAllowlist());
    render(now ?? host.replace(/^www\./, ''), !now);
    $('count').textContent = '0';
    input.disabled = false;
    await chrome.tabs.reload(tabId);
  });
}

void main();
