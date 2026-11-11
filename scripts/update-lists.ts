// Descarga EasyList, EasyPrivacy y la Adblock Warning Removal List, añade los arreglos propios (filters/libreadblocker.txt)
// y regenera las reglas en generated/.
//   pnpm update-lists            descarga y convierte
//   pnpm update-lists --offline  reutiliza las listas de .cache/lists

import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { convertLists, genericCss, LIMITS } from '../src/convert/index.ts';
import { planBuckets, isMatchableHost, hostPattern } from '../src/convert/buckets.ts';
import { checkRegexesInChrome } from './chrome-regex.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache/lists');
const OUT = join(ROOT, 'generated');

export const LISTS: { id: string; name: string; url?: string; file?: string }[] = [
  { id: 'easylist', name: 'EasyList', url: 'https://easylist.to/easylist/easylist.txt' },
  { id: 'easyprivacy', name: 'EasyPrivacy', url: 'https://easylist.to/easylist/easyprivacy.txt' },
  {
    id: 'antiadblock',
    name: 'Adblock Warning Removal List',
    url: 'https://easylist-downloads.adblockplus.org/antiadblockfilters.txt',
  },
  { id: 'libreadblocker', name: 'libreadblocker', file: 'filters/libreadblocker.txt' },
];

async function fetchList(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  if (!text.startsWith('[Adblock Plus')) throw new Error(`${url}: no parece una lista de filtros`);
  return text;
}

const offline = process.argv.includes('--offline');
await mkdir(CACHE, { recursive: true });

const inputs = [];
for (const list of LISTS) {
  const file = join(CACHE, `${list.id}.txt`);
  let text: string;
  if (list.file) {
    text = await readFile(join(ROOT, list.file), 'utf8');
  } else if (offline || !list.url) {
    text = await readFile(file, 'utf8');
  } else {
    process.stdout.write(`Descargando ${list.name}… `);
    text = await fetchList(list.url);
    await writeFile(file, text);
    console.log(`${(text.length / 1024).toFixed(0)} KB`);
  }
  inputs.push({ id: list.id, text });
}

// Primera pasada para saber qué regex salen; Chrome decide cuáles caben en su límite de memoria.
const regexes = convertLists(inputs)
  .rulesets.flatMap((rs) => rs.rules.map((r) => r.condition.regexFilter))
  .filter((r): r is string => Boolean(r));
const verdicts = await checkRegexesInChrome(regexes);
if (verdicts) {
  const rejected = [...verdicts.values()].filter(Boolean).length;
  console.log(`Regex comprobadas en Chrome: ${regexes.length - rejected} aceptadas, ${rejected} rechazadas`);
} else {
  console.warn(`AVISO: no se encontró Chrome (CHROME_PATH); las ${regexes.length} regex no se han comprobado.`);
}
const out = convertLists(inputs, { rejectRegex: (re) => verdicts?.get(re) ?? null });

await rm(OUT, { recursive: true, force: true });
await mkdir(join(OUT, 'rules'), { recursive: true });
for (const rs of out.rulesets) {
  await writeFile(join(OUT, 'rules', `${rs.id}.json`), JSON.stringify(rs.rules));
}
await mkdir(join(OUT, 'cosmetic'), { recursive: true });
await writeFile(join(OUT, 'cosmetic', 'generic.css'), genericCss(out.cosmetic.generic));
const plan = planBuckets(out.cosmetic.specific, out.cosmetic.generichideDomains);
await writeFile(join(OUT, 'cosmetic', 'always.json'), JSON.stringify(plan.always));
for (const b of plan.buckets) await writeFile(join(OUT, 'cosmetic', `${b.id}.json`), JSON.stringify(b.payload));
const toPatterns = (domains: string[]) => domains.filter(isMatchableHost).map(hostPattern);
await writeFile(
  join(OUT, 'cosmetic', 'registry.json'),
  JSON.stringify({
    buckets: plan.buckets.map((b) => ({ id: b.id, matches: b.matches })),
    elemhide: toPatterns(out.cosmetic.elemhideDomains),
    generichide: toPatterns(out.cosmetic.generichideDomains),
  }),
);
await writeFile(
  join(OUT, 'meta.json'),
  JSON.stringify(
    { lists: LISTS.filter((l) => l.url).map((l) => ({ ...l, version: out.report.lists[LISTS.indexOf(l)]!.version })) },
    null,
    2,
  ) + '\n',
);
// IDs de reglas de excepción: el popup las descuenta del contador de getMatchedRules.
const allowIds = Object.fromEntries(
  out.rulesets.map((rs) => [rs.id, rs.rules.filter((r) => r.action.type !== 'block').map((r) => r.id)]),
);
await writeFile(join(OUT, 'allow-ids.json'), JSON.stringify(allowIds));
await writeFile(join(OUT, 'report.json'), JSON.stringify(out.report, null, 2) + '\n');

// Resumen
const r = out.report;
console.log(`\nLímites: ${LIMITS.maxRules} reglas estáticas, ${LIMITS.maxRegexRules} regex`);
for (const l of r.lists) {
  const top = Object.entries(l.skipped)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  console.log(
    `${l.id} (${l.version}): red ${l.networkConverted}/${l.networkFilters} filtros → ${l.rules} reglas DNR; ` +
      `cosmética ${l.cosmeticConverted}/${l.cosmeticFilters}; descartados por límite: ${l.droppedByLimit}\n  descartes: ${top}`,
  );
}
console.log(
  `Total: ${r.totalRules} reglas (${r.totalRegexRules} regex); fuera por límites: ${r.droppedByLimit} ${JSON.stringify(r.droppedByLimitByCategory)}`,
);
console.log(
  `Cosmética: ${out.cosmetic.generic.length} selectores genéricos, ${Object.keys(out.cosmetic.specific.h).length} sitios con selectores propios en ${plan.buckets.length} grupos, ${out.cosmetic.specific.g.length} genéricos con excepciones`,
);
