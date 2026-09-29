// Semantic lint: run lintManifest over every corpus manifest — errors are
// spec violations and must be zero; warnings are printed but non-fatal.
// Plus targeted bad manifests asserting each rule actually fires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadWireCorpus, loadValidator, describeErrors, unwrap } from './corpus.mjs';
import { lintManifest } from './lint-manifest.mjs';
import { generateManifest } from './generator.mjs';

const { ajv } = await loadValidator();
const corpus = await loadCorpus();
const wire = await loadWireCorpus();

// Embedded logical values must match their schemas wherever they appear —
// state.consent → consent.json, state.session → session.json,
// state.features → features.json, meta.flow → flow.json.
const LOGICAL_VALUES = [
  ['state.consent', 'consent.json', (d) => d?.state?.consent],
  ['state.session', 'session.json', (d) => d?.state?.session],
  ['state.features', 'features.json', (d) => d?.state?.features],
  ['meta.flow', 'flow.json', (d) => d?.meta?.flow],
];
function checkLogical(doc, name) {
  for (const [label, schemaId, pick] of LOGICAL_VALUES) {
    const node = pick(doc);
    if (!node || typeof node !== 'object') continue;
    const v = ajv.getSchema(schemaId);
    assert.ok(v, `schema ${schemaId} registered`);
    assert.ok(v(unwrap(node)), `${name} ${label} fails ${schemaId}: ${describeErrors(v)}`);
  }
}

for (const [name, doc] of corpus) {
  test(`lint ${name}: no spec-violation errors`, () => {
    const findings = lintManifest(doc, { name });
    const errors = findings.filter((f) => f.level === 'error');
    for (const w of findings.filter((f) => f.level === 'warn')) {
      console.error(`  warn ${name} ${w.path}: ${w.message}`);
    }
    assert.deepEqual(
      errors.map((e) => `${e.rule} ${e.path}: ${e.message}`),
      [],
    );
    checkLogical(doc, name);
  });
}

for (const [name, schemaId, doc] of wire) {
  if (schemaId !== 'page-manifest.json' || !doc?.state) continue;
  test(`lint wire/${name}: no spec-violation errors`, () => {
    const errors = lintManifest(doc, { name }).filter((f) => f.level === 'error');
    assert.deepEqual(
      errors.map((e) => `${e.rule} ${e.path}: ${e.message}`),
      [],
    );
    checkLogical(doc, name);
  });
}

// Generated manifests are spec-conformant by construction — lint must find
// zero errors on every one (a false positive here means the linter is wrong).
{
  const seeds = Number(process.env.GENFUZZ_SEEDS ?? 60);
  for (let seed = 0; seed < seeds; seed++) {
    const doc = generateManifest(seed);
    test(`lint gen ${seed}: no spec-violation errors`, () => {
      const errors = lintManifest(doc, { name: `gen-${seed}` }).filter((f) => f.level === 'error');
      assert.deepEqual(
        errors.map((e) => `${e.rule} ${e.path}: ${e.message}`),
        [],
      );
      checkLogical(doc, `gen-${seed}`);
    });
  }
}

// ---- negative: every rule must fire on a crafted violation ---------------

const base = {
  app: '1.1',
  page: { id: 'p', url: 'https://x.test/p', version: 'v1' },
  state: {},
  actions: {},
};

const BAD = [
  [
    'state_path_unresolved',
    {
      ...base,
      state: { real: { type: 'string', value: 'x' } },
      present: { sections: [{ id: 's1', layout: 'detail', state_path: 'ghost' }] },
    },
  ],
  [
    'primary_action_unknown',
    {
      ...base,
      present: { sections: [{ id: 'f1', layout: 'form', primary_action: 'nope' }] },
    },
  ],
  [
    'recoverable_action_unknown',
    {
      ...base,
      error: { code: 'app.err.x', message: 'm', recoverable_actions: ['missing'] },
    },
  ],
  [
    'enum_value_not_in_options',
    {
      ...base,
      state: { e: { type: 'enum', value: 'red', options: ['blue'] } },
    },
  ],
  ['secret_non_string', { ...base, state: { n: { type: 'number', value: 1, secret: true } } }],
  [
    'table_row_width',
    {
      ...base,
      state: {
        t: { type: 'table', fields: ['a', 'b'], rows: [['only-one']] },
      },
    },
  ],
  [
    'secret_param_undeclared',
    {
      ...base,
      actions: {
        pay: { kind: 'mutate', description: 'x', input: {}, policy: { secret_params: ['cvv'] } },
      },
    },
  ],
  [
    'options_source_target_invalid',
    {
      ...base,
      actions: {
        pick: {
          kind: 'mutate',
          description: 'x',
          input: {
            q: { type: 'string', options_source: { action: 'del', param: 'q', results_path: 'r' } },
          },
        },
        del: { kind: 'mutate', description: 'x', input: { q: { type: 'string' } } },
      },
    },
  ],
  [
    'output_navigate_and_delegate',
    {
      ...base,
      actions: {
        go: {
          kind: 'navigate',
          description: 'x',
          output: { navigates_to: 'https://x.test/a', delegates_to: 'https://x.test/b' },
        },
      },
    },
  ],
  ['page_url_insecure', { ...base, page: { id: 'p', url: 'http://example.com/p', version: 'v1' } }],
];

for (const [rule, doc] of BAD) {
  test(`lint rule ${rule} fires`, () => {
    const hits = lintManifest(doc).filter((f) => f.rule === rule);
    assert.ok(hits.length > 0, `expected rule ${rule} to fire`);
  });
}
