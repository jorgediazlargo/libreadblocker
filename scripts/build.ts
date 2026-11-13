// pnpm build → dist/ listo para "Cargar descomprimida" en chrome://extensions.

import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const GEN = join(ROOT, 'generated');

const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));

try {
  await stat(join(GEN, 'rules'));
} catch {
  console.error('Faltan las reglas generadas: ejecuta `pnpm update-lists` primero.');
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(join(DIST, 'content'), { recursive: true });

const common = {
  bundle: true,
  minify: true,
  target: 'chrome121',
  legalComments: 'none' as const,
  logLevel: 'warning' as const,
};

await build({ ...common, entryPoints: [join(ROOT, 'src/background.ts')], outfile: join(DIST, 'background.js'), format: 'esm' });
await build({ ...common, entryPoints: [join(ROOT, 'src/popup/popup.ts')], outfile: join(DIST, 'popup.js'), format: 'iife' });

// Un content script por grupo de selectores, cada uno con sus datos incrustados.
const cosmeticDir = join(GEN, 'cosmetic');
const payloads = (await readdir(cosmeticDir)).filter((f) => /^(always|b\d+)\.json$/.test(f));
await Promise.all(
  payloads.map(async (file) => {
    const json = await readFile(join(cosmeticDir, file), 'utf8');
    await build({
      ...common,
      stdin: {
        // JSON.parse sobre una cadena se analiza más rápido que un literal de objeto.
        contents: `import { run } from './src/content/cosmetic.ts';\nrun(JSON.parse(${JSON.stringify(json)}));`,
        resolveDir: ROOT,
        loader: 'ts',
      },
      outfile: join(DIST, 'content', file.replace(/\.json$/, '.js')),
      format: 'iife',
    });
  }),
);

// Rechazo de cookies: Autoconsent con sus reglas compactas incrustadas. El script de la
// página lleva todas; el de los iframes, solo el tramo de reglas que se ejecutan en frames
// (unas decenas), para no cargar ~450 KB de reglas en cada iframe.
type Indexed = import('@duckduckgo/autoconsent').IndexedCMPRuleset;
const consentRules: Indexed = JSON.parse(
  await readFile(fileURLToPath(import.meta.resolve('@duckduckgo/autoconsent/rules/compact-rules.json')), 'utf8'),
);
const [frameStart, frameEnd] = consentRules.index.frameRuleRange;
const frameRuleList = consentRules.r.slice(frameStart, frameEnd);
// Las reglas guardan índices a la tabla de cadenas. Se vacían las que ningún número de estas
// reglas puede señalar (de más, nunca de menos): la tabla pasa de ~94 KB a ~12 KB.
const frameNumbers = new Set<number>();
const collectNumbers = (v: unknown): void => {
  if (typeof v === 'number') frameNumbers.add(v);
  else if (v && typeof v === 'object') Object.values(v).forEach(collectNumbers);
};
for (const rule of frameRuleList) rule.slice(5).forEach(collectNumbers);
const frameRules: Indexed = {
  v: consentRules.v,
  s: consentRules.s.slice(0, consentRules.index.frameStringEnd).map((str, i) => (frameNumbers.has(i) ? str : '')),
  r: frameRuleList,
  index: { ...consentRules.index, genericRuleRange: [0, 0], specificRuleRange: [0, 0], frameRuleRange: [0, frameEnd - frameStart], genericStringEnd: 0 },
};
// El recorte depende del formato interno del índice: si una versión nueva lo cambia, que falle
// aquí. Se compara con el filtrado oficial en una URL cualquiera y en las de las reglas por sitio.
{
  const { filterCompactRules } = await import('@duckduckgo/autoconsent');
  const sampleUrl = (pattern: string) =>
    pattern.split('|')[0]!.replace(/^\^/, '').replace('https?', 'https').replace('(www\\.)?', '').replace(/\\\./g, '.');
  const urls = frameRules.r.map((r) => sampleUrl(r[3])).filter((u, i) => u && new RegExp(frameRules.r[i]![3]).test(u));
  for (const url of ['https://example.com/', ...urls]) {
    const ctx = { url, mainFrame: false };
    if (JSON.stringify(filterCompactRules(frameRules, ctx)) !== JSON.stringify(filterCompactRules(consentRules, ctx))) {
      console.error(`Las reglas de cookies para iframes no coinciden con las completas (${url}): revisa el recorte en build.ts.`);
      process.exit(1);
    }
  }
  if (urls.length < frameRules.r.length / 2) {
    console.error('No se han podido comprobar las reglas de cookies para iframes: revisa sampleUrl en build.ts.');
    process.exit(1);
  }
}
await Promise.all(
  [
    { file: 'consent.js', rules: consentRules, mainFrame: true },
    { file: 'consent-frame.js', rules: frameRules, mainFrame: false },
  ].map(({ file, rules, mainFrame }) =>
    build({
      ...common,
      stdin: {
        contents: `import { run } from './src/content/consent.ts';\nrun(JSON.parse(${JSON.stringify(JSON.stringify(rules))}), ${mainFrame});`,
        resolveDir: ROOT,
        loader: 'ts',
      },
      outfile: join(DIST, 'content', file),
      format: 'iife',
    }),
  ),
);

await cp(join(cosmeticDir, 'generic.css'), join(DIST, 'content/generic.css'));
await cp(join(cosmeticDir, 'registry.json'), join(DIST, 'content/registry.json'));

// Reglas DNR
await cp(join(GEN, 'rules'), join(DIST, 'rules'), { recursive: true });
const rulesets: string[] = [];
for (const f of (await readdir(join(GEN, 'rules'))).filter((f) => f.endsWith('.json')).sort()) {
  // Una lista sin reglas de red (p. ej. solo cosmética) no necesita ruleset.
  if ((await readFile(join(GEN, 'rules', f), 'utf8')).trim() === '[]') await rm(join(DIST, 'rules', f));
  else rulesets.push(f);
}

// Manifest
const manifest = JSON.parse(await readFile(join(ROOT, 'static/manifest.json'), 'utf8'));
manifest.version = pkg.version;
manifest.declarative_net_request.rule_resources = rulesets.map((f) => ({
  id: f.replace(/\.json$/, ''),
  enabled: true,
  path: `rules/${f}`,
}));
await writeFile(join(DIST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

// Estáticos y licencias
await cp(join(ROOT, 'static/popup.html'), join(DIST, 'popup.html'));
await cp(join(ROOT, 'static/popup.css'), join(DIST, 'popup.css'));
await cp(join(ROOT, 'static/icons'), join(DIST, 'icons'), { recursive: true });
await cp(join(ROOT, 'static/_locales'), join(DIST, '_locales'), { recursive: true });
await cp(join(ROOT, 'LICENSE'), join(DIST, 'LICENSE'));
await cp(join(ROOT, 'ATTRIBUTION.md'), join(DIST, 'ATTRIBUTION.md'));

// Tamaño
async function du(dir: string): Promise<number> {
  let total = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    total += e.isDirectory() ? await du(p) : (await stat(p)).size;
  }
  return total;
}
const size = await du(DIST);
console.log(`dist/ listo: ${(size / 1024 / 1024).toFixed(2)} MB (${payloads.length + 2} content scripts, ${rulesets.length} rulesets)`);
