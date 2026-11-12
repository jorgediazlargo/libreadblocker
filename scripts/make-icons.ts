// Genera los iconos PNG de la extensión a partir de static/icon.svg, rasterizando con Chrome sin interfaz.
//   node scripts/make-icons.ts
import { readFile, writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { CHROME_PATH } from './chrome-regex.ts';

const svg = await readFile(new URL('../static/icon.svg', import.meta.url), 'utf8');
const browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });
try {
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    const png = await page.screenshot({ type: 'png', omitBackground: true });
    await writeFile(new URL(`../static/icons/${size}.png`, import.meta.url), png);
  }
} finally {
  await browser.close();
}
console.log('iconos generados');
