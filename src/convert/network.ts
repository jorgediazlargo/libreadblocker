// Conversión de filtros de red de Adblock Plus (EasyList/EasyPrivacy) a reglas
// declarativeNetRequest de Chrome.
//
// Referencias:
//   https://help.adblockplus.org/hc/en-us/articles/360062733293
//   https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest

import { domainToASCII } from 'node:url';

export type ResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export interface DnrCondition {
  urlFilter?: string;
  regexFilter?: string;
  isUrlFilterCaseSensitive?: boolean;
  requestDomains?: string[];
  initiatorDomains?: string[];
  excludedInitiatorDomains?: string[];
  domainType?: 'firstParty' | 'thirdParty';
  resourceTypes?: ResourceType[];
  excludedResourceTypes?: ResourceType[];
  requestMethods?: string[];
}

export type DnrAction =
  | { type: 'block' | 'allow' | 'allowAllRequests' }
  | { type: 'redirect'; redirect: { transform: { queryTransform: { removeParams: string[] } } } };

export interface DnrRule {
  id: number;
  priority: number;
  action: DnrAction;
  condition: DnrCondition;
}

/** Excepción que afecta a la ocultación cosmética, no a la red. */
export type CosmeticSwitch = 'elemhide' | 'generichide';

export type NetworkResult =
  | { kind: 'rule'; rule: Omit<DnrRule, 'id'>; filter: string }
  | { kind: 'cosmetic-switch'; switch: CosmeticSwitch; domain: string; filter: string }
  | { kind: 'skip'; reason: string; filter: string };

export const PRIORITY_DEFAULT = 1;
export const PRIORITY_IMPORTANT = 2;

const TYPE_MAP: Record<string, ResourceType[]> = {
  script: ['script'],
  image: ['image'],
  stylesheet: ['stylesheet'],
  css: ['stylesheet'],
  object: ['object'],
  'object-subrequest': ['object'],
  xmlhttprequest: ['xmlhttprequest'],
  xhr: ['xmlhttprequest'],
  subdocument: ['sub_frame'],
  frame: ['sub_frame'],
  ping: ['ping'],
  beacon: ['ping'],
  media: ['media'],
  font: ['font'],
  websocket: ['websocket'],
  webtransport: ['webtransport'],
  webbundle: ['webbundle'],
  other: ['other'],
  document: ['main_frame'],
  doc: ['main_frame'],
};

/** Opciones que DNR no puede expresar: el filtro entero se descarta. */
const UNSUPPORTED_OPTIONS = new Set([
  'rewrite',
  'redirect',
  'redirect-rule',
  'csp',
  'header',
  'sitekey',
  'genericblock',
  'replace',
  'permissions',
  'urltransform',
  'empty',
  'mp4',
]);

/** Tipos que DNR no distingue: se quitan del filtro; si era el único tipo, se descarta. */
const UNSUPPORTED_TYPES = new Set(['popup', 'webrtc', 'popunder']);

const HOST_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

/** Nombre literal de parámetro: sin regex (/…/), negación (~) ni caracteres con significado en urlFilter. */
const PARAM_RE = /^[A-Za-z0-9_.\-[\]]+$/;

export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/\.$/, '');
  if (!d) return null;
  if (HOST_RE.test(d)) return d;
  if (/[^\x00-\x7f]/.test(d)) {
    const ascii = domainToASCII(d);
    return ascii && HOST_RE.test(ascii) ? ascii : null;
  }
  return null;
}

