// Fuzz parity: mutate every corpus manifest and check the JSON Schema and the
// strict reference client agree inside the client's strict contract
// (SPEC §5.7 receipt surface): envelope shape, root members, state-node
// types/members, page.id grammar, page.url match.
//   schema-valid   -> strict hydrate MUST accept   (schema never overreaches)
//   schema-invalid -> strict hydrate MUST reject    (tier A mutations)
// Tier B mutations sit below the strict contract (value shapes, action
// internals): schema MUST reject; the client's verdict is informational —
// strict clients MAY accept forward-compatible/below-contract invalids.
// A tier-A disagreement is a real schema<->client divergence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadValidator } from './corpus.mjs';
import { KNOWN_DIVERGENCE } from './mutations.mjs';
import { AgentClient } from '@agent-page/client';
import {
  validateStateRoot,
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
} from '@agent-page/server';

// Emit-side validators: strict hydrate also enforces the semantic rules the
// JSON Schema cannot express (enum value ∈ options, scaled integers, ...).
// A schema-valid doc may only be strict-rejected when emit rejects it under a
// pinned KNOWN_DIVERGENCE class — the same ratchet emit.test enforces.
function emitError(m) {
  return (
    validatePageBlock(m.page) ??
    validateStateRoot(m.state) ??
    validateManifestActions(m) ??
    validateNavigation(m.navigation) ??
    validatePresent(m.present) ??
    validateMeta(m.meta)
  );
}

const { validate } = await loadValidator();
const docs = await loadCorpus();

const clone = (o) => structuredClone(o);
const set = (root, path, v) => {
  const parts = path.split('.');
  let cur = root;
  for (const p of parts.slice(0, -1)) cur = cur[p];
  cur[parts.at(-1)] = v;
};
const drop = (root, path) => {
  const parts = path.split('.');
  let cur = root;
  for (const p of parts.slice(0, -1)) cur = cur?.[p];
  if (cur) delete cur[parts.at(-1)];
};

/** [label, mutatedDoc, tier] — tier 'a' asserts client agreement, 'b' doesn't. */
function* mutations(doc) {
  const M = (label, tier, fn) => {
    const d = clone(doc);
    fn(d);
    return [label, d, tier];
  };
  for (const k of ['app', 'page', 'state', 'actions', 'meta', 'present']) {
    if (k in doc) yield M(`drop /${k}`, 'a', (d) => drop(d, k));
  }
  yield* [
    M('app=9.9', 'a', (d) => set(d, 'app', '9.9')),
    M('app=7', 'a', (d) => set(d, 'app', 7)),
    M('app=null', 'a', (d) => set(d, 'app', null)),
    // 's' tier: strict-only enforcement — schema allows root extras
    // (forward-compat), strict clients MUST still reject them (§5.7).
    M('root extra member (strict-only)', 's', (d) => set(d, 'zzz_extra', 1)),
    M('page.id grammar', 'a', (d) => set(d, 'page.id', 'BAD ID!')),
    M('drop page.version', 'a', (d) => drop(d, 'page.version')),
    M('page.url null', 'a', (d) => set(d, 'page.url', null)),
    M('page.url num', 'a', (d) => set(d, 'page.url', 42)),
    M('drop page.id', 'a', (d) => drop(d, 'page.id')),
    M('state=null', 'a', (d) => set(d, 'state', null)),
    M('state=array', 'a', (d) => set(d, 'state', [])),
  ];
  for (const key of Object.keys(doc.state ?? {}).slice(0, 8)) {
    const node = doc.state[key];
    yield* [
      M(`state.${key} type=bogus`, 'a', (d) => set(d, `state.${key}.type`, 'bogus')),
      M(`state.${key} extra member`, 'a', (d) => set(d, `state.${key}.zzz_extra`, 1)),
      M(`state.${key} drop type`, 'a', (d) => drop(d, `state.${key}.type`)),
    ];
    if (node && typeof node === 'object') {
      if (node.type === 'string')
        yield M(`state.${key} value num`, 'b', (d) => set(d, `state.${key}.value`, 7));
      if (node.type === 'number')
        yield M(`state.${key} value str`, 'b', (d) => set(d, `state.${key}.value`, 'oops'));
      if (node.type === 'boolean')
        yield M(`state.${key} value str`, 'b', (d) => set(d, `state.${key}.value`, 'yes'));
      if (node.type === 'enum')
        yield M(`state.${key} enum out`, 'b', (d) => set(d, `state.${key}.value`, '__x__'));
      if (node.type === 'file')
        yield M(`state.${key} drop value.url`, 'b', (d) => drop(d, `state.${key}.value.url`));
      if (node.pagination)
        yield M(`state.${key} pag extra`, 'a', (d) => set(d, `state.${key}.pagination.zzz`, 1));
      if (node.type === 'object' && node.value && typeof node.value === 'object') {
        const childKey = Object.keys(node.value)[0];
        if (childKey) {
          yield M(`state.${key}.__proto__ child`, 'a', (d) => {
            d.state[key].value = JSON.parse('{"__proto__":{"type":"string","value":"pwned"}}');
            return d;
          });
          yield M(`state.${key}.${childKey} type bogus`, 'a', (d) =>
            set(d, `state.${key}.value.${childKey}.type`, 'bogus'),
          );
        }
      }
    }
  }
  for (const aid of Object.keys(doc.actions ?? {}).slice(0, 2)) {
    yield* [
      M(`actions.${aid} kind bogus`, 'b', (d) => set(d, `actions.${aid}.kind`, 'explode')),
      M(`actions.${aid} drop description`, 'b', (d) => drop(d, `actions.${aid}.description`)),
      M(`actions.${aid} side_effect bad`, 'b', (d) =>
        set(d, `actions.${aid}.side_effect`, 'lethal'),
      ),
    ];
  }
}

