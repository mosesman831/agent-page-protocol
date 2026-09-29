/**
 * State-node semantic oracle.
 *
 * Corpus mutations only cover node types that appear in real manifests; this
 * suite builds synthetic manifests for every node type and asserts the emit
 * validator and the schema agree on every case — including semantics the
 * schema cannot express (e.g. an inverted date range), where emit may be
 * legitimately stricter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator } from './corpus.mjs';
import { validateStateRoot } from '@agent-page/server';

const { ajv } = await loadValidator();
const validate = ajv.getSchema('page-manifest.json');

const mk = (state) => ({
  app: '1.1',
  page: { id: 't', url: 'http://x/t', version: 'v1' },
  state,
});
const check = (state) => {
  const doc = mk(state);
  return { schema: validate(doc), emit: validateStateRoot(state) === null };
};

const CASES = [
  // [label, state, expectedSchema, expectedEmit]
  ['string ok', { s: { type: 'string', value: 'hi' } }, true, true],
  ['string value number', { s: { type: 'string', value: 7 } }, false, false],
  ['string secret bool', { s: { type: 'string', value: 'x', secret: true } }, true, true],
  ['number ok', { n: { type: 'number', value: 3.5 } }, true, true],
  ['number scale+integer', { n: { type: 'number', value: 5, scale: 2 } }, true, true],
  ['enum ok', { e: { type: 'enum', value: 'a', options: ['a', 'b'] } }, true, true],
  ['enum dup options', { e: { type: 'enum', value: 'a', options: ['a', 'a'] } }, false, false],
  ['enum empty options', { e: { type: 'enum', value: 'a', options: [] } }, false, false],
  [
    'enum option_labels stray key',
    { e: { type: 'enum', value: 'a', options: ['a'], option_labels: { stray: 'x' } } },
    true, // schema cannot express key-subset-of-options
    false, // emit rejects dead label keys
  ],
  ['boolean ok', { b: { type: 'boolean', value: true } }, true, true],
  ['null ok', { z: { type: 'null' } }, true, true],
  ['date ok', { d: { type: 'date', value: '2026-02-28' } }, true, true],
  ['date impossible', { d: { type: 'date', value: '2026-02-30' } }, true, false],
  ['datetime ok', { d: { type: 'datetime', value: '2026-01-01T00:00:00Z' } }, true, true],
  ['datetime impossible', { d: { type: 'datetime', value: '2026-01-01T25:00:00Z' } }, false, false],
  ['array ok', { a: { type: 'array', value: [{ type: 'string', value: 'x' }] } }, true, true],
  [
    'array nested bad node',
    { a: { type: 'array', value: [{ type: 'bogus', value: 'x' }] } },
    false,
    false,
  ],
  [
    'object ok',
    { o: { type: 'object', value: { k: { type: 'string', value: 'v' } } } },
    true,
    true,
  ],
  [
    'object nested bad',
    { o: { type: 'object', value: { k: { type: 'string', value: 7 } } } },
    false,
    false,
  ],
  [
    'file ok',
    { f: { type: 'file', value: { url: 'http://x/f', name: 'f.pdf', mime: 'application/pdf' } } },
    true,
    true,
  ],
  ['file no url', { f: { type: 'file', value: { name: 'f.pdf' } } }, false, false],
  [
    'table ok',
    {
      t: {
        type: 'table',
        fields: { a: 'string', b: 'number' },
        value: [
          ['x', 1],
          ['y', 2],
        ],
      },
    },
    true,
    true,
  ],
  ['table fields empty', { t: { type: 'table', fields: {}, value: [] } }, false, false],
  [
    'table field type bogus',
    { t: { type: 'table', fields: { a: 'exploded' }, value: [] } },
    false,
    false,
  ],
  [
    'table field key bad',
    { t: { type: 'table', fields: { BadKey: 'string' }, value: [] } },
    false,
    false,
  ],
  [
    'table row wider than fields',
    { t: { type: 'table', fields: { a: 'string' }, value: [['x', 'extra']] } },
    true, // schema can't tie row length to field count
    false,
  ],
  ['geopoint ok', { g: { type: 'geopoint', value: { lat: 51.5, lng: -0.1 } } }, true, true],
  ['geopoint lat>90', { g: { type: 'geopoint', value: { lat: 91, lng: 0 } } }, false, false],
  [
    'geopoint accuracy<0',
    { g: { type: 'geopoint', value: { lat: 0, lng: 0, accuracy_m: -1 } } },
    false,
    false,
  ],
  ['quantity ok', { q: { type: 'quantity', value: { value: 5, unit: 'kg' } } }, true, true],
  [
    'quantity unit pattern',
    { q: { type: 'quantity', value: { value: 5, unit: 'kg!' } } },
    false,
    false,
  ],
  [
    'quantity scale+noninteger',
    { q: { type: 'quantity', scale: 2, value: { value: 5.5, unit: 'kg' } } },
    true, // cross-field invariant; schema can't express it
    false,
  ],
  [
    'daterange ok',
    { r: { type: 'daterange', value: { from: '2026-01-01', to: '2026-01-10' } } },
    true,
    true,
  ],
  [
    'daterange inverted',
    { r: { type: 'daterange', value: { from: '2026-01-10', to: '2026-01-01' } } },
    true, // schema can't express cross-field order
    false, // emit rejects semantically-broken ranges
  ],
  [
    'daterange bad date',
    { r: { type: 'daterange', value: { from: 'bogus', to: '2026-01-01' } } },
    false,
    false,
  ],
  [
    'datetimerange ok',
    {
      r: {
        type: 'datetimerange',
        value: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
      },
    },
    true,
    true,
  ],
  [
    'datetimerange inverted',
    {
      r: {
        type: 'datetimerange',
        value: { from: '2026-01-01T02:00:00Z', to: '2026-01-01T01:00:00Z' },
      },
    },
    true,
    false,
  ],
  [
    'order ok',
    {
      o: {
        type: 'order',
        value: {
          id: 'o1',
          status: 'pending',
          currency: 'GBP',
          total: 100,
          scale: 2,
          items: [],
          created_at: '2026-01-01T00:00:00Z',
        },
      },
    },
    true,
    true,
  ],
  [
    'order status bogus',
    {
      o: {
        type: 'order',
        value: {
          id: 'o1',
          status: 'exploded',
          currency: 'GBP',
          total: 100,
          items: [],
          created_at: '2026-01-01T00:00:00Z',
        },
      },
    },
    false,
    false,
  ],
  /* ---------- SPEC-WEB-NODES: embed ---------- */
  [
    'embed ok',
    { e: { type: 'embed', url: 'https://x.example/m', description: 'pickup map' } },
    true,
    true,
  ],
  [
    'embed http url',
    { e: { type: 'embed', url: 'http://x.example/m', description: 'd' } },
    false,
    false,
  ],
  ['embed missing description', { e: { type: 'embed', url: 'https://x.example/m' } }, false, false],
  ['embed missing url', { e: { type: 'embed', description: 'd' } }, false, false],
  [
    'embed extra member',
    { e: { type: 'embed', url: 'https://x.example/m', description: 'd', bogus: 1 } },
    false,
    false,
  ],
  [
    'embed sandbox+height ok',
    {
      e: {
        type: 'embed',
        url: 'https://x.example/m',
        description: 'd',
        sandbox: ['scripts'],
        height: 320,
      },
    },
    true,
    true,
  ],
  [
    'embed sandbox bad flag',
    {
      e: { type: 'embed', url: 'https://x.example/m', description: 'd', sandbox: ['evil'] },
    },
    false,
    false,
  ],
  [
    'embed height out of range',
    { e: { type: 'embed', url: 'https://x.example/m', description: 'd', height: 4000 } },
    false,
    false,
  ],
  /* ---------- SPEC-WEB-NODES: markdown ---------- */
  ['markdown ok', { m: { type: 'markdown', value: '# T\nbody' } }, true, true],
  ['markdown missing value', { m: { type: 'markdown' } }, false, false],
  ['markdown value non-string', { m: { type: 'markdown', value: 7 } }, false, false],
  ['markdown extra member', { m: { type: 'markdown', value: 'x', secret: true } }, false, false],
  /* ---------- SPEC-WEB-NODES: media ---------- */
  [
    'media ok',
    {
      m: {
        type: 'media',
        value: [{ url: 'https://x.example/a.jpg', alt: 'Front', kind: 'image' }],
      },
    },
    true,
    true,
  ],
  ['media item missing url', { m: { type: 'media', value: [{ alt: 'x' }] } }, false, false],
  [
    'media item http url',
    { m: { type: 'media', value: [{ url: 'http://x.example/a.jpg' }] } },
    false,
    false,
  ],
  [
    'media item bad kind',
    { m: { type: 'media', value: [{ url: 'https://x.example/a', kind: 'gif' }] } },
    false,
    false,
  ],
  [
    'media video+audio kinds ok',
    {
      m: {
        type: 'media',
        value: [
          { url: 'https://x.example/v.mp4', kind: 'video' },
          { url: 'https://x.example/a.mp3', kind: 'audio' },
        ],
      },
    },
    true,
    true,
  ],
  ['media value not array', { m: { type: 'media', value: 'x' } }, false, false],
  /* ---------- SPEC-WEB-NODES: tree ---------- */
  [
    'tree ok nested',
    {
      t: {
        type: 'tree',
        value: [{ id: 'root', label: 'Root', children: [{ id: 'a', label: 'A' }] }],
      },
    },
    true,
    true,
  ],
  ['tree item missing id', { t: { type: 'tree', value: [{ label: 'A' }] } }, false, false],
  ['tree item missing label', { t: { type: 'tree', value: [{ id: 'a' }] } }, false, false],
  [
    'tree id bad pattern',
    { t: { type: 'tree', value: [{ id: 'Bad ID', label: 'A' }] } },
    false,
    false,
  ],
  [
    'tree extra member',
    { t: { type: 'tree', value: [{ id: 'a', label: 'A' }], bogus: 1 } },
    false,
    false,
  ],
  [
    'tree depth 17',
    {
      t: {
        type: 'tree',
        value: [
          Array.from({ length: 17 }).reduce(
            (child, _x, i) => ({
              id: `n${i}`,
              label: `N${i}`,
              ...(child ? { children: [child] } : {}),
            }),
            null,
          ),
        ],
      },
    },
    true, // schema recursion cannot bound depth
    false, // emit enforces depth ≤ 16
  ],
];

test('node semantics: schema and emit agree (or emit is intentionally stricter)', async (t) => {
  const divergences = [];
  for (const [label, state, wantSchema, wantEmit] of CASES) {
    await t.test(label, () => {
      const { schema, emit } = check(state);
      assert.equal(schema, wantSchema, `schema ${label}`);
      assert.equal(emit, wantEmit, `emit ${label}`);
      if (wantSchema && !wantEmit) divergences.push(`${label}: schema-valid, emit rejects`);
    });
  }
  if (divergences.length) console.error('emit-stricter divergences:', divergences);
});
