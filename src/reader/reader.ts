// Modo lectura. Se inyecta bajo demanda (atajo, menú contextual o popup) en el mundo aislado
// de la extensión; inyectarlo otra vez lo cierra.
//
// Solo lee lo que la página ya ha traído, sin peticiones nuevas. Prueba tres fuentes y se queda
// con la que da más texto:
//   1. La copia del documento que hizo snapshot.ts al terminar el análisis, antes de que los scripts
//      de la página recorten o tapen el artículo.
//   2. El DOM tal y como está ahora (páginas que montan el contenido con JavaScript).
//   3. El campo articleBody de los datos estructurados (JSON-LD) que traen muchos medios.
// El texto se muestra en un <dialog> modal dentro de un shadow root cerrado: queda en la capa
// superior, por encima de cualquier cosa de la página, y el CSS de la página no le afecta.

import Readability from './Readability.cjs';

declare global {
  // eslint-disable-next-line no-var
  var __largoSnapshot: Document | undefined;
  // eslint-disable-next-line no-var
  var __largoReaderToggle: (() => void) | undefined;
}

type Theme = 'light' | 'sepia' | 'dark';
interface Prefs { size: number; theme: Theme }
interface Found { kind: 'html' | 'jsonld'; title: string; byline: string; site: string; lang: string; dir: string; content: DocumentFragment; words: number }

const t = (key: string, ...subs: string[]) => chrome.i18n.getMessage(key, subs);
const PREFS_KEY = 'readerPrefs';
const SIZES = [16, 18, 20, 22, 24, 27, 30];

// ── Extracción ───────────────────────────────────────────────────────────────

const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

function fromDocument(doc: Document): Found | null {
  const article = new Readability(doc, { charThreshold: 400 }).parse();
  if (!article?.content) return null;
  return {
    kind: 'html',
    title: article.title ?? '',
    byline: article.byline ?? '',
    site: article.siteName ?? '',
    lang: article.lang ?? '',
    dir: article.dir ?? '',
    content: sanitize(article.content),
    words: words(article.textContent ?? ''),
  };
}

function fromJsonLd(doc: Document): Found | null {
  let best: { body: string; title: string; author: string } | null = null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    if (typeof o.articleBody === 'string' && o.articleBody.length > (best?.body.length ?? 0)) {
      const authors = ([] as unknown[]).concat(o.author ?? []);
      best = {
        body: o.articleBody,
        title: typeof o.headline === 'string' ? o.headline : '',
        author: authors.map((a) => (typeof a === 'string' ? a : (a as { name?: unknown })?.name)).filter((n) => typeof n === 'string').join(', '),
      };
    }
    Object.values(o).forEach(visit);
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent ?? ''));
    } catch {
      /* JSON mal formado: se ignora */
    }
  }
  const found = best as { body: string; title: string; author: string } | null;
  if (!found) return null;
  const frag = document.createDocumentFragment();
  for (const para of found.body.split(/\n\s*\n|\r?\n/)) {
    if (!para.trim()) continue;
    const p = document.createElement('p');
    p.textContent = para.trim();
    frag.append(p);
  }
  return { kind: 'jsonld', title: found.title, byline: found.author, site: '', lang: doc.documentElement.lang, dir: '', content: frag, words: words(found.body) };
}

function extract(): Found | null {
  const candidates: Found[] = [];
  const tryIt = (f: () => Found | null) => {
    try {
      const r = f();
      if (r) candidates.push(r);
    } catch (e) {
      console.debug('[largo reader]', e);
    }
  };
  // Las copias conservan la URL de la página, así que los enlaces relativos se resuelven bien.
  // Readability modifica el documento que recibe: siempre se le pasa una copia.
  const snapshot = globalThis.__largoSnapshot ?? null;
  if (snapshot) tryIt(() => fromDocument(snapshot.cloneNode(true) as Document));
  tryIt(() => fromDocument(document.cloneNode(true) as Document));
  tryIt(() => fromJsonLd(document));
  if (snapshot) tryIt(() => fromJsonLd(snapshot));
  if (!candidates.length) return null;

  // Ante textos parecidos se prefiere el HTML (conserva imágenes, títulos y enlaces); el
  // articleBody solo gana si trae claramente más texto.
  const html = candidates.filter((c) => c.kind === 'html');
  const bestHtml = html.sort((a, b) => b.words - a.words)[0];
  const bestAny = [...candidates].sort((a, b) => b.words - a.words)[0]!;
  const winner = bestHtml && bestHtml.words * 1.25 >= bestAny.words ? bestHtml : bestAny;
  if (winner.words < 80) return null;
  const titled = candidates.find((c) => c.title);
  return { ...winner, title: winner.title || titled?.title || document.title, byline: winner.byline || candidates.find((c) => c.byline)?.byline || '' };
}

