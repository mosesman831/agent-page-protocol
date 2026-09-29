/**
 * Diff-apply equivalence between the two protocol implementations:
 * packages/client (strict, TS) and extension/protocol/diff.js (lenient,
 * JS). For every diff document — generated pairs, and targeted malformed
 * diffs — both implementations must AGREE on the verdict, and when both
 * accept they must produce the same manifest. A disagreement is either a
 * bug in one impl or an undocumented divergence (compare §7.6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateManifest } from './generator.mjs';
import { clone } from './mutations.mjs';
import { buildDiffDocument } from '@agent-page/server';
import {
  applyDiffDocument as applyStrict,
  isAllowedDiffPath as strictPath,
  normalizeAppUrl as normalizeStrict,
  isDiffDocument as strictIsDiff,
} from '@agent-page/client';
import {
  applyDiffDocument as applyLenient,
  normalizeAppUrl as normalizeLenient,
} from '../extension/protocol/diff.js';
import {
  isAllowedDiffPath as lenientPath,
  validateDiffDocument as lenientDiffDoc,
} from '../extension/protocol/validate.js';

const PAIRS = Number(process.env.GENFUZZ_SEEDS ?? 80);

// Generated manifests carry absolute https URLs and matching identities, so
// url normalization and page_id/url base checks hold identically.
const pair = (seed) => {
  const base = generateManifest(seed);
  const next = generateManifest(100000 + seed);
  next.page.id = base.page.id;
  next.page.url = base.page.url;
  next.app = base.app;
  next.page.version = `v${seed + 1000}`;
  return { base, next };
};

test('generated diff pairs: strict and lenient impls agree', async (t) => {
  for (let seed = 0; seed < PAIRS; seed++) {
    const { base, next } = pair(seed);
    const diffDoc = buildDiffDocument(base, next);
    const tag = `seeds ${seed}→${100000 + seed}`;
    await t.test(tag, () => {
      const s = applyStrict(clone(base), clone(diffDoc));
      const l = applyLenient(clone(base), clone(diffDoc));
      assert.equal(l.ok, s.ok, `verdict diverged (${tag}): strict=${s.code} lenient=${l.code}`);
      if (s.ok && l.ok) {
        assert.deepEqual(l.manifest, s.manifest, `applied result diverged (${tag})`);
      }
      if (!s.ok && !l.ok) {
        assert.equal(l.code, s.code, `rejection code diverged (${tag})`);
      }
    });
  }
});

// Malformed diffs must be rejected by BOTH implementations — a lenient
// renderer must not apply a patch the strict client refuses.
const malformed = (base, diffDoc) => [
  ['base page_id mismatch', { ...clone(diffDoc), base: { ...diffDoc.base, page_id: 'other' } }],
  [
    'base page_url mismatch',
    { ...clone(diffDoc), base: { ...diffDoc.base, page_url: 'https://evil.test/x' } },
  ],
  ['base version mismatch', { ...clone(diffDoc), base: { ...diffDoc.base, version: 'bogus' } }],
  [
    'forbidden /page/id target',
    { ...clone(diffDoc), diff: [{ op: 'replace', path: '/page/id', value: 'x' }] },
  ],
  [
    'forbidden /page/url target',
    { ...clone(diffDoc), diff: [{ op: 'replace', path: '/page/url', value: 'x' }] },
  ],
  [
    'proto traversal',
    { ...clone(diffDoc), diff: [{ op: 'replace', path: '/state/x/__proto__/y', value: 1 }] },
  ],
  ['unsupported op', { ...clone(diffDoc), diff: [{ op: 'hack', path: '/state/x', value: 1 }] }],
  [
    'move into own subtree',
    { ...clone(diffDoc), diff: [{ op: 'move', from: '/state', path: '/state/x/deeper' }] },
  ],
  [
    'add outside allowed roots',
    { ...clone(diffDoc), diff: [{ op: 'add', path: '/zzz_evil', value: 1 }] },
  ],
  [
    'remove missing path',
    { ...clone(diffDoc), diff: [{ op: 'remove', path: '/state/no_such_key_zzz' }] },
  ],
];

test('malformed diffs: strict and lenient impls agree on rejection', async (t) => {
  for (let seed = 0; seed < 10; seed++) {
    const { base, next } = pair(seed);
    const diffDoc = buildDiffDocument(base, next);
    for (const [label, bad] of malformed(base, diffDoc)) {
      await t.test(`seed ${seed} ${label}`, () => {
        const s = applyStrict(clone(base), clone(bad));
        const l = applyLenient(clone(base), clone(bad));
        assert.equal(s.ok, false, `strict client accepted malformed diff (${label})`);
        assert.equal(l.ok, false, `lenient impl accepted malformed diff (${label})`);
        assert.equal(
          l.code,
          s.code,
          `rejection code diverged (${label}): strict=${s.code} lenient=${l.code}`,
        );
      });
    }
  }
});

// Wire-captured diffs are not replayable here: apply needs the true
// pre-diff manifest (ops target concrete paths), which the corpus does not
// store. diff.test.mjs already replays the real captured pair through the
// strict impl and asserts schema-valid output.

// Path-policy equivalence: isAllowedDiffPath must agree in both impls on
// every path — including boundary-prefixed roots (/stateX), forbidden
// members, page fields, and table cell paths (TV-35).
test('diff path policy equivalence', () => {
  const fixed = [
    '/state',
    '/state/x',
    '/stateX',
    '/states',
    '/state_evil',
    '/state//x',
    '/actions',
    '/actions/x',
    '/actionsX',
    '/navigation',
    '/navigate',
    '/present',
    '/presentation',
    '/error',
    '/errors',
    '/meta',
    '/metadata',
    '/page/title',
    '/page/title/x',
    '/page/titleX',
    '/page/generated_at',
    '/page/generated_at/x',
    '/page/language',
    '/page/description',
    '/app',
    '/app/x',
    '/appX',
    '/page/id',
    '/page/id/x',
    '/page/url',
    '/page/url/x',
    '/page/version',
    '/page/version/x',
    '/page/etag',
    '/page/etag/x',
    '/zzz',
    '/page',
    '/page/other',
    'state/no-slash',
    '',
    '/',
  ];
  // plus one generated path per real manifest member, and hostile pointers
  const manifest = generateManifest(0);
  const tableKey = Object.keys(manifest.state).find((k) => manifest.state[k].type === 'table');
  if (tableKey) {
    fixed.push(`/state/${tableKey}/value/0/0`); // table cell — forbidden
    fixed.push(`/state/${tableKey}/value`); // whole table node — allowed
  }
  for (const key of Object.keys(manifest.state).slice(0, 12)) {
    fixed.push(`/state/${key}`, `/state/${key}/value`);
  }
  for (const path of fixed) {
    assert.equal(
      lenientPath(path, manifest),
      strictPath(path, manifest),
      `path policy diverged: ${path}`,
    );
  }
});

// URL normalization equivalence: the extension's mirrored normalizeAppUrl
// must produce identical output to the client's on every input.
test('URL normalization equivalence', () => {
  const urls = [
    'https://EXAMPLE.com/a/../b?x=1#frag',
    'https://example.com:443/x',
    'http://example.com:80/x',
    'https://example.com:8443/x',
    'https://example.com/%7euser',
    'https://example.com/%2Fpath',
    'https://example.com/a/./b/../c',
    'https://example.com/path?',
    'https://example.com/?',
    'https://example.com/a%2fb',
    'https://example.com/a%2Fb',
    'https://example.com',
    'https://example.com/',
    'https://example.com//a//b',
    'https://EXAMPLE.com',
    'https://example.com/x?a=%41&b=c',
    'https://example.com/x#',
    'HTTP://EXAMPLE.COM/X',
    'https://xn--tst-qla.example/x',
    'https://example.com/%20',
    'not a url',
    'https://example.com/a/./',
    'https://example.com/a/../',
    'https://example.com/%2e%2e/x',
    'https://example.com?q=%%GG',
    'https://example.com/a;b/c;d',
  ];
  for (const url of urls) {
    let s, l;
    try {
      s = normalizeStrict(url);
    } catch {
      s = '__throw__';
    }
    try {
      l = normalizeLenient(url);
    } catch {
      l = '__throw__';
    }
    assert.equal(l, s, `normalizeAppUrl diverged on ${url}: strict=${s} lenient=${l}`);
  }
});

// Envelope-level mutants: strict isDiffDocument (a type guard — op contents
// are checked later by validateDiffOps) and lenient validateDiffDocument
// must agree on the envelope shape.
test('diff envelope structural equivalence', () => {
  const { base, next } = pair(0);
  const good = buildDiffDocument(base, next);
  const mutants = [
    ['drop base', (d) => delete d.base],
    ['base not object', (d) => (d.base = 'x')],
    ['drop base.page_id', (d) => delete d.base.page_id],
    ['drop base.page_url', (d) => delete d.base.page_url],
    ['drop base.version', (d) => delete d.base.version],
    ['drop result_version', (d) => delete d.result_version],
    ['result_version wrong type', (d) => (d.result_version = 7)],
    ['diff not array', (d) => (d.diff = {})],
    ['drop diff', (d) => delete d.diff],
    ['app wrong', (d) => (d.app = '9.9')],
    ['app missing', (d) => delete d.app],
    ['not object', () => null],
  ];
  for (const [label, fn] of mutants) {
    const d = clone(good);
    const r = fn(d);
    const body = r === undefined ? d : r;
    const strict = strictIsDiff(body);
    const lenient = lenientDiffDoc(body);
    assert.equal(
      lenient.ok,
      strict,
      `diff-envelope check diverged (${label}): strict=${strict} lenient=${lenient.code ?? lenient.ok}`,
    );
  }
});

// Op-level mutants: the strict impl's shape guard accepts them (ops are
// validated at apply), so equivalence is asserted at the APPLY layer —
// both applyDiffDocument impls must reject.
test('diff op-level mutants: both impls reject at apply', () => {
  const { base, next } = pair(0);
  const good = buildDiffDocument(base, next);
  const mutants = [
    ['op missing', (d) => void d.diff.push({ path: '/state/x' })],
    ['op path missing', (d) => void d.diff.push({ op: 'replace', value: 1 })],
    ['from missing on move', (d) => void d.diff.push({ op: 'move', path: '/state/x' })],
  ];
  for (const [label, fn] of mutants) {
    const d = clone(good);
    fn(d);
    const s = applyStrict(clone(base), d);
    const l = applyLenient(clone(base), clone(d));
    assert.equal(s.ok, false, `strict apply accepted (${label})`);
    assert.equal(l.ok, false, `lenient apply accepted (${label})`);
  }
});

// Op-mutation fuzz: mutate every field of every op in generated diffs and
// compare apply verdicts. Both impls must agree on accept vs reject —
// when both accept, results must be identical; when both reject, the code
// family must match (app.err.diff.*).
test('diff op field mutations: verdict parity', async (t) => {
  const FIELD_MUTS = [
    ['op=null', (o) => (o.op = null)],
    ['op=number', (o) => (o.op = 42)],
    ['op=unsupported', (o) => (o.op = 'frobnicate')],
    ['drop op', (o) => delete o.op],
    ['path=null', (o) => (o.path = null)],
    ['path=number', (o) => (o.path = 5)],
    ['path=no-slash', (o) => (o.path = 'state/x')],
    ['drop path', (o) => delete o.path],
    ['path=/app', (o) => (o.path = '/app')],
    ['path=/stateX', (o) => (o.path = '/stateX')],
    ['proto path', (o) => (o.path = '/state/x/__proto__/polluted')],
    ['from=null on move', (o) => o.op === 'move' && (o.from = null)],
    ['from=forbidden on copy', (o) => o.op === 'copy' && (o.from = '/page/id')],
    ['value=undefined drop', (o) => o.op === 'replace' && delete o.value],
    ['extra member', (o) => (o.zzz_extra = 1)],
  ];
  for (let seed = 0; seed < 20; seed++) {
    const { base, next } = pair(seed);
    const good = buildDiffDocument(base, next);
    for (const [label, fn] of FIELD_MUTS) {
      for (let i = 0; i < good.diff.length; i++) {
        const d = clone(good);
        const r = fn(d.diff[i]);
        if (r === false) continue; // field n/a for this op kind
        const tag = `seed ${seed} op ${i} ${label}`;
        await t.test(tag, () => {
          let s, l;
          try {
            s = applyStrict(clone(base), clone(d));
          } catch {
            s = { ok: false, code: '__threw__' };
          }
          try {
            l = applyLenient(clone(base), clone(d));
          } catch {
            l = { ok: false, code: '__threw__' };
          }
          assert.equal(l.ok, s.ok, `verdict diverged (${tag}): strict=${s.code} lenient=${l.code}`);
          if (s.ok && l.ok) {
            assert.deepEqual(l.manifest, s.manifest, `applied result diverged (${tag})`);
          }
        });
      }
    }
  }
});

// Post-apply validity (§7.3): diffs whose *result* is a corrupt manifest
// must be rejected by BOTH impls — strict re-validates state nodes
// (checkStateNodes), lenient re-runs validateManifest post-apply.
test('diff producing corrupt state: both impls reject', async (t) => {
  const { base, next } = pair(0);
  const good = buildDiffDocument(base, next);
  const stateKeys = Object.keys(base.state ?? {});
  assert.ok(stateKeys.length > 0);
  const k = stateKeys[0];
  const mk = (diff) => ({ ...clone(good), diff });
  const CASES = [
    ['node type -> bogus', () => mk([{ op: 'replace', path: `/state/${k}/type`, value: 'bogus' }])],
    ['node type removed', () => mk([{ op: 'remove', path: `/state/${k}/type` }])],
    [
      'forbidden member added',
      () => mk([{ op: 'add', path: `/state/${k}/constructor`, value: {} }]),
    ],
    [
      'value replaced with wrong shape',
      () => mk([{ op: 'replace', path: `/state/${k}/value`, value: { x: 1 } }]),
    ],
    [
      'action kind -> bogus',
      () => {
        const aid = Object.keys(base.actions ?? {})[0];
        return aid ? mk([{ op: 'replace', path: `/actions/${aid}/kind`, value: 'bogus' }]) : null;
      },
    ],
    ['actions -> array', () => mk([{ op: 'replace', path: '/actions', value: [1] }])],
  ];
  for (const [label, mkDoc] of CASES) {
    await t.test(label, () => {
      const d = mkDoc();
      if (d == null) return;
      const s = applyStrict(clone(base), clone(d));
      const l = applyLenient(clone(base), clone(d));
      assert.equal(s.ok, false, `strict accepted corrupt apply (${label})`);
      assert.equal(l.ok, false, `lenient accepted corrupt apply (${label})`);
      assert.match(s.code ?? '', /^app\.err\./);
      assert.match(l.code ?? '', /^app\.err\./);
    });
  }
});

// applyOp edge parity: the extension hand-rolls pointer apply while the
// client uses fast-json-patch — same ops on a conformant base must give
// the same verdict AND the same resulting state.
test('applyOp edge semantics parity', async (t) => {
  const base = {
    app: '1.1',
    page: {
      id: 'p',
      url: 'https://ex.com/p',
      title: 't',
      version: 'v1',
      generated_at: 'g',
      language: 'en',
    },
    state: {
      obj: {
        type: 'object',
        label: 'o',
        value: { a: { type: 'string', value: 'x' }, 10: { type: 'string', value: 'ten' } },
      },
      arr: {
        type: 'array',
        label: 'r',
        value: [
          { type: 'string', value: 'i0' },
          { type: 'string', value: 'i1' },
        ],
      },
    },
    actions: {},
    navigation: {},
  };
  const mk = (diff) => ({
    app: '1.1',
    base: { page_id: 'p', page_url: 'https://ex.com/p', version: 'v1' },
    result_version: 'v2',
    diff,
  });
  const CASES = [
    ['numeric obj key', [{ op: 'replace', path: '/state/obj/value/10/value', value: '99' }]],
    [
      'add array idx',
      [{ op: 'add', path: '/state/arr/value/1', value: { type: 'string', value: 'NEW' } }],
    ],
    [
      'add array -',
      [{ op: 'add', path: '/state/arr/value/-', value: { type: 'string', value: 'END' } }],
    ],
    ['remove array idx', [{ op: 'remove', path: '/state/arr/value/0' }]],
    [
      'add idx=len',
      [{ op: 'add', path: '/state/arr/value/2', value: { type: 'string', value: 'x' } }],
    ],
    [
      'obj child new key',
      [{ op: 'add', path: '/state/obj/value/newkey', value: { type: 'string', value: 'n' } }],
    ],
    ['copy obj child', [{ op: 'copy', from: '/state/obj/value/a', path: '/state/obj/value/b' }]],
    [
      'state key new',
      [{ op: 'add', path: '/state/newnode', value: { type: 'string', value: 'v' } }],
    ],
    [
      'state key bad',
      [{ op: 'add', path: '/state/BAD KEY', value: { type: 'string', value: 'v' } }],
    ],
  ];
  for (const [label, ops] of CASES) {
    await t.test(label, () => {
      const s = applyStrict(clone(base), mk(clone(ops)));
      const l = applyLenient(clone(base), mk(clone(ops)));
      assert.equal(s.ok, l.ok, `verdict diverged (${label}): ${s.code} vs ${l.code}`);
      if (s.ok && l.ok) {
        assert.deepEqual(s.manifest.state, l.manifest.state, `applied state diverged (${label})`);
      }
    });
  }
});

test('designed divergence: strict post-apply is stricter than lenient', async () => {
  // §5.3: strict clients enforce closed member sets; the extension is the
  // lenient reference impl and tolerates forward-compat extras. Diff ops
  // adding an extra node member or an unknown root member therefore
  // diverge BY DESIGN: strict rejects, lenient accepts.
  const base = {
    app: '1.1',
    page: {
      id: 'p',
      url: 'https://ex.com/p',
      title: 't',
      version: 'v1',
      generated_at: 'g',
      language: 'en',
    },
    state: { s: { type: 'string', label: 'S', value: 'a' } },
    actions: {},
    navigation: {},
  };
  const mk = (diff) => ({
    app: '1.1',
    base: { page_id: 'p', page_url: 'https://ex.com/p', version: 'v1' },
    result_version: 'v2',
    diff,
  });
  const CASES = [
    ['extra node member', [{ op: 'add', path: '/state/s/extra_member', value: 1 }]],
    [
      'extra pagination member',
      [{ op: 'add', path: '/state/s/pagination', value: { cursor: null, has_more: false, x: 1 } }],
    ],
  ];
  for (const [label, ops] of CASES) {
    const s = applyStrict(clone(base), mk(ops));
    const l = applyLenient(clone(base), mk(ops));
    assert.equal(s.ok, false, `strict must reject (${label})`);
    assert.equal(l.ok, true, `lenient must accept (${label})`);
  }
});
