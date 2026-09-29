/**
 * Boundary oracle: every numeric limit the emit validators enforce is
 * exercised at exactly the limit and one past it. Generative fuzz emits
 * mid-range values; mutants jump far outside — neither probes the exact
 * edge where a hand-mirrored `>` vs `>=` drifts from the schema.
 *
 * Invariant per case:
 *   at-limit  -> schema-valid AND emit-accepted
 *   over      -> emit-rejected (emit is stricter than schema by design, so
 *                the schema verdict on the over case is not pinned)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator } from './corpus.mjs';
import { validateStateRoot, validatePageBlock, validateManifestActions } from '@agent-page/server';

const { validate } = await loadValidator();

const mk = (state) => ({
  app: '1.1',
  page: { id: 'p1', url: 'https://x.test/p', version: 'v1' },
  state,
});
const emitOf = (m) =>
  validatePageBlock(m.page) ?? validateStateRoot(m.state) ?? validateManifestActions(m);

const rep = (s, n) => s.repeat(n);
const basePage = () => ({ id: 'p1', url: 'https://x.test/p', version: 'v1' });
const mk2 = (page) => ({ app: '1.1', page, state: { x: { type: 'string', value: 'x' } } });
const stringNodes = (n) =>
  Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`k${i}`, { type: 'string', value: 'x' }]),
  );

// [label, buildState(limitValue), at, over]
const CASES = [
  [
    'enum options 256/257',
    (n) => ({
      e: { type: 'enum', options: Array.from({ length: n }, (_, i) => `o${i}`), value: 'o0' },
    }),
    256,
    257,
  ],
  [
    'enum option length 128/129',
    (n) => ({ e: { type: 'enum', options: [rep('a', n)], value: rep('a', n) } }),
    128,
    129,
  ],
  [
    // labels keys ⊆ options, so 257 labels forces 257 options — the two
    // caps are inseparable; at-limit exercises both at once
    'enum options + option_labels joint cap 256/257',
    (n) => {
      const opts = Array.from({ length: n }, (_, i) => `o${i}`);
      const labels = Object.fromEntries(opts.map((o) => [o, 'x']));
      return { e: { type: 'enum', options: opts, value: 'o0', option_labels: labels } };
    },
    256,
    257,
  ],
  [
    'enum option_labels value length 200/201',
    (n) => ({
      e: { type: 'enum', options: ['a'], value: 'a', option_labels: { a: rep('x', n) } },
    }),
    200,
    201,
  ],
  [
    'table fields 128/129',
    (n) => ({
      t: {
        type: 'table',
        fields: Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, 'string'])),
        value: [Array.from({ length: n }, () => 'x')],
      },
    }),
    128,
    129,
  ],
  ['state top-level keys 512/513', (n) => stringNodes(n), 512, 513],
  [
    'file name length 255/256',
    (n) => ({
      f: { type: 'file', value: { url: 'https://f.local/x', name: rep('n', n), mime: 't/p' } },
    }),
    255,
    256,
  ],
  [
    'quantity unit length 32/33',
    (n) => ({ q: { type: 'quantity', value: { value: 5, unit: rep('u', n) } } }),
    32,
    33,
  ],
  [
    'geopoint label length 200/201',
    (n) => ({ g: { type: 'geopoint', value: { lat: 1, lng: 2, label: rep('l', n) } } }),
    200,
    201,
  ],
  [
    'number node unit member 32/33',
    (n) => ({ n: { type: 'number', value: 3, unit: rep('u', n) } }),
    32,
    33,
  ],
  [
    'order items 128/129',
    (n) => ({
      o: {
        type: 'order',
        value: {
          id: 'o1',
          status: 'paid',
          currency: 'USD',
          total: 100,
          scale: 2,
          items: Array.from({ length: n }, (_, i) => ({ sku: `s${i}`, qty: 1, amount: 5 })),
        },
      },
    }),
    128,
    129,
  ],
  [
    'array node items 10000/10001',
    (n) => ({ a: { type: 'array', value: Array.from({ length: n }, () => ({ type: 'null' })) } }),
    10000,
    10001,
  ],
];

for (const [label, buildState, at, over] of CASES) {
  test(`boundary: ${label}`, () => {
    const atDoc = mk(buildState(at));
    const overDoc = mk(buildState(over));
    assert.ok(validate(atDoc), `at-limit ${at} rejected by SCHEMA`);
    assert.equal(emitOf(atDoc), null, `at-limit ${at} rejected by EMIT: ${emitOf(atDoc)?.message}`);
    assert.notEqual(emitOf(overDoc), null, `over-limit ${over} accepted by EMIT`);
  });
}

// page-block limits
const PAGE_CASES = [
  ['page.url length 2048/2049', (n) => ({ url: `https://x.test/${rep('u', n - 15)}` }), 2048, 2049],
  ['page.id length 128/129', (n) => ({ id: `p${rep('i', n - 1)}` }), 128, 129],
  ['page.title length 200/201', (n) => ({ title: rep('t', n) }), 200, 201],
  ['page.version length 64/65', (n) => ({ version: rep('v', n) }), 64, 65],
];
for (const [label, buildPage, at, over] of PAGE_CASES) {
  test(`boundary: ${label}`, () => {
    const atPage = { ...basePage(), ...buildPage(at) };
    const overPage = { ...basePage(), ...buildPage(over) };
    const atDoc = mk2(atPage);
    const overDoc = mk2(overPage);
    assert.ok(validate(atDoc), `at-limit ${at} rejected by SCHEMA`);
    assert.equal(emitOf(atDoc), null, `at-limit ${at} rejected by EMIT: ${emitOf(atDoc)?.message}`);
    assert.notEqual(emitOf(overDoc), null, `over-limit ${over} accepted by EMIT`);
  });
}