/** HTML de Readability → fragmento inerte y limpio: sin scripts, estilos, formularios ni manejadores. */
function sanitize(html: string): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('script, style, link, meta, iframe, object, embed, form, input, button, select, textarea, noscript, svg, canvas, template').forEach((el) => el.remove());
  for (const el of doc.body.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const keep = ['href', 'src', 'srcset', 'sizes', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan', 'lang', 'dir', 'datetime', 'start', 'reversed', 'type'].includes(name);
      if (!keep || (/^(href|src)$/.test(name) && /^\s*(javascript|data:text|vbscript):/i.test(attr.value))) el.removeAttribute(attr.name);
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
    if (el.tagName === 'IMG') {
      el.setAttribute('loading', 'lazy');
      el.setAttribute('decoding', 'async');
      el.removeAttribute('width');
      el.removeAttribute('height');
    }
  }
  // Imágenes sin fuente (marcadores de carga diferida que Readability no pudo resolver).
  doc.body.querySelectorAll('img:not([src]):not([srcset])').forEach((el) => el.remove());
  const frag = document.createDocumentFragment();
  frag.append(...[...doc.body.childNodes].map((n) => document.importNode(n, true)));
  return frag;
}

// ── Interfaz ─────────────────────────────────────────────────────────────────

const CSS = `
:host { all: initial; }
dialog {
  --bg: #fdfdfc; --fg: #1f2124; --muted: #6d717a; --line: #e5e5e2; --link: #1f5fb3;
  position: fixed; inset: 0; width: 100vw; height: 100vh; max-width: none; max-height: none;
  margin: 0; padding: 0; border: 0; outline: none; overflow: auto; overscroll-behavior: contain;
  background: var(--bg); color: var(--fg); color-scheme: light;
  -webkit-font-smoothing: antialiased;
}
dialog.sepia { --bg: #f6efe2; --fg: #3b3127; --muted: #81715f; --line: #e3d8c4; --link: #8a4b14; }
dialog.dark { --bg: #1c1d20; --fg: #dcdcd8; --muted: #8e9198; --line: #33353a; --link: #84b1f0; color-scheme: dark; }
dialog::backdrop { background: transparent; }
.bar {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 4px;
  padding: 8px 14px; background: var(--bg); border-bottom: 1px solid transparent;
  font: 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted);
}
.bar.scrolled { border-bottom-color: var(--line); }
.bar .site { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar button {
  min-width: 32px; height: 30px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px;
  background: transparent; color: var(--fg); font: inherit; cursor: pointer;
}
.bar button:hover { background: var(--line); }
.bar .swatch { width: 30px; padding: 0; border-radius: 50%; }
.bar .swatch[data-theme="light"] { background: #fdfdfc; color: #1f2124; }
.bar .swatch[data-theme="sepia"] { background: #f6efe2; color: #3b3127; }
.bar .swatch[data-theme="dark"] { background: #1c1d20; color: #dcdcd8; }
.bar .swatch[aria-pressed="true"] { outline: 2px solid var(--link); outline-offset: 1px; }
.bar .sep { width: 8px; }
article {
  max-width: 36em; margin: 0 auto; padding: 28px 22px 96px;
  font-family: "Iowan Old Style", Charter, "Bitstream Charter", Georgia, "Times New Roman", serif;
  font-size: var(--size, 20px); line-height: 1.62; overflow-wrap: break-word; hyphens: auto;
}
h1.title { font-size: 1.75em; line-height: 1.18; margin: 0 0 .45em; font-weight: 700; }
.meta { font: .72em/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted); margin: 0 0 2.2em; }
.content h1, .content h2, .content h3, .content h4 { line-height: 1.25; margin: 1.6em 0 .5em; }
.content h1 { font-size: 1.4em; } .content h2 { font-size: 1.25em; } .content h3 { font-size: 1.1em; }
.content p { margin: 0 0 1.05em; }
.content a { color: var(--link); text-decoration-thickness: 1px; text-underline-offset: 2px; }
.content img, .content video, .content picture { display: block; max-width: 100%; height: auto; margin: 1.4em auto .5em; border-radius: 3px; }
.content figure { margin: 1.6em 0; }
.content figcaption, .content small { font: .72em/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--muted); }
.content blockquote { margin: 1.4em 0; padding: 0 0 0 1em; border-left: 3px solid var(--line); color: var(--muted); }
.content ul, .content ol { padding-left: 1.4em; }
.content li { margin: .3em 0; }
.content pre, .content code { font: .82em/1.5 ui-monospace, Menlo, Consolas, monospace; }
.content pre { overflow: auto; padding: .8em 1em; background: var(--line); border-radius: 6px; }
.content table { border-collapse: collapse; font-size: .85em; display: block; overflow-x: auto; }
.content td, .content th { border: 1px solid var(--line); padding: .3em .6em; }
.content hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }
.toast {
  position: fixed; left: 50%; top: 24px; transform: translateX(-50%); z-index: 2147483647;
  padding: 10px 16px; border-radius: 8px; background: #1f2124; color: #fff;
  font: 14px/1.3 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25);
}
@media (max-width: 600px) { article { padding: 18px 16px 80px; } }
`;

