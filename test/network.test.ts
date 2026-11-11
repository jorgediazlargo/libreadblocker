import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNetworkFilter, type NetworkResult } from '../src/convert/network.ts';

function rule(filter: string) {
  const r = parseNetworkFilter(filter);
  assert.equal(r.kind, 'rule', `esperaba regla para ${filter}: ${JSON.stringify(r)}`);
  return (r as Extract<NetworkResult, { kind: 'rule' }>).rule;
}

function skipped(filter: string): string {
  const r = parseNetworkFilter(filter);
  assert.equal(r.kind, 'skip', `esperaba descarte para ${filter}: ${JSON.stringify(r)}`);
  return (r as Extract<NetworkResult, { kind: 'skip' }>).reason;
}

test('||dominio^ se convierte en requestDomains', () => {
  assert.deepEqual(rule('||ads.example.com^'), {
    priority: 1,
    action: { type: 'block' },
    condition: { requestDomains: ['ads.example.com'] },
  });
});

test('patrón con ruta se queda como urlFilter en minúsculas', () => {
  assert.deepEqual(rule('||Example.com/Ads/*.js').condition, { urlFilter: '||example.com/ads/*.js' });
  assert.deepEqual(rule('/banner/ad_').condition, { urlFilter: '/banner/ad_' });
  assert.deepEqual(rule('|https://x.com/track|').condition, { urlFilter: '|https://x.com/track|' });
});

test('$third-party y $~third-party / $first-party', () => {
  assert.equal(rule('||t.com^$third-party').condition.domainType, 'thirdParty');
  assert.equal(rule('||t.com^$3p').condition.domainType, 'thirdParty');
  assert.equal(rule('||t.com^$~third-party').condition.domainType, 'firstParty');
  assert.equal(rule('||t.com^$first-party').condition.domainType, 'firstParty');
  assert.equal(rule('||t.com^$~first-party').condition.domainType, 'thirdParty');
});

test('$domain= con inclusiones y exclusiones', () => {
  const c = rule('/ads.js$domain=a.com|B.com|~sub.a.com').condition;
  assert.deepEqual(c.initiatorDomains, ['a.com', 'b.com']);
  assert.deepEqual(c.excludedInitiatorDomains, ['sub.a.com']);
  assert.deepEqual(rule('/x$domain=~a.com').condition, { urlFilter: '/x', excludedInitiatorDomains: ['a.com'] });
});

test('$domain= con entidades (example.*)', () => {
  // Inclusión con comodín: se ignora esa entrada y el filtro se estrecha.
  assert.deepEqual(rule('/x$domain=a.com|wayfair.*').condition.initiatorDomains, ['a.com']);
  // Solo comodines: no se puede expresar.
  assert.equal(skipped('/x$domain=wayfair.*'), 'domain:only-wildcards');
  // Exclusión con comodín: bloquearía de más, se descarta.
  assert.equal(skipped('/x$domain=a.com|~wayfair.*'), 'domain:wildcard-exclusion');
});

test('$domain= sin patrón genera regla solo por iniciador', () => {
  assert.deepEqual(rule('$script,third-party,domain=a.com').condition, {
    initiatorDomains: ['a.com'],
    domainType: 'thirdParty',
    resourceTypes: ['script'],
  });
  assert.equal(skipped('$script,third-party'), 'pattern:too-broad');
});

test('excepciones @@ → allow', () => {
  const r = rule('@@||cdn.example.com/ads.js$script,domain=example.com');
  assert.equal(r.action.type, 'allow');
  assert.equal(r.priority, 1);
  assert.deepEqual(r.condition, {
    urlFilter: '||cdn.example.com/ads.js',
    initiatorDomains: ['example.com'],
    resourceTypes: ['script'],
  });
  assert.deepEqual(rule('@@||good.com^').condition, { requestDomains: ['good.com'] });
});

test('@@...$document → allowAllRequests en frames', () => {
  const r = rule('@@||intranet.example.com^$document');
  assert.equal(r.action.type, 'allowAllRequests');
  assert.deepEqual(r.condition, {
    requestDomains: ['intranet.example.com'],
    resourceTypes: ['main_frame', 'sub_frame'],
  });
});

test('@@...$generichide / $elemhide → interruptor cosmético', () => {
  assert.deepEqual(parseNetworkFilter('@@||jetzt.de^$generichide'), {
    kind: 'cosmetic-switch',
    switch: 'generichide',
    domain: 'jetzt.de',
    filter: '@@||jetzt.de^$generichide',
  });
  assert.equal((parseNetworkFilter('@@||a.com^$elemhide') as { switch: string }).switch, 'elemhide');
  assert.equal(skipped('@@://10.0.0.$generichide'), 'cosmetic-switch:not-host');
});

test('tipos de recurso', () => {
  assert.deepEqual(rule('/ad$script,image,css,xhr,subdocument').condition.resourceTypes, [
    'image',
    'script',
    'stylesheet',
    'sub_frame',
    'xmlhttprequest',
  ]);
  assert.deepEqual(rule('/ad$ping,media,font,websocket,other,object').condition.resourceTypes, [
    'font',
    'media',
    'object',
    'other',
    'ping',
    'websocket',
  ]);
  assert.deepEqual(rule('/ad$~script,~image').condition.excludedResourceTypes, ['image', 'script']);
  assert.deepEqual(rule('||evil.com^$document').condition.resourceTypes, ['main_frame']);
});

test('$popup se descarta salvo que haya otros tipos', () => {
  assert.equal(skipped('||pop.com^$popup'), 'type:popup-or-unsupported');
  assert.equal(skipped('||pop.com^$popup,third-party'), 'type:popup-or-unsupported');
  assert.deepEqual(rule('||pop.com^$script,popup').condition.resourceTypes, ['script']);
});

test('opciones no soportadas descartan el filtro', () => {
  assert.equal(skipped('||x.com/a.js$rewrite=abp-resource:blank-js'), 'option:rewrite');
  assert.equal(skipped('||x.com/a.js$important,redirect=noop.js,script'), 'option:redirect');
  assert.equal(skipped("||x.com^$csp=script-src 'self'"), 'option:csp');
  assert.equal(skipped('||x.com^$sitekey=abc'), 'option:sitekey');
  assert.equal(skipped('||x.com^$frobnicate'), 'option:unknown:frobnicate');
});

test('$match-case e $important', () => {
  const c = rule('/AdBanner$match-case').condition;
  assert.equal(c.urlFilter, '/AdBanner');
  assert.equal(c.isUrlFilterCaseSensitive, true);
  assert.equal(rule('||x.com^$important').priority, 2);
});

test('regex compatibles con RE2', () => {
  assert.deepEqual(rule('/^https?:\\/\\/[a-z]+\\.example\\.com\\/ad/$script').condition, {
    regexFilter: '^https?:\\/\\/[a-z]+\\.example\\.com\\/ad',
    resourceTypes: ['script'],
  });
  assert.equal(skipped('/ads(?=foo)/'), 'regex:unsupported');
  assert.equal(skipped('/(a)\\1/'), 'regex:unsupported');
});

test('patrones especiales', () => {
  assert.equal(skipped('foo|bar'), 'pattern:inner-pipe');
  assert.deepEqual(rule('||*.example.com/ad').condition, { urlFilter: '*.example.com/ad' });
  assert.deepEqual(rule('||bücher.de^').condition, { requestDomains: ['xn--bcher-kva.de'] });
  assert.deepEqual(rule('||t.com^$method=post|get').condition.requestMethods, ['post', 'get']);
});
