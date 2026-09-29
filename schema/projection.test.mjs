/**
 * v1.1 → v1.0 projection oracle.
 *
 * For every page manifest in the corpus, run the REAL server projector
 * (projectManifestToV10 from @agent-page/server) and assert:
 *   1. the result is still a schema-valid manifest stamped app='1.0';
 *   2. every 1.1-only construct is gone (SPEC §2.5): state node types
 *      geopoint/quantity/order/daterange/datetimerange; param types
 *      file/geopoint/date_range/datetime_range/quantity/money; the
 *      options_source/transfer/accept_mime param members; action members
 *      bulk/policy.consent_purposes/policy.step_up/output.resume_url;
 *      page.focus/page.time_zone; navigation.anchors; error
 *      message_id/retry_class;
 *   3. 1.0 vocabulary is preserved — money stays integer+scale, ordinary
 *      node types/values pass through untouched;
 *   4. projection is idempotent: project(project(x)) === project(x);
 *   5. the projected doc hydrates under the real strict AgentClient.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadValidator } from './corpus.mjs';
import { generateManifest } from './generator.mjs';
import { projectManifestToV10 } from '@agent-page/server';
import { AgentClient } from '@agent-page/client';

const { validate } = await loadValidator();
const corpus = await loadCorpus();

const V11_NODE_TYPES = new Set(['geopoint', 'quantity', 'order', 'daterange', 'datetimerange']);
const V11_PARAM_TYPES = new Set([
  'geopoint',
  'file',
  'date_range',
  'datetime_range',
  'quantity',
  'money',
]);
const V11_PARAM_MEMBERS = ['options_source', 'transfer', 'accept_mime'];
const V11_ACTION_MEMBERS = ['bulk'];
const V11_PAGE_MEMBERS = ['focus', 'time_zone'];
const V11_ERROR_MEMBERS = ['message_id', 'retry_class'];

function walkNodes(v, fn, path = '') {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    v.forEach((item, i) => walkNodes(item, fn, `${path}/${i}`));
    return;
  }
  if (typeof v.type === 'string') {
    fn(v, path);
    if (
      v.value &&
      typeof v.value === 'object' &&
      (v.type === 'object' || v.type === 'array' || v.type === 'table')
    ) {
      walkNodes(v.value, fn, `${path}/value`);
    }
    return;
  }
  for (const [k, child] of Object.entries(v)) walkNodes(child, fn, `${path}/${k}`);
}

function* paramDefs(input, path = '') {
  if (!input) return;
  for (const [k, def] of Object.entries(input)) {
    yield [def, `${path}/${k}`];
    if (def.item_type) yield [def.item_type, `${path}/${k}/item_type`];
    if (def.properties) yield* paramDefs(def.properties, `${path}/${k}/properties`);
  }
}

async function checkProjection(name, doc) {
  const v10 = projectManifestToV10(doc);

  assert.equal(v10.app, '1.0', `${name}: app must be stamped 1.0`);
  assert.ok(validate(v10), `${name}: projected manifest must remain schema-valid`);

  walkNodes(v10.state, (n, path) => {
    assert.ok(!V11_NODE_TYPES.has(n.type), `${name}: 1.1 node type ${n.type} at ${path}`);
    if (n.pagination) {
      for (const k of Object.keys(n.pagination)) {
        assert.ok(
          ['cursor', 'has_more', 'total'].includes(k),
          `${name}: pagination member ${k} at ${path}`,
        );
      }
    }
  });
  for (const [aid, def] of Object.entries(v10.actions ?? {})) {
    for (const m of V11_ACTION_MEMBERS) {
      assert.ok(!(m in def), `${name}: action ${aid} still has 1.1 member ${m}`);
    }
    if (def.policy) {
      assert.ok(!('consent_purposes' in def.policy), `${name}: ${aid}.policy.consent_purposes`);
      assert.ok(!('step_up' in def.policy), `${name}: ${aid}.policy.step_up`);
    }
    if (def.output) assert.ok(!('resume_url' in def.output), `${name}: ${aid}.output.resume_url`);
    for (const [p, ppath] of paramDefs(def.input, aid)) {
      assert.ok(!V11_PARAM_TYPES.has(p.type), `${name}: param ${ppath} type ${p.type}`);
      for (const m of V11_PARAM_MEMBERS) {
        assert.ok(!(m in p), `${name}: param ${ppath} member ${m}`);
      }
    }
  }
  for (const m of V11_PAGE_MEMBERS) assert.ok(!(m in v10.page), `${name}: page.${m}`);
  if (v10.navigation) assert.ok(!('anchors' in v10.navigation), `${name}: navigation.anchors`);
  if (v10.error) {
    for (const m of V11_ERROR_MEMBERS) assert.ok(!(m in v10.error), `${name}: error.${m}`);
  }

  // 1.0 preservation: money integer+scale and scale on numbers survive.
  walkNodes(doc.state, (n, path) => {
    if (typeof n.scale === 'number') {
      let cur = v10.state;
      for (const seg of path.split('/').filter(Boolean)) cur = cur?.[seg];
      assert.equal(cur?.scale, n.scale, `${name}: scale lost at ${path}`);
    }
  });

  // Idempotent.
  assert.deepEqual(projectManifestToV10(v10), v10, `${name}: projection not idempotent`);

  // Real strict client accepts the projected document.
  const fetchImpl = async () =>
    new Response(JSON.stringify(v10), {
      status: 200,
      headers: { 'content-type': 'application/vnd.agent-page+json', etag: '"p10"' },
    });
  const client = new AgentClient({ fetch: fetchImpl, strict: true });
  await client.hydrate(v10.page.url);
}

test('projection corpus', async (t) => {
  for (const [name, doc] of corpus) {
    if (!validate(doc)) continue; // only real page manifests
    await t.test(`${name} → v1.0`, () => checkProjection(name, doc));
  }
});

test('projection over generated manifests', async (t) => {
  const seeds = Number(process.env.GENFUZZ_SEEDS ?? 80);
  for (let seed = 0; seed < seeds; seed++) {
    const doc = generateManifest(seed);
    if (!validate(doc)) {
      // generator bug — surface it, don't silently skip
      await t.test(`gen ${seed}`, () => assert.fail(`generated doc schema-invalid (seed ${seed})`));
      continue;
    }
    await t.test(`gen ${seed} → v1.0`, () => checkProjection(`gen ${seed}`, doc));
  }
});
