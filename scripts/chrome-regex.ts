// Pregunta a Chrome (declarativeNetRequest.isRegexSupported) qué regex acepta.
// RE2 en Chrome tiene un límite de 2 KB de memoria por regex que no se puede predecir
// bien desde Node: p. ej. [a-z0-9]{20,} pasa y [-a-z_]{4,22} no.

import puppeteer from 'puppeteer-core';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_PATH = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** Devuelve regex → motivo del rechazo (o null si se acepta); null si no hay Chrome. */
export async function checkRegexesInChrome(regexes: string[]): Promise<Map<string, string | null> | null> {
  try {
    await access(CHROME_PATH);
  } catch {
    return null;
  }
  const dir = await mkdtemp(join(tmpdir(), 'largo-regex-'));
  const ext = join(dir, 'ext');
  const profile = join(dir, 'profile');
  await mkdir(ext);
  await writeFile(
    join(ext, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'regex-check',
      version: '1',
      permissions: ['declarativeNetRequest'],
      background: { service_worker: 'sw.js' },
    }),
  );
  await writeFile(join(ext, 'sw.js'), '');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    pipe: true,
    enableExtensions: true,
    userDataDir: profile,
  });
  try {
    const id = await browser.installExtension(ext);
    const target = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().includes(id));
    const sw = (await target.worker())!;
    const results = await sw.evaluate(
      (list) =>
        Promise.all(
          list.map(async (regex) => {
            const r = await chrome.declarativeNetRequest.isRegexSupported({ regex });
            return r.isSupported ? null : (r.reason ?? 'unsupported');
          }),
        ),
      regexes,
    );
    return new Map(regexes.map((re, i) => [re, results[i] ?? null]));
  } finally {
    await browser.close();
    await rm(dir, { recursive: true, force: true });
  }
}
