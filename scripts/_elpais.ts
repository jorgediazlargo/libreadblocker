import puppeteer from 'puppeteer-core';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'largo-ep-'));
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, pipe: true, enableExtensions: true, userDataDir: dir, args: ['--lang=es-ES'] });
await browser.installExtension(join(process.cwd(), 'dist'));
await new Promise((r) => setTimeout(r, 1500));
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36');
await page.setViewport({ width: 1280, height: 900 });
const blocked: string[] = [];
const scripts: string[] = [];
page.on('requestfailed', (r) => { if (r.failure()?.errorText === 'net::ERR_BLOCKED_BY_CLIENT') blocked.push(`${r.resourceType()} ${r.url().slice(0, 120)}`); });
page.on('request', (r) => { if (r.resourceType() === 'script') scripts.push(r.url().slice(0, 120)); });
await page.goto(process.argv[2] ?? 'https://elpais.com/', { waitUntil: 'load', timeout: 45000 }).catch(() => {});
await new Promise((r) => setTimeout(r, 8000));
await page.screenshot({ path: '.cache/elpais.png' });
console.log('BLOCKED', blocked.length); console.log(blocked.join('\n'));
console.log('SCRIPTS', scripts.length); console.log(scripts.filter((s) => !/elpais\.com\/(?:pf|dist)/.test(s)).join('\n'));
console.log(await page.evaluate(() => {
  const hits: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.children.length < 30 && /muestren anuncios/.test((el as HTMLElement).innerText ?? '')) hits.push(`${el.tagName}#${el.id}.${String(el.className).slice(0, 80)}`);
  }
  return { title: document.title, hits: hits.slice(0, 12), htmlClass: document.documentElement.className, bodyClass: document.body.className, bodyStyle: document.body.getAttribute('style'), htmlStyle: document.documentElement.getAttribute('style') };
}));
await browser.close(); await rm(dir, { recursive: true, force: true });
