// Invariantes de seguridad sobre lo que se publica: se comprueban en cada `pnpm test`
// contra generated/ y static/, así que un cambio en el conversor, en las listas o en el
// manifest que amplíe lo que la extensión puede hacer rompe los tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCosmeticFilter } from '../src/convert/cosmetic.ts';
import type { CosmeticPayload } from '../src/content/cosmetic.ts';
import { selectorsFor } from '../src/content/cosmetic.ts';
import { splitSelectorList } from '../scripts/changes.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const json = async (path: string) => JSON.parse(await readFile(join(ROOT, path), 'utf8'));

test('el manifest no pide más de lo necesario', async () => {
  const m = await json('static/manifest.json');
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'declarativeNetRequest', 'scripting', 'storage']);
  assert.deepEqual(m.host_permissions, ['<all_urls>']);
  for (const key of ['web_accessible_resources', 'externally_connectable', 'optional_permissions', 'content_scripts', 'sandbox'])
    assert.equal(m[key], undefined, key);
  const csp: string = m.content_security_policy.extension_pages;
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe|https?:|\*|data:|blob:/);
});

test('las reglas de red solo bloquean, permiten o quitan parámetros', async () => {
  // Las listas descargadas (las de meta.json) no pueden reescribir tráfico de ninguna forma.
  // Las propias (filters/*.txt) pueden además quitar parámetros de la URL por nombre exacto;
  // nunca redirigir a otra URL, tocar cabeceras ni cambiar de esquema.
  const remote = new Set<string>((await json('generated/meta.json')).lists.map((l: { id: string }) => l.id));
  const dir = join(ROOT, 'generated/rules');
  for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
    const id = f.replace(/\.json$/, '');
    for (const rule of JSON.parse(await readFile(join(dir, f), 'utf8'))) {
      const where = `${f}#${rule.id}`;
      if (rule.action.type === 'redirect') {
        assert.ok(!remote.has(id), `${where}: redirect en una lista descargada`);
        assert.deepEqual(Object.keys(rule.action), ['type', 'redirect'], where);
        assert.deepEqual(Object.keys(rule.action.redirect), ['transform'], where);
        assert.deepEqual(Object.keys(rule.action.redirect.transform), ['queryTransform'], where);
        assert.deepEqual(Object.keys(rule.action.redirect.transform.queryTransform), ['removeParams'], where);
        for (const p of rule.action.redirect.transform.queryTransform.removeParams) assert.match(p, /^[A-Za-z0-9_.\-[\]]+$/, where);
      } else {
        assert.deepEqual(Object.keys(rule.action), ['type'], where);
        assert.ok(['block', 'allow', 'allowAllRequests'].includes(rule.action.type), where);
      }
    }
  }
});

test('los selectores publicados pasan la validación y no inyectan CSS', async () => {
  const check = (selector: string, generic: boolean, where: string) => {
    assert.doesNotMatch(selector, /[{}\r\n]/, where);
    const r = parseCosmeticFilter(`${generic ? '' : 'example.com'}##${selector}`);
    assert.equal(r.kind, 'hide', `${where}: ${JSON.stringify(selector)}`);
  };
  const dir = join(ROOT, 'generated/cosmetic');
  const css = await readFile(join(dir, 'generic.css'), 'utf8');
  for (const line of css.split('\n').filter(Boolean)) {
    const end = line.lastIndexOf('{');
    assert.equal(line.slice(end), '{display:none!important}', 'generic.css');
    for (const s of splitSelectorList(line.slice(0, end))) check(s, true, 'generic.css');
  }
  for (const f of (await readdir(dir)).filter((f) => /^(always|b\d+)\.json$/.test(f))) {
    const d: CosmeticPayload = JSON.parse(await readFile(join(dir, f), 'utf8'));
    const genericIds = new Set((d.g ?? []).map(([i]) => i));
    d.s.forEach((s, i) => check(s, genericIds.has(i), f));
  }
});

test('el content script no lee de la cadena de prototipos', () => {
  const d: CosmeticPayload = { s: ['.ad'], h: { 'a.com': [0] }, x: {} };
  for (const host of ['constructor', 'foo.constructor', '__proto__', 'tostring']) assert.deepEqual(selectorsFor(host, d), []);
  assert.deepEqual(selectorsFor('www.a.com', d), ['.ad']);
});

/** Código propio que se instala (el conversor de src/convert solo corre al generar las reglas). */
async function shippedSources(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const dir of ['src', 'src/content', 'src/popup', 'src/shared']) {
    for (const f of (await readdir(join(ROOT, dir))).filter((f) => f.endsWith('.ts'))) {
      out.set(`${dir}/${f}`, (await readFile(join(ROOT, dir, f), 'utf8')).replace(/\/\/.*$/gm, ''));
    }
  }
  return out;
}

test('el código de la extensión no habla con nadie ni ejecuta texto', async () => {
  for (const [f, code] of await shippedSources()) {
    assert.doesNotMatch(code, /https?:\/\//, `${f}: URL remota`);
    assert.doesNotMatch(code, /\beval\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\.write|XMLHttpRequest|WebSocket|importScripts/, f);
  }
});

test('la configuración solo se cambia desde las páginas de la extensión', async () => {
  const sources = await shippedSources();
  const bg = sources.get('src/background.ts')!;
  // storage.sync cerrado a los content scripts.
  assert.match(bg, /storage\.sync\.setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
  // Cada mensaje que cambia configuración exige el origen de la extensión (lo fija el navegador).
  assert.match(bg, /fromExtensionPage = sender\.origin === EXTENSION_ORIGIN/);
  const handlers = [...bg.matchAll(/if \(msg\?\.type === '(set-[a-z-]+)'([^)]*)\)/g)];
  assert.ok(handlers.length > 0);
  for (const [, type, rest] of handlers) assert.match(rest!, /&& fromExtensionPage/, `mensaje ${type}`);
  // Los content scripts no tocan la configuración.
  for (const [f, code] of sources) if (f.startsWith('src/content/')) assert.doesNotMatch(code, /chrome\.storage/, f);
});

test('los avisos de cookies sin botón de rechazo no se ocultan', async () => {
  const consent = (await shippedSources()).get('src/content/consent.ts');
  if (!consent) return;
  assert.match(consent, /autoAction: 'optOut'/);
  assert.match(consent, /enableCosmeticRules: false/);
  assert.doesNotMatch(consent, /optIn/);
});
