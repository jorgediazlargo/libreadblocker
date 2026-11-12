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

/** Elementos raíz: ocultarlos deja la página en blanco, nunca es un anuncio. */
const ROOT_TAGS = new Set(['html', 'body', 'head']);
const TRAVERSALS = new Set(['adjacent', 'child', 'descendant', 'parent', 'sibling', 'column-combinator']);
const SELECTOR_LISTS = new Set(['is', 'where', '-webkit-any']);

/** Trocea un selector complejo en compuestos (lo que hay entre combinadores). */
function compounds(complex: Selector[]): Selector[][] {
  const out: Selector[][] = [[]];
  for (const token of complex) {
    if (TRAVERSALS.has(token.type)) out.push([]);
    else out.at(-1)!.push(token);
  }
  return out;
}

/** Atributos que tiene casi cualquier elemento: su mera presencia no distingue nada. */
const UBIQUITOUS_ATTRS = new Set(['class', 'id', 'style', 'lang', 'dir']);

/** Elementos HTML estándar. Una etiqueta que no está aquí (<ad-slot>, <adblocker>) ya es específica. */
const HTML_TAGS = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo blockquote body br button canvas caption center cite code ' +
    'col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure font footer form ' +
    'h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark menu meta ' +
    'meter nav noscript object ol optgroup option output p picture pre progress q rp rt ruby s samp script search section ' +
    'select slot small source span strong style sub summary sup svg table tbody td template textarea tfoot th thead time ' +
    'title tr track u ul var video wbr'
  ).split(' '),
);

/** Algo que el autor de la página tiene que haber puesto: clase, id, atributo o etiqueta propia. */
function hasOwnAnchor(compound: Selector[]): boolean {
  return compound.some(
    (t) =>
      (t.type === 'attribute' && (t.action !== 'exists' || !UBIQUITOUS_ATTRS.has(t.name.toLowerCase()))) ||
      (t.type === 'tag' && !HTML_TAGS.has(t.name.toLowerCase())) ||
      (t.type === 'pseudo' &&
        SELECTOR_LISTS.has(t.name) &&
        Array.isArray(t.data) &&
        t.data.length > 0 &&
        t.data.every((alt) => hasOwnAnchor(compounds(alt).at(-1)!))),
  );
}

/** Ancla propia o heredada de un :has(). Un ancla sobre <html>/<body> no cuenta: están en todas las páginas. */
function isAnchored(compound: Selector[]): boolean {
  if (targetsRoot(compound)) return false;
  return (
    hasOwnAnchor(compound) ||
    compound.some(
      (t) =>
        t.type === 'pseudo' &&
        t.name === 'has' &&
        Array.isArray(t.data) &&
        t.data.length > 0 &&
        t.data.every((alt) => compounds(alt).some(isAnchored)),
    )
  );
}

/** `:has(> .x)` / `:has(+ .x)`: solo casa con el padre o hermano de algo anclado, no con todos sus ancestros. */
function hasNarrowHas(compound: Selector[]): boolean {
  return compound.some(
    (t) =>
      t.type === 'pseudo' &&
      t.name === 'has' &&
      Array.isArray(t.data) &&
      t.data.length > 0 &&
      t.data.every(
        (alt) =>
          (alt[0]?.type === 'child' || alt[0]?.type === 'adjacent' || alt[0]?.type === 'sibling') &&
          compounds(alt).some(isAnchored),
      ),
  );
}

function targetsRoot(compound: Selector[]): boolean {
  return compound.some(
    (t) =>
      (t.type === 'tag' && ROOT_TAGS.has(t.name.toLowerCase())) ||
      (t.type === 'pseudo' && t.name === 'root') ||
      (t.type === 'pseudo' &&
        SELECTOR_LISTS.has(t.name) &&
        Array.isArray(t.data) &&
        t.data.some((alt) => targetsRoot(compounds(alt).at(-1)!))),
  );
}

/**
 * Defensa ante una lista comprometida: rechaza los selectores que ocultarían la página
 * entera o casi (`body`, `*`, `:not(.x)`, `:has(.ad)`, y en filtros genéricos también `div`).
 * No sustituye a revisar los cambios de cada actualización: `[class*="a"]` pasa.
 */
function breadthProblem(ast: Selector[][], generic: boolean): string | null {
  for (const complex of ast) {
    const parts = compounds(complex);
    const subject = parts.at(-1)!;
    if (targetsRoot(subject)) return 'selector:page-root';
    // Sin etiqueta ni ancla propia (`*`, `:not(.x)`, `:has(.ad)`, `html > *`) el sujeto casa con
    // <html>, <body> o todo su contenido. Se admite si cuelga de algo anclado (`.ad > *`), si es
    // el padre o hermano directo de algo anclado (`:has(> .ad)`), o si está a tres niveles o más
    // (ya no puede ser <html> ni <body>) y lleva un :has() anclado.
    const bare = !hasOwnAnchor(subject) && !subject.some((t) => t.type === 'tag');
    const ok =
      parts.slice(0, -1).some(isAnchored) || hasNarrowHas(subject) || (parts.length >= 3 && isAnchored(subject));
    if (bare && !ok) return 'selector:too-broad';
    if (generic && !parts.some(isAnchored)) return 'selector:too-broad';
  }
  return null;
}

/** Devuelve el selector analizado, o el motivo por el que no se admite. */
function validateSelector(selector: string): Selector[][] | string {
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
  return ast;
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
  const ast = validateSelector(selector);
  if (typeof ast === 'string') return skip(ast);

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

  // Un #@# solo deja de ocultar: no hace falta limitar su alcance.
  if (sep === '#@#') return { kind: 'unhide', selector, domains, excludedDomains, filter };
  const tooBroad = breadthProblem(ast, domains.length === 0);
  if (tooBroad) return skip(tooBroad);
  return { kind: 'hide', selector, domains, excludedDomains, filter };
}