/** Strict-mode hydrate against a stub fetch serving `doc`; returns true on accept. */
async function strictAccepts(doc, url, dbg) {
  const fetchImpl = async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: {
        'content-type': 'application/vnd.agent-page+json',
        etag: '"fz"',
      },
    });
  const client = new AgentClient({ fetch: fetchImpl, strict: true });
  try {
    await client.hydrate(url);
    return true;
  } catch (e) {
    if (process.env.FUZZ_DEBUG && dbg) console.error('   reject', dbg, ':', e.code ?? e.message);
    return false;
  }
}

const stats = { a: 0, bSchemaRejected: 0, bClientAlsoRejected: 0, bClientAccepted: 0 };
for (const [name, doc] of docs) {
  const url = doc.page.url;
  test(`fuzz ${name}: baseline conforms and hydrates`, async () => {
    assert.ok(validate(doc), `baseline should be schema-valid`);
    assert.ok(await strictAccepts(doc, url), 'baseline must hydrate under strict mode');
  });
  for (const [label, mutated, tier] of mutations(doc)) {
    test(`fuzz ${name}: ${label}`, async () => {
      const schemaOk = validate(mutated);
      const clientOk = await strictAccepts(mutated, url, `${name} ${label}`);
      if (tier === 's') {
        assert.ok(schemaOk, 'root extras must stay schema-valid (forward-compat)');
        assert.ok(!clientOk, 'strict client MUST reject unknown root members');
        return;
      }
      if (schemaOk) {
        if (!clientOk) {
          const err = emitError(mutated);
          assert.ok(
            err && KNOWN_DIVERGENCE.some((re) => re.test(err.message)),
            `schema-valid but strict client rejected outside KNOWN_DIVERGENCE ` +
              `(emit: ${err?.message ?? 'none'})`,
          );
        }
        return;
      }
      // schema-invalid
      if (tier === 'a') {
        stats.a++;
        assert.ok(!clientOk, 'schema-invalid within strict contract but client accepted');
      } else {
        stats.bSchemaRejected++;
        if (clientOk) stats.bClientAccepted++;
        else stats.bClientAlsoRejected++;
      }
    });
  }
}
test('fuzz summary', () => console.error('fuzz stats:', JSON.stringify(stats)));

// Wire-captured manifests (real server output incl. v1.0 projections and
// the flights example) must hydrate under the STRICT client — they are
// exactly what a conformant server emits.
test('strict client hydrates every wire-captured manifest', async (t) => {
  const { loadWireCorpus } = await import('./corpus.mjs');
  const wire = await loadWireCorpus();
  let n = 0;
  for (const [name, schemaId, doc] of wire) {
    if (schemaId !== 'page-manifest.json') continue;
    n++;
    await t.test(name, async () => {
      assert.ok(
        await strictAccepts(doc, doc.page.url, `wire ${name}`),
        `strict client rejected wire manifest ${name}`,
      );
    });
  }
  assert.ok(n >= 10, `expected >=10 wire manifests, got ${n}`);
});
