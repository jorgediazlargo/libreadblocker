// Prueba la extensión en Chrome real (perfil temporal) con páginas con anuncios.
//   pnpm build && pnpm verify [url ...]
// Compara cada página con y sin la extensión, prueba el popup y la lista blanca,
// y valida en Chrome todos los selectores CSS generados.

import puppeteer, { type Browser, type Extension, type Page, type WebWorker } from 'puppeteer-core';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectorsFor, type CosmeticPayload } from '../src/content/cosmetic.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, '.cache/verify');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36';

const SITES = process.argv.slice(2).filter((a) => a.startsWith('http'));
if (!SITES.length) {
  SITES.push(
    'https://www.20minutos.es/',
    'https://www.elmundo.es/',
    'https://www.marca.com/',
    'https://www.lavanguardia.com/',
    'https://www.dailymail.co.uk/',
    'https://edition.cnn.com/',
    'https://www.theverge.com/',
    'https://www.speedtest.net/',
  );
}
const ALLOWLIST_SITE = SITES[0]!;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launch(withExtension: boolean) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'libreadblocker-verify-'));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    enableExtensions: withExtension,
    userDataDir,
    args: ['--no-first-run', '--no-default-browser-check', '--lang=es-ES'],
  });
  return { browser, userDataDir };
}

interface Visit {
  url: string;
  requests: number;
  blocked: string[];
  otherFailures: number;
  title: string;
  textLength: number;
  links: number;
  pageErrors: number;
}

/** Cuenta peticiones de la página hasta que se llama a stop(). */
function track(page: Page) {
  const s = { requests: 0, blocked: [] as string[], otherFailures: 0, pageErrors: 0 };
  const onRequest = () => s.requests++;
  const onFailed = (r: import('puppeteer-core').HTTPRequest) => {
    if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') s.blocked.push(r.url());
    else s.otherFailures++;
  };
  const onError = () => s.pageErrors++;
  page.on('request', onRequest);
  page.on('requestfailed', onFailed);
  page.on('pageerror', onError);
  const stop = () => {
    page.off('request', onRequest);
    page.off('requestfailed', onFailed);
    page.off('pageerror', onError);
    return s;
  };
  return { s, stop };
}

async function settle(page: Page, action: () => Promise<unknown>) {
  try {
    await action();
  } catch {
    // Las webs de noticias rara vez quedan en reposo de red; seguimos tras el timeout.
  }
  await sleep(6000);
}

async function visit(browser: Browser, url: string, label: string): Promise<{ page: Page; visit: Visit }> {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setViewport({ width: 1280, height: 900 });
  const t = track(page);
  await settle(page, () => page.goto(url, { waitUntil: 'load', timeout: 40_000 }));
  const s = t.stop();
  const info = await page
    .evaluate(() => ({
      title: document.title,
      textLength: document.body?.innerText.length ?? 0,
      links: document.querySelectorAll('a[href]').length,
    }))
    .catch(() => ({ title: '(error)', textLength: 0, links: 0 }));
  const host = new URL(url).hostname;
  await page.screenshot({ path: join(OUT, `${host}-${label}.png`) }).catch(() => {});
  return { page, visit: { url, ...s, ...info } };
}

async function extensionWorker(browser: Browser, id: string): Promise<WebWorker> {
  const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().startsWith(`chrome-extension://${id}/`));
  return (await target.worker())!;
}

/** Abre el popup pulsando el icono de la extensión sobre la página (concede activeTab). */
async function openPopup(browser: Browser, ext: Extension, page: Page) {
  await page.bringToFront();
  await page.triggerExtensionAction(ext);
  const target = await browser.waitForTarget((t) => t.url().startsWith(`chrome-extension://${ext.id}/popup.html`), {
    timeout: 10_000,
  });
  const popup = (await target.asPage())!;
  await popup.waitForFunction(() => document.getElementById('count')!.textContent !== '—', { timeout: 5000 }).catch(() => {});
  const state = await popup.evaluate(() => ({
    host: document.getElementById('host')!.textContent,
    enabled: (document.getElementById('toggle') as HTMLInputElement).checked,
    count: document.getElementById('count')!.textContent,
    status: document.getElementById('status')!.textContent,
  }));
  return { popup, state };
}

