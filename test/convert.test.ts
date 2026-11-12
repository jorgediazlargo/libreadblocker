import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCosmeticFilter } from '../src/convert/cosmetic.ts';
import { convertLists, pruneSubdomains, genericCss } from '../src/convert/index.ts';
import { splitSelectorList } from '../scripts/changes.ts';

test('filtros cosméticos genéricos y específicos', () => {
  assert.deepEqual(parseCosmeticFilter('##.ad-banner'), {
    kind: 'hide',
    selector: '.ad-banner',
    domains: [],
    excludedDomains: [],
    filter: '##.ad-banner',
  });
  const r = parseCosmeticFilter('a.com,~b.a.com,deliveroo.*##div[id^="ad-"]');
  assert.equal(r.kind, 'hide');
  if (r.kind === 'hide') {
    assert.deepEqual(r.domains, ['a.com', 'deliveroo.*']);
    assert.deepEqual(r.excludedDomains, ['b.a.com']);
  }
  assert.equal(parseCosmeticFilter('dez.ro#@##ad-carousel').kind, 'unhide');
});

test('filtros cosméticos no soportados', () => {
  const reason = (f: string) => {
    const r = parseCosmeticFilter(f);
    return r.kind === 'skip' ? r.reason : null;
  };
  assert.equal(reason('discord.com#?#.x:has-text(Get Reward)'), 'cosmetic:extended');
  assert.equal(reason('x.com##div:-abp-properties(base64)'), 'selector:pseudo:-abp-properties');
  assert.equal(reason('x.com##div:has-text(Ad)'), 'selector:pseudo:has-text');
  assert.equal(reason('##div{color:red}'), 'selector:braces');
  assert.equal(reason('x.com#$#abort-on-property-read foo'), 'cosmetic:snippet');
  assert.equal(reason('##div::before'), 'selector:pseudo-element');
  assert.equal(parseCosmeticFilter('##a[role="button"]:has(> p.ad)').kind, 'hide');
  assert.equal(reason('x.com##article:has(header:has(.ct-sponsored))'), 'selector:nested-has');
});

test('selectores que ocultarían la página entera', () => {
  const reason = (f: string) => {
    const r = parseCosmeticFilter(f);
    return r.kind === 'skip' ? r.reason : null;
  };
  for (const f of ['##body', '##html', 'bank.com##body', '##:root', 'bank.com##BODY.home', '##:is(body, .ad)', 'x.com##html > body'])
    assert.equal(reason(f), 'selector:page-root', f);
  for (const f of ['##*', 'bank.com##*', '##:not(.x)', 'bank.com##:has(.ad)', 'bank.com##[class]:has(.ad)', 'bank.com##:has(> *)', '##[class]', 'bank.com##html > *', '##div', '##body > div', '##body.home > div', '##div:not(.x)'])
    assert.equal(reason(f), 'selector:too-broad', f);
  // Lo normal sigue pasando: raíz como ancestro, etiquetas sueltas en un sitio concreto, :has() anclado.
  for (const f of ['##body > .ad', '##html.x #ad', 'site.com##center', 'site.com##aside > div', '##div:has(> .sponsored)', '##.ad > *', '##:is(.ad, #banner)', '##a[href^="https://ads."]', '##ad-slot', '##[data-ad-name]', 'x.com##.adblock + *', 'x.com##[class]:has(> [data-mpu])', 'x.com##[class] > :has(> #ad)', 'x.com##[class] > [class] > [class]:has(div[data-ad="1"])'])
    assert.equal(reason(f), null, f);
  // #@# solo deja de ocultar: no se limita.
  assert.equal(parseCosmeticFilter('site.com#@#body').kind, 'unhide');
});

test('pruneSubdomains', () => {
  assert.deepEqual(pruneSubdomains(['a.com', 'x.a.com', 'b.net', 'y.z.b.net', 'c.org']), ['a.com', 'b.net', 'c.org']);
});

