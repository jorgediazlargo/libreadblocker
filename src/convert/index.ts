// Convierte listas de filtros completas en rulesets DNR + datos cosméticos,
// respetando los límites de Chrome.

import { parseNetworkFilter, type DnrRule, type CosmeticSwitch } from './network.ts';
import { parseCosmeticFilter, isCosmeticFilter } from './cosmetic.ts';

/**
 * Límites de declarativeNetRequest (comprobados en la documentación de Chrome, nov. 2026):
 * GUARANTEED_MINIMUM_STATIC_RULES = 30000 por extensión (reglas por encima salen de un
 * cupo global compartido y no están garantizadas); MAX_NUMBER_OF_REGEX_RULES = 1000 para
 * el conjunto de reglas estáticas.
 */
export const LIMITS = { maxRules: 30_000, maxRegexRules: 1_000 };

export interface InputList {
  id: string;
  text: string;
}

export interface CosmeticData {
  /** Selectores genéricos sin excepciones: van al CSS estático. */
  generic: string[];
  /** Datos compactos para el content script de selectores específicos. */
  specific: SpecificData;
  /** Sitios donde las listas desactivan toda la cosmética ($elemhide / $document). */
  elemhideDomains: string[];
  /** Sitios donde las listas desactivan la cosmética genérica ($generichide). */
  generichideDomains: string[];
}

export interface SpecificData {
  /** Tabla de selectores; el resto de campos guarda índices. */
  s: string[];
  /** dominio → selectores a ocultar. */
  h: Record<string, number[]>;
  /** dominio → selectores que NO se ocultan (excepciones #@#). */
  x: Record<string, number[]>;
  /** Selectores genéricos con dominios exceptuados: [selector, dominios]. */
  g: [number, string[]][];
}

export interface ListReport {
  id: string;
  version: string | null;
  lines: number;
  networkFilters: number;
  cosmeticFilters: number;
  networkConverted: number;
  cosmeticConverted: number;
  skipped: Record<string, number>;
  rules: number;
  droppedByLimit: number;
  /** Filtros descartados porque ocultarían la página entera: señal de lista comprometida. */
  tooBroad: string[];
}

export interface ConversionOutput {
  rulesets: { id: string; rules: DnrRule[] }[];
  cosmetic: CosmeticData;
  report: {
    limits: typeof LIMITS;
    totalRules: number;
    totalRegexRules: number;
    droppedByLimit: number;
    droppedByLimitByCategory: Record<string, number>;
    lists: ListReport[];
  };
}

type PendingRule = Omit<DnrRule, 'id'>;

const CATEGORY_NAMES = ['allow', 'domain-list', 'host-anchored', 'url-pattern', 'regex'] as const;

/** Orden de preferencia si hay que recortar: excepciones, luego ||dominio^, ... regex al final. */
function category(rule: PendingRule): number {
  if (rule.action.type !== 'block') return 0;
  const c = rule.condition;
  if (c.requestDomains && !c.urlFilter && !c.regexFilter) return 1;
  if (c.urlFilter?.startsWith('||')) return 2;
  if (c.regexFilter) return 4;
  return 3;
}

/** Quita subdominios cuando su dominio padre ya está en la lista. */
export function pruneSubdomains(domains: Iterable<string>): string[] {
  const set = new Set(domains);
  const out: string[] = [];
  for (const d of set) {
    let covered = false;
    for (let i = d.indexOf('.'); i !== -1; i = d.indexOf('.', i + 1)) {
      if (set.has(d.slice(i + 1))) {
        covered = true;
        break;
      }
    }
    if (!covered) out.push(d);
  }
  return out.sort();
}

/**
 * Agrupa reglas `||dominio^` con las mismas opciones en una sola regla con requestDomains,
 * y los `$removeparam` con la misma condición en una sola redirección.
 */