async function loadPrefs(): Promise<Prefs> {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const fallback: Prefs = { size: 20, theme: dark ? 'dark' : 'light' };
  try {
    const stored = (await chrome.storage.local.get(PREFS_KEY))[PREFS_KEY] as Partial<Prefs> | undefined;
    return { ...fallback, ...stored };
  } catch {
    return fallback;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {}, ...children: (Node | string)[]) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function toast(root: ShadowRoot, host: HTMLElement, text: string) {
  const box = el('div', { className: 'toast', role: 'status' } as Partial<HTMLDivElement>, text);
  root.append(box);
  setTimeout(() => host.remove(), 2600);
}

async function open() {
  const host = document.createElement('largo-reader');
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);
  document.documentElement.append(host);

  const found = extract();
  if (!found) {
    toast(root, host, t('readerNone'));
    return;
  }

  const prefs = await loadPrefs();
  const dialog = document.createElement('dialog');
  dialog.lang = found.lang || document.documentElement.lang || '';
  if (found.dir) dialog.dir = found.dir;

  const site = found.site || location.hostname.replace(/^www\./, '');
  const minutes = Math.max(1, Math.round(found.words / 230));
  const metaBits = [found.byline, t('readerMinutes', String(minutes))].filter(Boolean).join(' · ');

  const button = (label: string, title: string, onClick: () => void, extra: Partial<HTMLButtonElement> = {}) =>
    el('button', { type: 'button', title, ariaLabel: title, onclick: onClick, ...extra }, label);

  const save = () => void chrome.storage.local.set({ [PREFS_KEY]: prefs }).catch(() => {});
  const apply = () => {
    dialog.className = prefs.theme;
    article.style.setProperty('--size', `${prefs.size}px`);
    for (const b of swatches) b.setAttribute('aria-pressed', String(b.dataset.theme === prefs.theme));
  };
  const resize = (step: number) => {
    const i = SIZES.indexOf(prefs.size);
    prefs.size = SIZES[Math.min(SIZES.length - 1, Math.max(0, (i < 0 ? 2 : i) + step))]!;
    apply();
    save();
  };
  const swatches = (['light', 'sepia', 'dark'] as const).map((theme) => {
    const b = button('Aa', `${t('readerTheme')}: ${theme}`, () => {
      prefs.theme = theme;
      apply();
      save();
    });
    b.className = 'swatch';
    b.dataset.theme = theme;
    return b;
  });

  const bar = el(
    'div',
    { className: 'bar' },
    el('span', { className: 'site', title: location.href }, site),
    button('A−', t('readerSmaller'), () => resize(-1)),
    button('A+', t('readerLarger'), () => resize(1)),
    el('span', { className: 'sep' }),
    ...swatches,
    el('span', { className: 'sep' }),
    button('✕', t('readerClose'), () => close()),
  );
  const content = el('div', { className: 'content' });
  content.append(found.content);
  // Readability suele repetir el titular dentro del contenido.
  const firstHeading = content.querySelector('h1, h2');
  if (firstHeading && firstHeading.textContent?.trim() === found.title.trim()) firstHeading.remove();
  const article = el('article', {}, el('h1', { className: 'title' }, found.title), el('p', { className: 'meta' }, metaBits), content);
  dialog.append(bar, article);
  dialog.addEventListener('scroll', () => bar.classList.toggle('scrolled', dialog.scrollTop > 4), { passive: true });
  apply();

  // La página no debe desplazarse por debajo mientras se lee.
  const html = document.documentElement;
  const previousOverflow = html.style.getPropertyValue('overflow');
  const previousPriority = html.style.getPropertyPriority('overflow');
  html.style.setProperty('overflow', 'hidden', 'important');

  // Si un script de la página quita el lector del DOM, se vuelve a poner.
  const keepAttached = new MutationObserver(() => {
    if (!host.isConnected) {
      document.documentElement.append(host);
      if (!dialog.open) dialog.showModal();
    }
  });
  keepAttached.observe(document.documentElement, { childList: true });

  function close() {
    keepAttached.disconnect();
    globalThis.__largoReaderToggle = undefined;
    if (dialog.open) dialog.close();
    host.remove();
    html.style.setProperty('overflow', previousOverflow, previousPriority);
  }
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault();
    close();
  });

  globalThis.__largoReaderToggle = close;
  root.append(dialog);
  dialog.showModal();
  dialog.scrollTop = 0;
  dialog.focus();
}

// Al final del módulo: todo lo de arriba ya está inicializado.
if (globalThis.__largoReaderToggle) globalThis.__largoReaderToggle();
else void open();