test('convertLists agrega dominios, asigna ids y respeta límites', () => {
  const text = [
    '[Adblock Plus 2.0]',
    '! Version: 202611110000',
    '||a.com^',
    '||b.com^',
    '||sub.b.com^',
    '||c.com^$third-party',
    '||d.com^$third-party',
    '/banner/*',
    '/re[a-z]+/',
    '/rb[a-z]+/',
    '@@||good.com/ads.js',
    '@@||jetzt.de^$generichide',
    '##.ad',
    '##.promo',
    'x.com#@#.promo',
    'y.com##.sidebar-ad',
  ].join('\n');

  const out = convertLists([{ id: 'test', text }], { limits: { maxRules: 5, maxRegexRules: 1 } });
  const rules = out.rulesets[0]!.rules;
  assert.deepEqual(
    rules.map((r) => r.id),
    rules.map((_, i) => i + 1),
  );
  const domainRules = rules.filter((r) => r.condition.requestDomains);
  assert.deepEqual(domainRules.map((r) => r.condition.requestDomains).sort(), [
    ['a.com', 'b.com'],
    ['c.com', 'd.com'],
  ]);
  // allow (1) + 2 de dominios + /banner/* + 1 regex = 5; la segunda regex cae por límite.
  assert.equal(rules.length, 5);
  assert.equal(out.report.droppedByLimit, 1);
  assert.deepEqual(out.report.droppedByLimitByCategory, { regex: 1 });
  assert.equal(out.report.lists[0]!.version, '202611110000');

  assert.deepEqual(out.cosmetic.generic, ['.ad']);
  const { s, g, h } = out.cosmetic.specific;
  assert.deepEqual(
    g.map(([i, d]) => [s[i], d]),
    [['.promo', ['x.com']]],
  );
  assert.deepEqual(h['y.com']!.map((i) => s[i]), ['.sidebar-ad']);
  assert.deepEqual(out.cosmetic.generichideDomains, ['jetzt.de']);
});

test('el recorte prioriza reglas de dominio sobre patrones', () => {
  const text = ['/p1', '/p2', '||a.com/x', '||a.com^$script', '||b.com^'].join('\n');
  const out = convertLists([{ id: 't', text }], { limits: { maxRules: 2, maxRegexRules: 10 } });
  const kept = out.rulesets[0]!.rules.map((r) => r.condition);
  assert.deepEqual(kept, [
    { requestDomains: ['a.com'], resourceTypes: ['script'] },
    { requestDomains: ['b.com'] },
  ]);
  assert.deepEqual(out.report.droppedByLimitByCategory, { 'host-anchored': 1, 'url-pattern': 2 });
});

test('rejectRegex descarta las regex que Chrome no acepta', () => {
  const text = ['/ok[0-9]+/', '/big.{100,}/'].join('\n');
  const out = convertLists([{ id: 't', text }], {
    rejectRegex: (re) => (re.includes('{100,}') ? 'memoryLimitExceeded' : null),
  });
  assert.deepEqual(
    out.rulesets[0]!.rules.map((r) => r.condition.regexFilter),
    ['ok[0-9]+'],
  );
  assert.equal(out.report.lists[0]!.skipped['regex:memoryLimitExceeded'], 1);
});

test('genericCss trocea los selectores', () => {
  assert.equal(genericCss(['.a', '.b', '.c'], 2), '.a,.b{display:none!important}\n.c{display:none!important}\n');
});

test('$removeparam se agrupa: una regla por parámetro que quita todos a la vez', () => {
  const text = ['$removeparam=utm_source', '$removeparam=fbclid', '||youtu.be^$removeparam=si', '||x.com/*/status/$removeparam=s', '||x.com/*/status/$removeparam=t'].join('\n');
  const rules = convertLists([{ id: 'links', text }]).rulesets[0]!.rules;
  const redirect = (removeParams: string[]) => ({ type: 'redirect', redirect: { transform: { queryTransform: { removeParams } } } });
  assert.deepEqual(
    rules.map(({ action, condition }) => ({ action, condition })),
    [
      { action: redirect(['fbclid', 'utm_source']), condition: { urlFilter: '^fbclid=', resourceTypes: ['main_frame'] } },
      { action: redirect(['fbclid', 'utm_source']), condition: { urlFilter: '^utm_source=', resourceTypes: ['main_frame'] } },
      { action: redirect(['si']), condition: { urlFilter: '^si=', requestDomains: ['youtu.be'], resourceTypes: ['main_frame'] } },
      { action: redirect(['s', 't']), condition: { urlFilter: '||x.com/*/status/', resourceTypes: ['main_frame'] } },
    ],
  );
});

test('splitSelectorList respeta paréntesis, corchetes y comillas', () => {
  assert.deepEqual(splitSelectorList('.a,.b:is(.c,.d),[x="1,2"],.e\\,f'), ['.a', '.b:is(.c,.d)', '[x="1,2"]', '.e\\,f']);
});

test('una lista con selectores de página entera los descarta y los anota', () => {
  const out = convertLists([{ id: 'x', text: '[Adblock Plus 2.0]\n##body\nbank.com##*\n##.ad\n' }]);
  assert.deepEqual(out.cosmetic.generic, ['.ad']);
  assert.deepEqual(out.report.lists[0]!.tooBroad, ['##body', 'bank.com##*']);
});