export function aggregateRules(rules: PendingRule[]): PendingRule[] {
  const groups = new Map<string, { base: PendingRule; domains: string[] }>();
  const others = new Map<string, PendingRule>();
  const params = new Map<string, { rule: PendingRule; names: Set<string> }>();
  for (const rule of rules) {
    const { requestDomains, ...rest } = rule.condition;
    if (rule.action.type === 'redirect') {
      const key = JSON.stringify(rule.condition);
      let p = params.get(key);
      if (!p) params.set(key, (p = { rule, names: new Set() }));
      for (const name of rule.action.redirect.transform.queryTransform.removeParams) p.names.add(name);
    } else if (requestDomains && !rest.urlFilter && !rest.regexFilter) {
      const key = JSON.stringify({ ...rule, condition: rest });
      const g = groups.get(key);
      if (g) g.domains.push(...requestDomains);
      else groups.set(key, { base: { ...rule, condition: rest }, domains: [...requestDomains] });
    } else {
      others.set(JSON.stringify(rule), rule);
    }
  }
  const out: PendingRule[] = [];
  for (const { base, domains } of groups.values()) {
    out.push({ ...base, condition: { requestDomains: pruneSubdomains(domains), ...base.condition } });
  }
  out.push(...others.values());
  for (const { rule, names } of params.values()) {
    const removeParams = [...names].sort();
    const action: PendingRule['action'] = { type: 'redirect', redirect: { transform: { queryTransform: { removeParams } } } };
    const c = rule.condition;
    if (c.urlFilter || c.regexFilter) {
      out.push({ ...rule, action });
      continue;
    }
    // Sin patrón de URL: una regla por parámetro que solo salta si la URL lo lleva (`^` es un
    // separador: `?` o `&`), y que quita todos de una vez para no encadenar redirecciones.
    for (const name of removeParams) out.push({ ...rule, action, condition: { urlFilter: `^${name}=`, ...c } });
  }
  return out;
}

export function listVersion(text: string): string | null {
  return /^! Version: *(\S+)/m.exec(text)?.[1] ?? null;
}

export interface ConvertOptions {
  limits?: typeof LIMITS;
  /** Devuelve el motivo para descartar una regex (p. ej. la rechaza Chrome), o null. */
  rejectRegex?: (regex: string) => string | null;
}

