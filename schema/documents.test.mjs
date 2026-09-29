// Schema conformance tests — pytest-style, one case per document.
// Positive: every manifest + wire document the repo's code actually emits.
// Negative: mutated/invalid documents that the schema MUST reject, proving
// the schemas have teeth (a permissive schema passes positives silently).
// Run via `npm run test:schema` / `node --test schema/`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadWireCorpus, loadValidator, describeErrors } from './corpus.mjs';

const { ajv, validate } = await loadValidator();
const forSchema = (id) => {
  const v = ajv.getSchema(id);
  assert.ok(v, `schema ${id} registered`);
  return v;
};

// ---------- positive corpus ----------
const docs = await loadCorpus();
for (const [name, doc] of docs) {
  test(`manifest ${name} conforms to schema/page-manifest.json`, () => {
    assert.ok(validate(doc), describeErrors(validate));
  });
}

// Wire docs are [name, schemaId, doc] — real output of live code paths.
const wire = await loadWireCorpus();
for (const [name, schemaId, doc] of wire) {
  test(`${name} conforms to schema/${schemaId}`, () => {
    const v = forSchema(schemaId);
    assert.ok(v(doc), describeErrors(v));
  });
}

// ---------- v1.0 projection (v0.5 §2.5) ----------
// Docs named 'wire/v10 *' were fetched with X-APP-Accept-Versions:'1.0' —
// no 1.1-only key or node type may survive the projection.
const V11_STATE_TYPES = new Set(['geopoint', 'quantity', 'order', 'daterange', 'datetimerange']);
const V11_PARAM_TYPES = new Set([
  'geopoint',
  'file',
  'date_range',
  'datetime_range',
  'quantity',
  'money',
]);
const V11_KEYS = new Set([
  'options_source',
  'bulk',
  'resume_url',
  'consent_purposes',
  'step_up',
  'focus',
  'time_zone',
  'anchors',
  'message_id',
  'retry_class',
  'transfer',
  'accept_mime',
]);

function v10Leaks(doc, nodeTypes, path = '') {
  const leaks = [];
  if (!doc || typeof doc !== 'object') return leaks;
  if (Array.isArray(doc)) {
    doc.forEach((v, i) => leaks.push(...v10Leaks(v, nodeTypes, `${path}/${i}`)));
    return leaks;
  }
  for (const [k, v] of Object.entries(doc)) {
    if (V11_KEYS.has(k)) leaks.push(`${path}/${k}`);
    if (k === 'type' && typeof v === 'string') {
      if (nodeTypes === 'state' && V11_STATE_TYPES.has(v)) leaks.push(`${path}/type=${v}`);
      if (nodeTypes === 'param' && V11_PARAM_TYPES.has(v)) leaks.push(`${path}/type=${v}`);
    }
    leaks.push(...v10Leaks(v, nodeTypes, `${path}/${k}`));
  }
  return leaks;
}

for (const [name, , doc] of wire) {
  if (!name.startsWith('wire/v10 ')) continue;
  test(`${name} is fully projected to 1.0`, () => {
    assert.equal(doc.app, '1.0', 'projected manifest must carry app:"1.0"');
    const stateLeaks = v10Leaks(doc.state, 'state');
    assert.deepEqual(stateLeaks, [], `1.1 state types leaked: ${stateLeaks.join(', ')}`);
    const paramLeaks = v10Leaks(doc.actions, 'param');
    assert.deepEqual(paramLeaks, [], `1.1 param types leaked: ${paramLeaks.join(', ')}`);
    const otherLeaks = v10Leaks(
      { page: doc.page, navigation: doc.navigation, error: doc.error, meta: doc.meta },
      'state',
    );
    assert.deepEqual(otherLeaks, [], `1.1 keys leaked: ${otherLeaks.join(', ')}`);
  });
}

// ---------- negative corpus (schema must reject) ----------
const NEGATIVE = [
  // [schemaId, name, doc]
  ['page-manifest.json', 'empty object', {}],
  [
    'page-manifest.json',
    'page.id with space',
    {
      app: '1.1',
      page: { id: 'bad id', url: 'http://x/', title: 't', version: '1' },
      state: {},
      actions: {},
    },
  ],
  [
    'page-manifest.json',
    'state node missing value',
    {
      app: '1.1',
      page: { id: 'ok', url: 'http://x/', title: 't', version: '1' },
      state: { count: { type: 'number' } },
      actions: {},
    },
  ],
  [
    'page-manifest.json',
    'action kind not in enum',
    {
      app: '1.1',
      page: { id: 'ok', url: 'http://x/', title: 't', version: '1' },
      state: {},
      actions: {
        go: { description: 'x', kind: 'explode' },
      },
    },
  ],
  ['action-request.json', 'missing action', { app: '1.1', params: {} }],
  ['action-request.json', 'unknown version', { app: '9.9', action: 'inc' }],
  ['error-envelope.json', 'missing error.code', { app: '1.1', error: { message: 'x' } }],
  [
    'diff-document.json',
    'unknown op',
    {
      app: '1.1',
      base: { page_id: 'p', page_url: 'http://x/', version: '1' },
      result_version: '2',
      diff: [{ op: 'frobnicate', path: '/state/x' }],
    },
  ],
  ['event.json', 'missing event.id', { app: '1.1', event: { type: 'state.changed' } }],
  [
    'challenge.json',
    'missing kind',
    {
      id: 'c1',
      channel: 'email',
      expires_at: '2030-01-01T00:00:00Z',
      ttl_ms: 60000,
      attempts_remaining: 3,
      max_attempts: 3,
      param: 'otp',
    },
  ],
  [
    'hold.json',
    'agent_solvable true is forbidden',
    {
      id: 'h1',
      kind: 'captcha',
      status: 'pending',
      verify_url: 'http://x/v',
      ttl_ms: 60000,
      who: 'human',
      agent_solvable: true,
      issued_count: 1,
    },
  ],
  ['session.json', 'status not in enum', { status: 'bogus' }],
  ['consent.json', 'missing purposes', { version: 'v1', required: false }],
  ['features.json', 'non-boolean flag', { oauth: 'yes' }],
  ['tool/index.json', 'missing current', { schema: 'agent-page.index/1.0', sessions: [] }],
  [
    'tool/hold-file.json',
    'missing body_sha256',
    { schema: 'agent-page.hold/1.0', kind: 'confirm', action: 'pay' },
  ],
];

for (const [schemaId, name, doc] of NEGATIVE) {
  test(`rejects ${name} (${schemaId})`, () => {
    const v = forSchema(schemaId);
    assert.ok(!v(doc), `expected rejection; errors would be: ${describeErrors(v)}`);
  });
}
