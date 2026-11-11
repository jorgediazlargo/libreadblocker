// Content script de ocultación específica por sitio. Cada fichero generado
// (content/always.js, content/specific-bNN.js) llama a run() con sus datos.
// No usa MutationObserver: el CSS se aplica solo a los elementos que aparezcan después.

export interface CosmeticPayload {
  /** Tabla de selectores. */
  s: string[];
  /** host o entidad ("example.*") → índices de selectores a ocultar. */
  h: Record<string, number[]>;
  /** host o entidad → índices de selectores que no se ocultan (#@#). */
  x: Record<string, number[]>;
  /** Selectores genéricos con dominios exceptuados. */
  g?: [number, string[]][];
  /** Sitios con $generichide: no se aplica `g`. */
  gh?: string[];
}

/** "a.b.example.co.uk" → hosts padre y entidades ("example.*", "example.co.*"). */
export function hostCandidates(hostname: string): string[] {
  const parts = hostname.toLowerCase().replace(/\.$/, '').split('.');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    out.push(parts.slice(i).join('.'));
    for (let k = 1; k <= 2 && i + k < parts.length; k++) out.push(`${parts.slice(i, parts.length - k).join('.')}.*`);
  }
  return out;
}

export function selectorsFor(hostname: string, d: CosmeticPayload): string[] {
  const cands = hostCandidates(hostname);
  const hide = new Set<number>();
  for (const c of cands) for (const i of d.h[c] ?? []) hide.add(i);
  if (d.g && !(d.gh && cands.some((c) => d.gh!.includes(c)))) {
    const set = new Set(cands);
    for (const [i, domains] of d.g) if (!domains.some((x) => set.has(x))) hide.add(i);
  }
  for (const c of cands) for (const i of d.x[c] ?? []) hide.delete(i);
  return [...hide].map((i) => d.s[i]!);
}

export function run(d: CosmeticPayload): void {
  const selectors = selectorsFor(location.hostname, d);
  if (!selectors.length) return;
  // Una regla por selector: si Chrome no entiende uno, no arrastra a los demás.
  const css = selectors.map((s) => `${s}{display:none!important}`).join('\n');
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    (document.head ?? document.documentElement).appendChild(style);
  }
}