/** Comprueba que un selector genérico simple oculta un elemento insertado en la página. */
async function genericHidingWorks(page: Page, className: string): Promise<boolean> {
  return page.evaluate((cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = 'libreadblocker-test';
    document.body.appendChild(el);
    const hidden = getComputedStyle(el).display === 'none';
    el.remove();
    return hidden;
  }, className);
}

async function specificHiding(page: Page, payloads: CosmeticPayload[]) {
  // Host final (tras redirecciones), que es el que ve el content script.
  const host = new URL(page.url()).hostname;
  const selectors = [...new Set(payloads.flatMap((p) => selectorsFor(host, p)))];
  return page.evaluate((sels) => {
    let present = 0;
    let hidden = 0;
    for (const s of sels) {
      let els: Element[] = [];
      try {
        els = [...document.querySelectorAll(s)];
      } catch {
        continue;
      }
      present += els.length;
      hidden += els.filter((e) => getComputedStyle(e).display === 'none').length;
    }
    return { selectors: sels.length, present, hidden };
  }, selectors);
}

async function validateSelectors(page: Page, css: string, payloads: CosmeticPayload[]) {
  const chunks = css.trim().split('\n');
  const specific = [...new Set(payloads.flatMap((p) => p.s))];
  return page.evaluate(
    (chunks, specific) => {
      const badChunks: number[] = [];
      chunks.forEach((c, i) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(c);
        if (sheet.cssRules.length !== 1) badChunks.push(i);
      });
      const invalid: string[] = [];
      const test = (s: string) => {
        try {
          document.querySelector(s);
        } catch {
          invalid.push(s);
        }
      };
      for (const i of badChunks) chunks[i]!.replace(/\{display:none!important\}$/, '').split(',').forEach(test);
      specific.forEach(test);
      return { chunks: chunks.length, badChunks: badChunks.length, specific: specific.length, invalid };
    },
    chunks,
    specific,
  );
}

// ---------------------------------------------------------------------------

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
const report: Record<string, unknown> = { chrome: '', sites: [] };

const genericCss = await readFile(join(DIST, 'content/generic.css'), 'utf8');
const genericClass = /(?:^|[,\n])\.([a-zA-Z][\w-]*)(?=[,{])/.exec(genericCss)![1]!;
const genDir = join(ROOT, 'generated/cosmetic');
const payloads: CosmeticPayload[] = await Promise.all(
  (await readdir(genDir))
    .filter((f) => /^(always|b\d+)\.json$/.test(f))
    .map(async (f) => JSON.parse(await readFile(join(genDir, f), 'utf8'))),
);

// 1) Sin extensión (referencia)
console.log('== Referencia sin extensión');
const base = await launch(false);
report.chrome = await base.browser.version();
const baseline = new Map<string, Visit>();
for (const url of SITES) {
  const { page, visit: v } = await visit(base.browser, url, 'sin');
  baseline.set(url, v);
  console.log(`  ${url}: ${v.requests} peticiones, texto ${v.textLength}`);
  await page.close();
}
await base.browser.close();
await rm(base.userDataDir, { recursive: true, force: true });

// 2) Con extensión
console.log('== Con libreadblocker');
const ext = await launch(true);
const extId = await ext.browser.installExtension(DIST);
const sw = await extensionWorker(ext.browser, extId);
const extension = (await ext.browser.extensions()).get(extId)!;
// Espera a que onInstalled registre los content scripts.
for (let i = 0; i < 50; i++) {
  const n = await sw.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length);
  if (n > 0) break;
  await sleep(200);
}
report.extension = await sw.evaluate(async () => ({
  enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
  availableStaticRuleCount: await chrome.declarativeNetRequest.getAvailableStaticRuleCount(),
  registeredContentScripts: (await chrome.scripting.getRegisteredContentScripts()).length,
}));
console.log('  extensión:', JSON.stringify(report.extension));