/** RE2 (usado por DNR) no soporta lookaround ni referencias hacia atrás. */
export function isRe2Compatible(re: string): boolean {
  if (/\(\?[=!<]/.test(re)) return false;
  if (/\\[1-9]/.test(re)) return false;
  try {
    new RegExp(re);
  } catch {
    return false;
  }
  return true;
}

function splitOptions(body: string): { pattern: string; options: string[] } {
  // Un filtro regex /.../ puede contener '$' dentro; las opciones van tras la '/' final.
  if (body.startsWith('/')) {
    const m = /^(\/.*\/)(?:\$([^/]*))?$/.exec(body);
    if (m) return { pattern: m[1]!, options: m[2] ? m[2].split(',') : [] };
  }
  const i = body.lastIndexOf('$');
  if (i === -1) return { pattern: body, options: [] };
  return { pattern: body.slice(0, i), options: body.slice(i + 1).split(',') };
}

export function parseNetworkFilter(line: string): NetworkResult {
  const filter = line.trim();
  const skip = (reason: string): NetworkResult => ({ kind: 'skip', reason, filter });

  let body = filter;
  const exception = body.startsWith('@@');
  if (exception) body = body.slice(2);

  const { pattern: rawPattern, options } = splitOptions(body);

  let thirdParty: boolean | undefined;
  let matchCase = false;
  let important = false;
  let documentOpt = false;
  let cosmeticSwitch: CosmeticSwitch | undefined;
  const include = new Set<ResourceType>();
  const exclude = new Set<ResourceType>();
  let sawUnsupportedType = false;
  let sawSupportedType = false;
  const initiatorDomains: string[] = [];
  const excludedInitiatorDomains: string[] = [];
  let methods: string[] | undefined;
  let removeParam: string | undefined;

  for (const rawOpt of options) {
    const opt = rawOpt.trim();
    if (!opt) continue;
    const eq = opt.indexOf('=');
    const nameWithNeg = (eq === -1 ? opt : opt.slice(0, eq)).toLowerCase();
    const value = eq === -1 ? '' : opt.slice(eq + 1);
    const negated = nameWithNeg.startsWith('~');
    const name = negated ? nameWithNeg.slice(1) : nameWithNeg;

    if (UNSUPPORTED_OPTIONS.has(name)) return skip(`option:${name}`);

    switch (name) {
      case 'third-party':
      case '3p':
        thirdParty = !negated;
        continue;
      case 'first-party':
      case '1p':
        thirdParty = negated;
        continue;
      case 'match-case':
        matchCase = !negated;
        continue;
      case 'important':
        important = true;
        continue;
      case 'elemhide':
      case 'ehide':
        cosmeticSwitch = 'elemhide';
        continue;
      case 'generichide':
      case 'ghide':
        cosmeticSwitch = 'generichide';
        continue;
      case 'domain':
      case 'from': {
        for (const part of value.split('|')) {
          const neg = part.startsWith('~');
          const raw = neg ? part.slice(1) : part;
          if (raw.includes('*')) {
            // Entidades tipo "example.*": DNR no las expresa.
            // Sin la exclusión el filtro bloquearía de más, así que se descarta;
            // sin una inclusión solo se estrecha, así que se ignora esa entrada.
            if (neg) return skip('domain:wildcard-exclusion');
            continue;
          }
          const d = normalizeDomain(raw);
          if (!d) return skip('domain:invalid');
          (neg ? excludedInitiatorDomains : initiatorDomains).push(d);
        }
        if (!value.split('|').some((p) => !p.startsWith('~')) || initiatorDomains.length > 0) continue;
        return skip('domain:only-wildcards');
      }
      case 'method': {
        methods = value
          .split('|')
          .filter((m) => !m.startsWith('~'))
          .map((m) => m.toLowerCase());
        if (methods.length === 0) return skip('option:method-negated');
        continue;
      }
      case 'removeparam':
        // DNR solo quita parámetros por nombre exacto (queryTransform.removeParams).
        if (exception || negated) return skip('removeparam:exception');
        if (!value) return skip('removeparam:all');
        if (!PARAM_RE.test(value)) return skip('removeparam:not-literal');
        removeParam = value;
        continue;
      case 'all':
        for (const t of [...Object.values(TYPE_MAP).flat(), 'sub_frame' as const]) include.add(t);
        sawSupportedType = true;
        continue;
    }

    if (name === 'document' || name === 'doc') {
      if (exception) {
        documentOpt = true;
        continue;
      }
    }

    if (UNSUPPORTED_TYPES.has(name)) {
      if (!negated) sawUnsupportedType = true;
      continue;
    }

    const types = TYPE_MAP[name];
    if (!types) return skip(`option:unknown:${name}`);
    sawSupportedType = true;
    for (const t of types) (negated ? exclude : include).add(t);
  }

  if (sawUnsupportedType && include.size === 0 && !sawSupportedType) return skip('type:popup-or-unsupported');

  // Excepciones que solo apagan la ocultación cosmética en un sitio.
  if (exception && cosmeticSwitch && !documentOpt) {
    const host = hostOnlyPattern(rawPattern);
    if (!host) return skip('cosmetic-switch:not-host');
    return { kind: 'cosmetic-switch', switch: cosmeticSwitch, domain: host, filter };
  }

  const condition: DnrCondition = {};

  // Patrón → urlFilter / regexFilter / requestDomains
  let pattern = rawPattern;
  const isRegex = pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/');
  if (isRegex) {
    const re = pattern.slice(1, -1);
    if (!isRe2Compatible(re)) return skip('regex:unsupported');
    condition.regexFilter = re;
  } else {
    if (!matchCase) pattern = pattern.toLowerCase();
    pattern = pattern.replace(/^\*+/, '').replace(/\*+$/, '');
    if (pattern.startsWith('||*')) pattern = pattern.slice(2);
    if (pattern === '|' || pattern === '||') pattern = '';
    const host = hostOnlyPattern(pattern);
    if (host) {
      condition.requestDomains = [host];
    } else if (pattern) {
      const inner = pattern.replace(/^\|\|?/, '').replace(/\|$/, '');
      if (inner.includes('|')) return skip('pattern:inner-pipe');
      if (/[^\x00-\x7f]/.test(pattern)) {
        const m = /^\|\|([^/^:?*]+)(.*)$/.exec(pattern);
        const ascii = m ? normalizeDomain(m[1]!) : null;
        if (!m || !ascii || /[^\x00-\x7f]/.test(m[2]!)) return skip('pattern:non-ascii');
        pattern = `||${ascii}${m[2]}`;
      }
      condition.urlFilter = pattern;
    }
  }
  if (matchCase) condition.isUrlFilterCaseSensitive = true;

  // Un $removeparam sin patrón es válido: al agrupar se le pone `^parametro=` como filtro.
  if (
    !removeParam &&
    !condition.urlFilter &&
    !condition.regexFilter &&
    !condition.requestDomains &&
    initiatorDomains.length === 0
  ) {
    return skip('pattern:too-broad');
  }

  if (initiatorDomains.length) condition.initiatorDomains = initiatorDomains;
  if (excludedInitiatorDomains.length) condition.excludedInitiatorDomains = excludedInitiatorDomains;
  if (thirdParty !== undefined) condition.domainType = thirdParty ? 'thirdParty' : 'firstParty';
  if (methods) condition.requestMethods = methods;

  if (removeParam) {
    for (const t of exclude) include.delete(t);
    // Por defecto solo la navegación principal, que es la URL que el usuario ve y comparte.
    condition.resourceTypes = include.size ? [...include].sort() : ['main_frame'];
    return {
      kind: 'rule',
      rule: {
        priority: PRIORITY_DEFAULT,
        action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: [removeParam] } } } },
        condition,
      },
      filter,
    };
  }

  let actionType: 'block' | 'allow' | 'allowAllRequests';
  if (exception && documentOpt) {
    actionType = 'allowAllRequests';
    condition.resourceTypes = ['main_frame', 'sub_frame'];
  } else {
    actionType = exception ? 'allow' : 'block';
    if (include.size) {
      for (const t of exclude) include.delete(t);
      if (include.size === 0) return skip('type:empty');
      condition.resourceTypes = [...include].sort();
    } else if (exclude.size) {
      condition.excludedResourceTypes = [...exclude].sort();
    }
  }

  return {
    kind: 'rule',
    rule: {
      priority: important && !exception ? PRIORITY_IMPORTANT : PRIORITY_DEFAULT,
      action: { type: actionType },
      condition,
    },
    filter,
  };
}

/** Devuelve el host si el patrón es exactamente `||host^` (o `||host^|`). */
export function hostOnlyPattern(pattern: string): string | null {
  const m = /^\|\|([^/^:?*|]+)\^\|?$/.exec(pattern);
  if (!m) return null;
  return normalizeDomain(m[1]!);
}