export function convertLists(lists: InputList[], options: ConvertOptions = {}): ConversionOutput {
  const limits = options.limits ?? LIMITS;
  const reports: ListReport[] = [];
  const perList: { id: string; rules: PendingRule[] }[] = [];

  const genericHide = new Set<string>();
  const genericUnhideAll = new Set<string>();
  const genericExcept = new Map<string, Set<string>>();
  const specificHide = new Map<string, Set<string>>();
  const specificUnhide = new Map<string, Set<string>>();
  const switches: Record<CosmeticSwitch, Set<string>> = { elemhide: new Set(), generichide: new Set() };

  const add = (map: Map<string, Set<string>>, key: string, value: string) => {
    let s = map.get(key);
    if (!s) map.set(key, (s = new Set()));
    s.add(value);
  };

  for (const list of lists) {
    const report: ListReport = {
      id: list.id,
      version: listVersion(list.text),
      lines: 0,
      networkFilters: 0,
      cosmeticFilters: 0,
      networkConverted: 0,
      cosmeticConverted: 0,
      skipped: {},
      rules: 0,
      droppedByLimit: 0,
      tooBroad: [],
    };
    const skip = (reason: string) => (report.skipped[reason] = (report.skipped[reason] ?? 0) + 1);
    const rules: PendingRule[] = [];

    for (const rawLine of list.text.split(/\r?\n/)) {
      const line = rawLine.trim();
      report.lines++;
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;

      if (isCosmeticFilter(line)) {
        report.cosmeticFilters++;
        const r = parseCosmeticFilter(line);
        if (r.kind === 'skip') {
          skip(r.reason);
          if (r.reason === 'selector:page-root' || r.reason === 'selector:too-broad') report.tooBroad.push(r.filter);
          continue;
        }
        report.cosmeticConverted++;
        if (r.kind === 'hide') {
          if (r.domains.length === 0 && r.excludedDomains.length === 0) genericHide.add(r.selector);
          else if (r.domains.length === 0) for (const d of r.excludedDomains) add(genericExcept, r.selector, d);
          else {
            for (const d of r.domains) add(specificHide, d, r.selector);
            for (const d of r.excludedDomains) add(specificUnhide, d, r.selector);
          }
        } else {
          if (r.domains.length === 0) genericUnhideAll.add(r.selector);
          else for (const d of r.domains) add(specificUnhide, d, r.selector);
        }
        continue;
      }

      report.networkFilters++;
      const r = parseNetworkFilter(line);
      if (r.kind === 'skip') {
        skip(r.reason);
        continue;
      }
      report.networkConverted++;
      if (r.kind === 'cosmetic-switch') {
        switches[r.switch].add(r.domain);
        continue;
      }
      const c = r.rule.condition;
      const regexProblem = c.regexFilter && options.rejectRegex?.(c.regexFilter);
      if (regexProblem) {
        report.networkConverted--;
        skip(`regex:${regexProblem}`);
        continue;
      }
      if (r.rule.action.type === 'allowAllRequests' && c.requestDomains && !c.initiatorDomains) {
        for (const d of c.requestDomains) switches.elemhide.add(d);
      }
      rules.push(r.rule);
    }

    reports.push(report);
    perList.push({ id: list.id, rules: aggregateRules(rules) });
  }

  // --- Recorte por límites -------------------------------------------------
  const flat = perList.flatMap((l, listIndex) => l.rules.map((rule, i) => ({ rule, listIndex, i, cat: category(rule) })));
  flat.sort((a, b) => a.cat - b.cat || a.listIndex - b.listIndex || a.i - b.i);
  const kept = new Set<(typeof flat)[number]>();
  const droppedByCategory: Record<string, number> = {};
  let regexCount = 0;
  for (const item of flat) {
    const isRegex = Boolean(item.rule.condition.regexFilter);
    if (kept.size >= limits.maxRules || (isRegex && regexCount >= limits.maxRegexRules)) {
      const name = CATEGORY_NAMES[item.cat]!;
      droppedByCategory[name] = (droppedByCategory[name] ?? 0) + 1;
      reports[item.listIndex]!.droppedByLimit++;
      continue;
    }
    if (isRegex) regexCount++;
    kept.add(item);
  }

  const rulesets = perList.map((l, listIndex) => {
    const rules = flat
      .filter((item) => item.listIndex === listIndex && kept.has(item))
      .sort((a, b) => a.i - b.i)
      .map((item, n) => ({ id: n + 1, ...item.rule }));
    reports[listIndex]!.rules = rules.length;
    return { id: l.id, rules };
  });

  // --- Cosmética ------------------------------------------------------------
  for (const sel of genericUnhideAll) {
    genericHide.delete(sel);
    genericExcept.delete(sel);
  }
  // Un selector genérico con excepciones por sitio no puede ir en el CSS estático.
  for (const [domain, sels] of specificUnhide) {
    for (const sel of sels) {
      if (genericHide.has(sel)) {
        genericHide.delete(sel);
        add(genericExcept, sel, domain);
      } else if (genericExcept.has(sel)) {
        genericExcept.get(sel)!.add(domain);
      }
    }
  }

  const table: string[] = [];
  const index = new Map<string, number>();
  const idx = (sel: string) => {
    let i = index.get(sel);
    if (i === undefined) {
      i = table.push(sel) - 1;
      index.set(sel, i);
    }
    return i;
  };
  const toIndexMap = (map: Map<string, Set<string>>) => {
    const out: Record<string, number[]> = {};
    for (const [d, sels] of [...map].sort(([a], [b]) => a.localeCompare(b))) out[d] = [...sels].map(idx);
    return out;
  };
  const specific: SpecificData = {
    s: table,
    h: toIndexMap(specificHide),
    x: toIndexMap(specificUnhide),
    g: [...genericExcept].map(([sel, domains]) => [idx(sel), [...domains].sort()]),
  };

  const totalRules = rulesets.reduce((n, r) => n + r.rules.length, 0);
  return {
    rulesets,
    cosmetic: {
      generic: [...genericHide],
      specific,
      elemhideDomains: [...switches.elemhide].sort(),
      generichideDomains: [...switches.generichide].sort(),
    },
    report: {
      limits,
      totalRules,
      totalRegexRules: regexCount,
      droppedByLimit: flat.length - kept.size,
      droppedByLimitByCategory: droppedByCategory,
      lists: reports,
    },
  };
}

/** CSS de ocultación genérica, en bloques para que un selector raro no invalide todo. */
export function genericCss(selectors: string[], chunk = 200): string {
  const parts: string[] = [];
  for (let i = 0; i < selectors.length; i += chunk) {
    parts.push(`${selectors.slice(i, i + chunk).join(',')}{display:none!important}`);
  }
  return parts.join('\n') + '\n';
}