const sites: unknown[] = [];
let allowlistPage: Page | undefined;
for (const url of SITES) {
  const { page, visit: v } = await visit(ext.browser, url, 'con');
  const ref = baseline.get(url)!;
  const { popup, state } = await openPopup(ext.browser, extension, page);
  await popup.close().catch(() => {});
  const generic = await genericHidingWorks(page, genericClass).catch(() => null);
  const specific = await specificHiding(page, payloads).catch(() => null);
  const row = {
    url,
    requestsWithout: ref.requests,
    requestsWith: v.requests,
    blocked: v.blocked.length,
    blockedHosts: [...new Set(v.blocked.map((u) => new URL(u).hostname))].slice(0, 15),
    popupCount: state.count,
    textWithout: ref.textLength,
    textWith: v.textLength,
    linksWithout: ref.links,
    linksWith: v.links,
    titleWith: v.title,
    pageErrorsWithout: ref.pageErrors,
    pageErrorsWith: v.pageErrors,
    genericHiding: generic,
    specificHiding: specific,
  };
  sites.push(row);
  console.log(
    `  ${url}: ${v.blocked.length} bloqueadas (popup: ${state.count}), peticiones ${ref.requests}→${v.requests}, ` +
      `texto ${ref.textLength}→${v.textLength}, enlaces ${ref.links}→${v.links}, cosmética genérica=${generic}, ` +
      `específica=${JSON.stringify(specific)}`,
  );
  if (url === ALLOWLIST_SITE) allowlistPage = page;
  else await page.close();
}
report.sites = sites;

// 3) Lista blanca desde el popup
console.log(`== Lista blanca en ${ALLOWLIST_SITE}`);
{
  const page = allowlistPage!;
  // Tras pulsar el interruptor el popup recarga la pestaña; después se mide una recarga limpia
  // (las peticiones del documento anterior, aún sin lista blanca, no cuentan).
  const toggleAndMeasure = async () => {
    const { popup } = await openPopup(ext.browser, extension, page);
    const nav = page.waitForNavigation({ waitUntil: 'load', timeout: 40_000 }).catch(() => {});
    await popup.click('label.switch');
    await nav;
    await popup.close().catch(() => {});
    const t = track(page);
    await settle(page, () => page.reload({ waitUntil: 'load', timeout: 40_000 }));
    const s = t.stop();
    const { popup: p2, state } = await openPopup(ext.browser, extension, page);
    await p2.close().catch(() => {});
    return { s, state };
  };

  const { popup: p0, state: before } = await openPopup(ext.browser, extension, page);
  await p0.close().catch(() => {});
  const { s: off, state: duringOff } = await toggleAndMeasure();
  const genericOff = await genericHidingWorks(page, genericClass);
  const stored = await sw.evaluate(async () => (await chrome.storage.sync.get('allowlist')).allowlist);
  const dynamicRules = await sw.evaluate(async () => chrome.declarativeNetRequest.getDynamicRules());
  const { s: on, state } = await toggleAndMeasure();
  const genericOn = await genericHidingWorks(page, genericClass);

  report.allowlist = {
    before,
    afterDisable: { ...duringOff, blocked: off.blocked.length, blockedUrls: off.blocked, requests: off.requests, genericHiding: genericOff, stored, dynamicRules },
    afterEnable: { ...state, blocked: on.blocked.length, requests: on.requests, genericHiding: genericOn },
  };
  console.log(
    `  antes: ${JSON.stringify(before)}\n  desactivado: ${off.blocked.length} bloqueadas de ${off.requests}, cosmética=${genericOff}, guardado=${JSON.stringify(stored)}\n` +
      `  popup desactivado: ${JSON.stringify(duringOff)}\n` +
      `  reactivado: ${on.blocked.length} bloqueadas de ${on.requests}, cosmética=${genericOn}, popup=${JSON.stringify(state)}`,
  );

  // 4) Validación de selectores en el motor CSS de Chrome
  report.selectors = await validateSelectors(page, genericCss, payloads);
  console.log('== Selectores:', JSON.stringify(report.selectors).slice(0, 400));
}

await ext.browser.close();
await rm(ext.userDataDir, { recursive: true, force: true });
await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(`Informe: ${join(OUT, 'report.json')}`);
