// Filtros de ocultación de elementos (##, #@#) → selectores CSS.

import { parse, type Selector } from 'css-what';
import { normalizeDomain } from './network.ts';

export type CosmeticResult =
  | {
      kind: 'hide' | 'unhide';
      selector: string;
      /** Dominios donde aplica (vacío = genérico). Pueden ser entidades "example.*". */
      domains: string[];
      /** Dominios excluidos (~dominio). */
      excludedDomains: string[];
      filter: string;
    }
  | { kind: 'skip'; reason: string; filter: string };

/** Pseudo-clases CSS que Chrome entiende de forma nativa. */
const NATIVE_PSEUDOS = new Set([
  'not', 'is', 'where', 'has', '-webkit-any',
  'first-child', 'last-child', 'only-child', 'first-of-type', 'last-of-type', 'only-of-type',
  'nth-child', 'nth-last-child', 'nth-of-type', 'nth-last-of-type',
  'empty', 'root', 'scope', 'link', 'any-link', 'visited', 'hover', 'focus', 'focus-within',
  'focus-visible', 'active', 'target', 'checked', 'disabled', 'enabled', 'required', 'optional',
  'read-only', 'read-write', 'placeholder-shown', 'default', 'indeterminate', 'valid', 'invalid',
  'in-range', 'out-of-range', 'lang', 'dir', 'defined', 'autofill', 'popover-open', 'modal',
]);

const COSMETIC_SEPARATOR = /^(.*?)(#@?[?$%]?#)(.+)$/;

export function isCosmeticFilter(line: string): boolean {
  return /#@?[?$%]?#/.test(line) && !line.startsWith('/') && !line.startsWith('|') && !line.startsWith('@@');
}

function validateSelector(selector: string): string | null {
  if (/[{}]/.test(selector) || /[\r\n]/.test(selector)) return 'selector:braces';
  let ast: Selector[][];
  try {
    ast = parse(selector);
  } catch {
    return 'selector:syntax';
  }
  const stack: { ast: Selector[][]; inHas: boolean }[] = [{ ast, inHas: false }];
  while (stack.length) {
    const { ast: list, inHas } = stack.pop()!;
    for (const compound of list) {
      for (const token of compound) {
        if (token.type === 'pseudo') {
          if (!NATIVE_PSEUDOS.has(token.name)) return `selector:pseudo:${token.name}`;
          // CSS no admite :has() dentro de :has().
          if (token.name === 'has' && inHas) return 'selector:nested-has';
          if (Array.isArray(token.data)) stack.push({ ast: token.data, inHas: inHas || token.name === 'has' });
        } else if (token.type === 'pseudo-element') {
          return 'selector:pseudo-element';
        }
      }
    }
  }
  return null;
}

export function parseCosmeticFilter(line: string): CosmeticResult {
  const filter = line.trim();
  const skip = (reason: string): CosmeticResult => ({ kind: 'skip', reason, filter });

  const m = COSMETIC_SEPARATOR.exec(filter);
  if (!m) return skip('cosmetic:malformed');
  const [, domainPart, sep, selectorRaw] = m as unknown as [string, string, string, string];

  if (sep.includes('?')) return skip('cosmetic:extended');
  if (sep.includes('$')) return skip('cosmetic:snippet');
  if (sep.includes('%')) return skip('cosmetic:script');

  const selector = selectorRaw.trim();
  const invalid = validateSelector(selector);
  if (invalid) return skip(invalid);

  const domains: string[] = [];
  const excludedDomains: string[] = [];
  for (const part of domainPart.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const neg = p.startsWith('~');
    const raw = (neg ? p.slice(1) : p).toLowerCase();
    let d: string | null;
    if (raw.endsWith('.*')) {
      const base = normalizeDomain(raw.slice(0, -2));
      d = base ? `${base}.*` : null;
    } else {
      d = normalizeDomain(raw);
    }
    if (!d) return skip('cosmetic:domain-invalid');
    (neg ? excludedDomains : domains).push(d);
  }

  return { kind: sep === '#@#' ? 'unhide' : 'hide', selector, domains, excludedDomains, filter };
}
