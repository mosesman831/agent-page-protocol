/**
 * Generative-mutant fuzz: the shared mutation library applied to GENERATED
 * manifests instead of only the corpus. Each random doc has different keys
 * and shapes, so the mutants hit far more of the invalid-document space —
 * every schema-invalid mutant must still fail emit validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadValidator } from './corpus.mjs';
import { generateManifest } from './generator.mjs';
import { clone, manifestMutations, stateMutations, KNOWN_DIVERGENCE } from './mutations.mjs';
import {
  validateStateRoot,
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
} from '@agent-page/server';

const { validate } = await loadValidator();
const SEEDS = Number(process.env.GENFUZZ_SEEDS ?? 60);
const stateNode = JSON.parse(await readFile(new URL('./state-node.json', import.meta.url), 'utf8'));
const NODE_TYPES = Object.values(stateNode.$defs)
  .map((d) => d.allOf?.map((a) => a.properties?.type?.const).find(Boolean))
  .filter(Boolean);

const emitError = (m) =>
  validatePageBlock(m.page) ??
  validateStateRoot(m.state) ??
  validateManifestActions(m) ??
  validateNavigation(m.navigation) ??
  validatePresent(m.present) ??
  validateMeta(m.meta);

const emitAccepted = [];
const divergences = [];
test('generated-doc mutants: schema-invalid must fail emit', async (t) => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const doc = generateManifest(seed);
    for (const [label, fn] of manifestMutations(doc)) {
      const mutated = clone(doc);
      const r = fn(mutated);
      const body = r === undefined ? mutated : r;
      const schemaOk = validate(body);
      if (schemaOk) {
        // schema-accepted but emit-rejected: only allowed inside the known
        // JSON-Schema-inexpressible classes (see KNOWN_DIVERGENCE)
        const err = emitError(body);
        if (err && !KNOWN_DIVERGENCE.some((re) => re.test(err.message))) {
          divergences.push(`seed ${seed} ${label} -> ${err.code}: ${err.message}`);
        }
        continue;
      }
      const emitOk = !emitError(body);
      const tag = `seed ${seed} ${label}`;
      if (emitOk) emitAccepted.push(tag);
      await t.test(tag, () => {
        assert.ok(!emitOk, `schema-invalid mutant accepted by emit (${tag})`);
      });
    }
  }
});

test('generative-mutant divergences summary', () => {
  if (emitAccepted.length) console.error('emit-accepted:', emitAccepted);
  assert.deepEqual(
    divergences,
    [],
    `schema-valid docs emit-rejected outside the known inexpressible classes:\n${divergences.join('\n')}`,
  );
});

// A node type with no targeted mutant is a blind spot in the invalid-space
// fuzz — assert the sweep produces schema-invalid mutants for all 16.
test('state mutations cover every node type', () => {
  const mutatedTypes = new Set();
  for (let seed = 0; seed < 120; seed++) {
    const doc = generateManifest(seed);
    if (!validate(doc)) continue;
    const typeByKey = {};
    for (const [k, n] of Object.entries(doc.state ?? {})) typeByKey[k] = n?.type;
    for (const [label, fn] of stateMutations(doc)) {
      const m = /^state\.([^.]+) /.exec(label);
      if (!m || !(m[1] in typeByKey)) continue;
      if (mutatedTypes.has(typeByKey[m[1]])) continue;
      const mutated = clone(doc);
      const r = fn(mutated);
      const body = r === undefined ? mutated : r;
      if (!validate(body)) mutatedTypes.add(typeByKey[m[1]]);
    }
  }
  assert.deepEqual(
    [...mutatedTypes].sort(),
    [...NODE_TYPES].sort(),
    'node types with no schema-invalid mutation',
  );
});
