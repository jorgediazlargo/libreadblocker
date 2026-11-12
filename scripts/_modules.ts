// Prueba puntual de los módulos Links y Cookies en Chrome real (como _elpais.ts).
//   pnpm build && node scripts/_modules.ts [links|cookies] [url ...]
import puppeteer, { type Browser } from 'puppeteer-core';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = '.cache/modules';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const args = process.argv.slice(2);
const only = args.find((a) => a === 'links' || a === 'cookies');
const urls = args.filter((a) => a.startsWith('http'));

async function launch(withExtension: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'largo-mod-'));
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    pipe: true,
    enableExtensions: withExtension,
    userDataDir: dir,
    args: ['--no-first-run', '--lang=es-ES'],
  });
  let sw;
  if (withExtension) {
    const id = await browser.installExtension(join(process.cwd(), 'dist'));
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`));
    sw = (await target.worker())!;
    for (let i = 0; i < 50; i++) {
      if ((await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)) > 0) break;
      await sleep(200);
    }
  }
  return { browser, sw, close: async () => { await browser.close(); await rm(dir, { recursive: true, force: true }); } };
}

async function finalUrl(browser: Browser, url: string) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  const hops: string[] = [];
  page.on('request', (r) => { if (r.isNavigationRequest() && r.frame() === page.mainFrame()) hops.push(r.url()); });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((e) => console.log('   error', String(e).slice(0, 80)));
  const out = { final: page.url(), hops: hops.length };
  await page.close();
  return out;
}

await mkdir(OUT, { recursive: true });
const ext = await launch(true);
console.log('rulesets', await ext.sw!.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()));
console.log('scripts', await ext.sw!.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).filter((s) => s.id.startsWith('consent')).map((s) => `${s.id}:${s.allFrames}`)));

if (only !== 'cookies') {
  const cases = [
    'https://example.com/?utm_source=news&id=7&fbclid=abc&utm_medium=email',
    'https://example.com/?id=7',
    'https://example.com/?id=7&UTM_SOURCE=x',
    'https://example.com/path/utm_source=x',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw&si=abcdef',
    'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    'https://httpbin.org/get?gclid=1&q=hola&_hsenc=2&mc_eid=3#frag',
  ];
  console.log('== Links activado');
  for (const u of cases) console.log(' ', u, '→', JSON.stringify(await finalUrl(ext.browser, u)));
  await ext.sw!.evaluate(() => chrome.storage.sync.set({ modules: { links: false, cookies: true } }));
  await sleep(1500);
  console.log('== Links desactivado', await ext.sw!.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets()));
  console.log(' ', cases[0], '→', JSON.stringify(await finalUrl(ext.browser, cases[0]!)));
  await ext.sw!.evaluate(() => chrome.storage.sync.set({ modules: { links: true, cookies: true } }));
  await sleep(1500);
}

if (only !== 'links') {
  const sites = urls.length ? urls : [
    'https://edition.cnn.com/',
    'https://www.20minutos.es/',
    'https://www.marca.com/',
    'https://www.theguardian.com/international',
    'https://www.cookiebot.com/',
    'https://www.elmundo.es/',
    'https://elpais.com/',
    'https://www.lavanguardia.com/',
    'https://www.rtve.es/',
    'https://www.bbc.com/',
  ];
  // Texto visible que delata un aviso de cookies todavía en pantalla.
  const probe = () => {
    const hits: string[] = [];
    const vis = (el: Element) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 150 && r.height > 40 && s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0; };
    for (const el of document.querySelectorAll('div,section,aside,dialog,iframe')) {
      const id = `${el.tagName.toLowerCase()}#${el.id}.${String(el.className).slice(0, 40)}`;
      if (!/cookie|consent|didomi|onetrust|cmp|sp_message|qc-|gdpr|privacy|Cybot/i.test(id)) continue;
      const pos = getComputedStyle(el).position;
      if (vis(el) && (pos === 'fixed' || pos === 'sticky' || el.tagName === 'IFRAME' || el.tagName === 'DIALOG')) hits.push(id);
    }
    return { banners: hits.slice(0, 6), scrollLocked: getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden', cookies: document.cookie.split('; ').map((c) => c.split('=')[0]).filter((n) => /consent|optanon|didomi|euconsent|cmp|cookie/i.test(n!)).slice(0, 8) };
  };
  const base = await launch(false);
  for (const url of sites) {
    const host = new URL(url).hostname;
    const row: Record<string, unknown> = {};
    for (const [label, browser] of [['sin', base.browser], ['con', ext.browser]] as const) {
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'load', timeout: 45_000 }).catch(() => {});
      await sleep(9000);
      row[label] = await page.evaluate(probe).catch((e) => String(e).slice(0, 60));
      await page.screenshot({ path: join(OUT, `${host}-${label}.png`) }).catch(() => {});
      await page.close();
    }
    console.log(url, '\n  sin:', JSON.stringify(row.sin), '\n  con:', JSON.stringify(row.con));
  }
  await base.close();
}
await ext.close();
