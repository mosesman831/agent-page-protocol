/**
 * Extension-validator fuzz oracle.
 *
 * The extension is the spec-sanctioned LENIENT client (§5.7): it may
 * tolerate documents the strict client rejects. Its contract is "process or
 * reject, never throw, never corrupt" — so this suite replays every shared
 * manifest mutation through `validateManifest` and asserts it returns a
 * structured result (never throws), and that an accepted document's
 * normalized form is still a real manifest object. Divergences between
 * schema rejection and extension acceptance are recorded, not asserted —
 * they are the lenient contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadValidator, loadWireCorpus } from './corpus.mjs';
import { manifestMutations, clone } from './mutations.mjs';
import { generateManifest } from './generator.mjs';
import { validateManifest } from '../extension/protocol/validate.js';

const { validate } = await loadValidator();
const corpus = await loadCorpus();

let tolerated = 0;
let rejected = 0;

test('extension oracle: validateManifest never throws on mutants', async (t) => {
  for (const [name, doc] of corpus) {
    if (!validate(doc)) continue;
    await t.test(name, async (t2) => {
      for (const [label, fn] of manifestMutations(doc)) {
        const mutated = clone(doc);
        const r = fn(mutated);
        const body = r === undefined ? mutated : r;
        if (validate(body)) continue;
        await t2.test(label, () => {
          let res;
          assert.doesNotThrow(() => {
            res = validateManifest(body);
          });
          assert.ok(res && typeof res === 'object' && 'ok' in res);
          if (res.ok) {
            tolerated++;
            assert.ok(
              res.manifest && typeof res.manifest === 'object',
              `accepted mutant lost its manifest (${label})`,
            );
          } else {
            rejected++;
            assert.match(res.code ?? '', /^app\.err\./);
          }
        });
      }
    });
  }
});

test('extension oracle: baseline docs still validate', async (t) => {
  for (const [name, doc] of corpus) {
    if (!validate(doc)) continue;
    await t.test(name, () => {
      const res = validateManifest(clone(doc));
      assert.ok(res.ok, `extension rejected schema-valid doc: ${name} (${res.code})`);
    });
  }
});

test('extension accepts every generated manifest', async (t) => {
  const seeds = Number(process.env.GENFUZZ_SEEDS ?? 60);
  for (let seed = 0; seed < seeds; seed++) {
    const doc = generateManifest(seed);
    if (!validate(doc)) continue; // generator bug would fail in generative.test
    await t.test(`gen ${seed}`, () => {
      const res = validateManifest(clone(doc));
      assert.ok(res.ok, `extension rejected generated doc (seed ${seed}): ${res.code}`);
    });
  }
});

test('extension accepts every wire-captured manifest', async (t) => {
  const wire = await loadWireCorpus();
  let n = 0;
  for (const [name, schemaId, doc] of wire) {
    if (schemaId !== 'page-manifest.json') continue;
    n++;
    await t.test(name, () => {
      const res = validateManifest(clone(doc));
      assert.ok(res.ok, `extension rejected wire manifest ${name}: ${res.code}`);
    });
  }
  assert.ok(n >= 10, `expected >=10 wire manifests, got ${n}`);
});

// Receipt normalization parity: contradictory pagination
// (cursor:null + has_more:true) must be normalized identically by the strict
// client and the extension — has_more:false plus the same meta.warnings entry.
test('pagination normalization parity', async () => {
  const { AgentClient } = await import('@agent-page/client');
  const doc = {
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
      list: {
        type: 'array',
        label: 'l',
        value: [],
        pagination: { cursor: null, has_more: true, total: 5 },
      },
    },
    actions: {},
  };
  const fetchImpl = async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: { 'content-type': 'application/vnd.agent-page+json' },
    });
  const strict = await new AgentClient({ fetch: fetchImpl, strict: true }).hydrate(
    'https://ex.com/p',
  );
  const lenient = validateManifest(clone(doc));
  assert.ok(lenient.ok);
  assert.equal(lenient.manifest.state.list.pagination.has_more, false);
  assert.equal(strict.state.list.pagination.has_more, false);
  assert.deepEqual(lenient.manifest.meta.warnings, strict.meta.warnings);
});

test('extension leniency summary', () => {
  console.error(`extension tolerated ${tolerated} schema-invalid mutants, rejected ${rejected}`);
});
