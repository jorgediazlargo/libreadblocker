// Imágenes de la ficha de la Chrome Web Store que muestran la extensión: funciones, popup y modo
// lectura, en inglés y en español. Las capturas son de la extensión real (dist/) en Chrome sobre
// una página de ejemplo inventada (exampledaily.com, servida por interceptación: no se pide nada a
// ningún sitio real). Las fuentes salen de Google Fonts.
//   pnpm build && node scripts/store-images.ts   →  store/images/{en,es}/screenshot-{2,3,4}-*.png
//
// screenshot-1-before-after.png, los promos y el icono de la tienda no se generan aquí.

import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SITE = 'https://exampledaily.com';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const COLORS = { cream: '#fff7ec', ink: '#2a0e04', mint: '#2ee6a6', blush: '#ffd9d2', blushInk: '#a3301c' };

type Lang = 'en' | 'es';
const T = {
  en: {
    chromeLang: 'en-US',
    date: 'Friday, November 13 · Digital edition',
    nav: ['Home', 'City', 'Culture', 'Sports', 'Travel', 'Opinion'],
    headline: 'City opens a 100-acre park along the river',
    byline: 'By Laura Gómez',
    paras: [
      'The new park opens this weekend with walking trails, playgrounds and a bike lane connecting both banks of the river. It takes over land that was used for decades by the old freight yard.',
      'Residents will be able to join tree-planting days over the coming months. The plan also includes a lookout point, a small pier and a café run by a local cooperative.',
      'The project was approved after two years of public meetings. Neighbours asked for more shade, more benches and a quiet area away from the main paths, and all three made it into the final design.',
      'The city expects the park to welcome more than a million visitors a year. Buses will add a stop at the main entrance from Monday, and the bike lane links up with the existing network downtown.',
      'Maintenance will be shared between the parks department and volunteer groups, who will run guided walks every Saturday morning during the spring.',
    ],
    mostRead: 'Most read',
    reads: ['Ten autumn hikes under an hour away', 'Central market extends its opening hours', 'A first look at the new tram line'],
    featuresH: 'Four things, done well',
    featuresP: 'No telemetry, no accounts, no “acceptable” ads. Open source under GPLv3.',
    cards: [
      ['🛡️', 'Ads and trackers', 'Blocks them with the EasyList and EasyPrivacy filter lists, and removes “turn off your ad blocker” walls.'],
      ['🔗', 'Clean links', 'Strips utm_*, fbclid, gclid and other tracking parameters when you open a link. Affiliate codes are left alone.'],
      ['🍪', 'Cookies rejected', 'Clicks “reject” on cookie banners for you. It never accepts, and never hides a banner without answering it.'],
      ['📖', 'Reader view', 'Shows just the article, in light, sepia or dark, with the text size you like. Open it with ⌥⇧R.'],
    ],
    popupH: 'Everything in one click',
    popupP: 'See how many requests were blocked, turn blocking off for a single site, open reader view, and choose whether to clean links and reject cookies.',
    readerH: 'Just the article',
    readerPage: 'The page',
    readerView: 'Reader view',
  },
  es: {
    chromeLang: 'es-ES',
    date: 'Viernes, 13 de noviembre · Edición digital',
    nav: ['Portada', 'Ciudad', 'Cultura', 'Deportes', 'Viajes', 'Opinión'],
    headline: 'La ciudad abre un parque de 40 hectáreas junto al río',
    byline: 'Por Laura Gómez',
    paras: [
      'El nuevo parque abre este fin de semana con senderos, zonas de juego y un carril bici que une las dos orillas del río. Ocupa los terrenos que durante décadas usó la antigua estación de mercancías.',
      'Los vecinos podrán participar en jornadas de plantación de árboles en los próximos meses. El plan incluye también un mirador, un pequeño embarcadero y una cafetería que gestionará una cooperativa del barrio.',
      'El proyecto se aprobó tras dos años de reuniones vecinales. Los vecinos pidieron más sombra, más bancos y una zona tranquila lejos de los paseos principales, y las tres cosas entraron en el diseño final.',
      'El ayuntamiento calcula que el parque recibirá más de un millón de visitas al año. Los autobuses tendrán una parada en la entrada principal desde el lunes, y el carril bici enlaza con la red del centro.',
      'El mantenimiento se repartirá entre el servicio de parques y grupos de voluntarios, que organizarán paseos guiados todos los sábados por la mañana durante la primavera.',
    ],
    mostRead: 'Lo más leído',
    reads: ['Diez rutas de otoño a menos de una hora', 'El mercado central amplía su horario', 'Primer vistazo a la nueva línea de tranvía'],
    featuresH: 'Cuatro cosas, bien hechas',
    featuresP: 'Sin telemetría, sin cuentas, sin anuncios «aceptables». Código abierto con licencia GPLv3.',
    cards: [
      ['🛡️', 'Anuncios y rastreadores', 'Los bloquea con las listas EasyList y EasyPrivacy, y quita los avisos de «desactiva tu bloqueador».'],
      ['🔗', 'Enlaces sin rastreo', 'Quita utm_*, fbclid, gclid y otros parámetros de seguimiento al abrir un enlace. Respeta los de afiliación.'],
      ['🍪', 'Cookies rechazadas', 'Pulsa «rechazar» en los avisos de cookies por ti. Nunca acepta ni oculta un aviso sin responderlo.'],
      ['📖', 'Modo lectura', 'Muestra solo el artículo, en claro, sepia u oscuro, con el tamaño de letra que prefieras. Se abre con ⌥⇧R.'],
    ],
    popupH: 'Todo a un clic',
    popupP: 'Mira cuántas peticiones se han bloqueado, desactiva el bloqueo en un sitio, abre el modo lectura y elige si limpiar los enlaces y rechazar las cookies.',
    readerH: 'Solo el artículo',
    readerPage: 'La página',
    readerView: 'Modo lectura',
  },
} as const;

