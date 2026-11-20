// Prueba del modo lectura en Chrome real (perfil temporal), con una página local que recorta el
// artículo al cargar, como hacen muchos medios.
//   pnpm build && node scripts/_reader.ts
import puppeteer from 'puppeteer-core';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:http';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '.cache/reader');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const para = (i: number) =>
  `<p>Párrafo ${i} del artículo de prueba. ` +
  'El ayuntamiento aprobó ayer el nuevo plan de movilidad tras meses de negociación con los vecinos, que reclamaban más carriles bici, aceras más anchas y menos tráfico de paso por el centro de la ciudad. '.repeat(2) +
  '</p>';
const ARTICLE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Plan de movilidad — Diario de prueba</title>
<script type="application/ld+json">{"@type":"NewsArticle","headline":"Plan de movilidad","author":{"name":"Ana Pérez"}}</script></head>
<body><header><nav>Portada · Local · Deportes</nav></header>
<article><h1>El ayuntamiento aprueba el plan de movilidad</h1><p class="byline">Por Ana Pérez</p>
${Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n')}
</article>
<aside>Lo más leído</aside>
<script>
  // Muro de pago de prueba: al terminar de cargar recorta el artículo y lo tapa.
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('article p:not(.byline)').forEach((p, i) => { if (i > 0) p.remove(); });
    const wall = document.createElement('div');
    wall.id = 'wall';
    wall.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,.97);font:30px sans-serif;display:grid;place-items:center;z-index:99999';
    wall.textContent = 'Suscríbete para seguir leyendo';
    document.body.append(wall);
  });
</script></body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url === '/empty' ? '<!doctype html><title>Vacía</title><p>Hola</p>' : ARTICLE);
}).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

await mkdir(OUT, { recursive: true });

const results: Record<string, boolean> = {};
const check = (name: string, ok: boolean, detail = '') => {
  results[name] = ok;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  pipe: true,
  enableExtensions: true,
  userDataDir: await mkdtemp(join(tmpdir(), 'largo-reader-')),
  args: ['--no-first-run', '--no-default-browser-check', '--lang=es-ES'],
});
try {
  const id = await browser.installExtension(DIST);
  const ext = (await browser.extensions()).get(id)!;
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`));
  const sw = (await swTarget.worker())!;
  let scripts: string[] = [];
  for (let i = 0; i < 40 && !scripts.includes('reader-snapshot'); i++) {
    await sleep(250);
    scripts = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
  }
  check('content script reader-snapshot registrado', scripts.includes('reader-snapshot'));
  const cmds = await sw.evaluate(async () => (await chrome.commands.getAll()).map((c) => `${c.name}=${c.shortcut}`));
  check('atajo toggle-reader', cmds.some((c) => c.startsWith('toggle-reader=')), cmds.join(', '));

  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 800 });
  await page.goto(`${base}/articulo`, { waitUntil: 'load' });
  await sleep(300);
  const visible = await page.evaluate(() => document.querySelectorAll('article p:not(.byline)').length);
  check('la página recorta el artículo', visible === 1, `${visible} párrafo(s) visibles`);
  await page.screenshot({ path: join(OUT, 'reader-1-pagina.png') });

  // Popup → botón «Modo lectura»
  await page.bringToFront();
  await page.triggerExtensionAction(ext);
  const popupTarget = await browser.waitForTarget((t) => t.url().startsWith(`chrome-extension://${id}/popup.html`), { timeout: 10000 });
  const popup = (await popupTarget.asPage())!;
  await popup.waitForSelector('#reader');
  await sleep(300);
  const label = (await popup.$eval('#reader', (b) => b.textContent)) ?? '';
  check('botón en el popup', /Modo lectura/.test(label), label);
  await popup.screenshot({ path: join(OUT, 'reader-0-popup.png') });
  await popup.click('#reader');
  await sleep(800);

  // El lector vive en un shadow root cerrado: se lee por CDP.
  const cdp = await page.createCDPSession();
  interface DomNode { nodeName: string; nodeType: number; nodeValue: string; parentId?: number; children?: DomNode[]; shadowRoots?: DomNode[] }
  const readerText = async (): Promise<string | null> => {
    const { root } = (await cdp.send('DOM.getDocument', { depth: -1, pierce: true })) as unknown as { root: DomNode };
    let host: DomNode | null = null;
    const find = (n: DomNode) => {
      if (host) return;
      if (n.nodeName === 'LARGO-READER') host = n;
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) find(c);
    };
    find(root);
    if (!host) return null;
    const texts: string[] = [];
    const walk = (n: DomNode) => {
      if (n.nodeType === 3 && n.parentId && n.nodeValue.trim()) texts.push(n.nodeValue);
      for (const c of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) walk(c);
    };
    walk(host);
    return texts.filter((t) => !t.includes('{')).join(' ');
  };
  const text = await readerText();
  const paragraphs = (text?.match(/Párrafo \d+/g) ?? []).length;
  check('el lector se abre', text !== null);
  check('el lector muestra el artículo completo', paragraphs === 12, `${paragraphs}/12 párrafos`);
  check('titular y autor', /El ayuntamiento aprueba el plan de movilidad/.test(text ?? '') && /Ana Pérez/.test(text ?? ''));
  check('el muro de pago no aparece', !/Suscríbete/.test(text ?? ''));
  await page.screenshot({ path: join(OUT, 'reader-2-lector.png') });

  await page.keyboard.press('Escape');
  await sleep(300);
  check('Esc cierra el lector', (await readerText()) === null);

  // Volver a abrirlo desde el service worker (el mismo camino que el atajo y el menú contextual).
  const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]!.id!, base);
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['reader/reader.js'] }), tabId);
  await sleep(500);
  check('se reabre desde el service worker', ((await readerText()) ?? '').includes('Párrafo 12'));
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['reader/reader.js'] }), tabId);
  await sleep(300);
  check('inyectarlo otra vez lo cierra', (await readerText()) === null);

  // Página sin artículo: aviso y nada más.
  await page.goto(`${base}/empty`, { waitUntil: 'load' });
  const tab2 = await sw.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0]!.id!, base);
  await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['reader/reader.js'] }), tab2);
  await sleep(300);
  const none = await readerText();
  check('aviso en páginas sin artículo', /No se ha encontrado/.test(none ?? ''), none ?? '(nada)');

  // La copia no es visible para la página.
  const leaked = await page.evaluate(() => typeof (globalThis as { __largoSnapshot?: unknown }).__largoSnapshot);
  check('la página no ve la copia', leaked === 'undefined');
} finally {
  await browser.close();
  server.close();
}
const failed = Object.entries(results).filter(([, ok]) => !ok);
console.log(failed.length ? `\n${failed.length} fallo(s)` : '\nTodo OK');
process.exit(failed.length ? 1 : 0);
