// pnpm build → dist/ listo para "Cargar descomprimida" en chrome://extensions.

import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

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
console.log(`dist/ listo: ${(size / 1024 / 1024).toFixed(2)} MB (${payloads.length} content scripts, ${rulesets.length} rulesets)`);