// ── Página de ejemplo ────────────────────────────────────────────────────────

/** Imagen de portada: un degradado, para no usar fotos de nadie. */
const COVER =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9fb6c8"/><stop offset="1" stop-color="#d6e1e8"/></linearGradient></defs><rect width="1200" height="520" fill="url(#g)"/></svg>',
  );

/** Rastreadores habituales: los bloquea la extensión y dan cifra real al contador del popup. */
const TRACKERS = [
  'https://www.googletagmanager.com/gtag/js?id=G-EXAMPLE',
  'https://www.google-analytics.com/analytics.js',
  'https://connect.facebook.net/en_US/fbevents.js',
  'https://securepubads.g.doubleclick.net/tag/js/gpt.js',
  'https://static.criteo.net/js/ld/publishertag.js',
  'https://sb.scorecardresearch.com/beacon.js',
  'https://cdn.taboola.com/libtrc/exampledaily/loader.js',
  'https://widgets.outbrain.com/outbrain.js',
  'https://static.hotjar.com/c/hotjar-123.js',
];

function articlePage(lang: Lang): string {
  const t = T[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${t.headline} | The Example Daily</title>
<style>
  body { margin: 0; font: 16px/1.55 Georgia, "Times New Roman", serif; color: #1d1d1f; background: #fff; }
  .mast { text-align: center; padding: 14px 0 6px; border-bottom: 2px solid #1d1d1f; }
  .mast b { display: block; font-size: 34px; letter-spacing: .3px; }
  .mast small { font: 11px system-ui, sans-serif; color: #777; }
  nav { display: flex; justify-content: center; gap: 18px; font: 12px system-ui, sans-serif; padding: 8px; border-bottom: 1px solid #e5e5e5; }
  .wrap { display: grid; grid-template-columns: 1fr 230px; gap: 28px; padding: 18px 24px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 6px; }
  .byline { font: 12px system-ui, sans-serif; color: #888; margin: 0 0 12px; }
  img { width: 100%; height: auto; border-radius: 4px; }
  aside h2 { font: 700 12px system-ui, sans-serif; letter-spacing: 1px; text-transform: uppercase; }
  aside li { font-size: 14px; margin: 6px 0; }
</style>
${TRACKERS.map((src) => `<script async src="${src}"></script>`).join('\n')}
<script type="application/ld+json">${JSON.stringify({ '@type': 'NewsArticle', headline: t.headline, author: { '@type': 'Person', name: 'Laura Gómez' } })}</script>
</head><body>
<header class="mast"><b>The Example Daily</b><small>${t.date}</small></header>
<nav>${t.nav.map((n) => `<span>${n}</span>`).join('')}</nav>
<div class="wrap"><article><h1>${t.headline}</h1><p class="byline">${t.byline}</p><img src="${COVER}" alt="">
${t.paras.map((p) => `<p>${p}</p>`).join('\n')}</article>
<aside><h2>${t.mostRead}</h2><ol>${t.reads.map((r) => `<li>${r}</li>`).join('')}</ol></aside></div>
</body></html>`;
}

// ── Capturas de la extensión ─────────────────────────────────────────────────

const png = (buf: Uint8Array) => `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;

async function captures(lang: Lang) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: await mkdtemp(join(tmpdir(), 'largo-store-')),
    // En macOS Chrome toma el idioma de AppleLanguages, no de --lang.
    args: ['--no-first-run', '--no-default-browser-check', `--lang=${T[lang].chromeLang}`, '-AppleLanguages', `(${T[lang].chromeLang})`],
  });
  try {
    const id = await browser.installExtension(DIST);
    const ext = (await browser.extensions()).get(id)!;
    const sw = (await (await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`))).worker())!;
    for (let i = 0; i < 40; i++) {
      const ids = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id));
      if (ids.includes('reader-snapshot')) break;
      await sleep(250);
    }

    const page = await browser.newPage();
    await page.setViewport({ width: 864, height: 840, deviceScaleFactor: 2 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith(SITE)) void req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: articlePage(lang) });
      else void req.respond({ status: 204, body: '' }); // lo que la extensión no bloquee no sale a la red
    });
    await page.goto(`${SITE}/city/new-river-park`, { waitUntil: 'load' });
    await sleep(800);
    const pageShot = png(await page.screenshot());

    // Popup. Se pulsa el icono sobre la página (concede activeTab, como a un usuario), pero la
    // ventana del popup no admite cambiar la resolución: se captura el mismo popup.html en una
    // pestaña a 3×, con chrome.tabs.query apuntando a la pestaña del artículo.
    await page.bringToFront();
    await page.triggerExtensionAction(ext);
    await (await (await browser.waitForTarget((t) => t.url().startsWith(`chrome-extension://${id}/popup.html`))).asPage())!.close();
    const tab = await sw.evaluate(async (site) => (await chrome.tabs.query({ url: `${site}/*` }))[0]!, SITE);
    const popup = await browser.newPage();
    await popup.setViewport({ width: 280, height: 600, deviceScaleFactor: 3 });
    await popup.evaluateOnNewDocument((tab: chrome.tabs.Tab) => {
      chrome.tabs.query = (async () => [tab]) as typeof chrome.tabs.query;
    }, tab);
    await popup.goto(`chrome-extension://${id}/popup.html`, { waitUntil: 'load' });
    await popup.waitForFunction(() => document.getElementById('count')!.textContent !== '—', { timeout: 5000 }).catch(() => {});
    await sleep(400);
    const height = await popup.evaluate(() => document.body.getBoundingClientRect().height);
    const popupShot = png(await popup.screenshot({ clip: { x: 0, y: 0, width: 280, height } }));
    const blocked = await popup.$eval('#count', (el) => el.textContent);
    await popup.close();
    const tabId = tab.id!;

    // Modo lectura en sepia, con el tamaño de letra por defecto.
    await sw.evaluate(() => chrome.storage.local.set({ readerPrefs: { size: 20, theme: 'sepia' } }));
    await page.bringToFront();
    await sw.evaluate((tabId) => chrome.scripting.executeScript({ target: { tabId }, files: ['reader/reader.js'] }), tabId);
    await sleep(800);
    const readerShot = png(await page.screenshot());
    return { pageShot, popupShot, readerShot, blocked };
  } finally {
    await browser.close();
  }
}

// ── Composición (1280×800) ───────────────────────────────────────────────────

const FONTS =
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=block" rel="stylesheet">';
const BASE = `
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 800px; overflow: hidden; font-family: Inter, system-ui, sans-serif; color: ${COLORS.ink}; -webkit-font-smoothing: antialiased; }
  h1 { font-weight: 800; letter-spacing: -1.2px; margin: 0; }
  .icon { width: 72px; height: 72px; border-radius: 16px; background: ${COLORS.mint}; display: grid; place-items: center; }
  .icon img { width: 56px; }
  .window { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(60, 30, 10, .16), 0 2px 8px rgba(60, 30, 10, .06); }
  .window img { display: block; width: 100%; }
  .pill { display: inline-block; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 18px; }
`;

function features(lang: Lang, icon: string): string {
  const t = T[lang];
  return `${FONTS}<style>${BASE}
    body { background: ${COLORS.cream}; padding: 0 90px; display: flex; flex-direction: column; justify-content: center; }
    header { display: flex; align-items: center; gap: 22px; }
    h1 { font-size: 54px; }
    p.sub { font-size: 21px; margin: 18px 0 34px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
    .card { background: #fff; border-radius: 18px; padding: 24px 28px; display: grid; grid-template-columns: 56px 1fr; gap: 6px 20px; box-shadow: 0 10px 30px rgba(60, 30, 10, .07); }
    .card .emoji { font-size: 44px; line-height: 1; grid-row: span 2; }
    .card b { font-size: 24px; font-weight: 700; letter-spacing: -.3px; }
    .card span { font-size: 18px; line-height: 1.45; }
  </style>
  <header><div class="icon"><img src="${icon}"></div><h1>${t.featuresH}</h1></header>
  <p class="sub">${t.featuresP}</p>
  <div class="grid">${t.cards.map(([e, h, p]) => `<div class="card"><div class="emoji">${e}</div><b>${h}</b><span>${p}</span></div>`).join('')}</div>`;
}

function popupImage(lang: Lang, icon: string, shot: string): string {
  const t = T[lang];
  return `${FONTS}<style>${BASE}
    body { background: ${COLORS.mint}; display: grid; grid-template-columns: 1fr 392px; align-items: center; gap: 70px; padding: 0 90px; }
    .icon { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 10px 30px rgba(0, 60, 40, .15); }
    .icon img { width: 80px; }
    h1 { font-size: 58px; margin: 30px 0 18px; }
    p { font-size: 23px; line-height: 1.45; margin: 0; }
  </style>
  <div><div class="icon"><img src="${icon}"></div><h1>${t.popupH}</h1><p>${t.popupP}</p></div>
  <div class="window"><img src="${shot}"></div>`;
}

function readerImage(lang: Lang, pageShot: string, readerShot: string): string {
  const t = T[lang];
  return `${FONTS}<style>${BASE}
    body { background: ${COLORS.cream}; padding: 44px 48px; }
    h1 { font-size: 48px; text-align: center; margin-bottom: 26px; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
    .pill.page { background: ${COLORS.blush}; color: ${COLORS.blushInk}; }
    .pill.reader { background: ${COLORS.mint}; }
    .window { margin-top: 14px; height: 560px; }
  </style>
  <h1>${t.readerH}</h1>
  <div class="cols">
    <div><span class="pill page">${t.readerPage}</span><div class="window"><img src="${pageShot}"></div></div>
    <div><span class="pill reader">${t.readerView} · ⌥⇧R</span><div class="window"><img src="${readerShot}"></div></div>
  </div>`;
}

async function render(browser: Browser, html: string, out: string) {
  const page: Page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out as `${string}.png` });
  await page.close();
}

const icon = png(await readFile(join(ROOT, 'static/icons/128.png')));
const composer = await puppeteer.launch({ executablePath: CHROME, headless: true, pipe: true, userDataDir: await mkdtemp(join(tmpdir(), 'largo-store-')) });
try {
  for (const lang of ['en', 'es'] as const) {
    const shots = await captures(lang);
    const dir = join(ROOT, 'store/images', lang);
    await render(composer, features(lang, icon), join(dir, 'screenshot-3-features.png'));
    await render(composer, popupImage(lang, icon, shots.popupShot), join(dir, 'screenshot-2-popup.png'));
    await render(composer, readerImage(lang, shots.pageShot, shots.readerShot), join(dir, 'screenshot-4-reader.png'));
    console.log(`${lang}: screenshot-2/3/4 listas (${shots.blocked} peticiones bloqueadas en la página de ejemplo)`);
  }
} finally {
  await composer.close();
}
