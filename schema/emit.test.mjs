/**
 * Emit-validation oracle.
 *
 * The schema answers "is this a conformant manifest?"; the server's emit-time
 * validators answer "may I serve this?". This suite mutates every corpus
 * manifest (shared mutations from mutations.mjs) and requires the emit
 * validators to reject every schema-invalid mutation that lands inside their
 * jurisdiction — a server MUST NOT emit what the schema forbids.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadValidator } from './corpus.mjs';
import { manifestMutations, clone, KNOWN_DIVERGENCE } from './mutations.mjs';
import {
  validateStateRoot,
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
} from '@agent-page/server';

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
const corpus = await loadCorpus();

const divergences = [];
test('emit oracle: schema-invalid mutants must fail emit validation', async (t) => {
  for (const [name, doc] of corpus) {
    if (!validate(doc)) continue;
    await t.test(name, async (t2) => {
      for (const [label, fn] of manifestMutations(doc)) {
        const mutated = clone(doc);
        const r = fn(mutated);
        const body = r === undefined ? mutated : r;
        const schemaOk = validate(body);
        if (schemaOk) {
          // Schema allows it; emit validator may still reject — but only
          // inside KNOWN_DIVERGENCE (the JSON-Schema-inexpressible checks:
          // cross-field rules and forbidden-key hardening). Anything else
          // would be a spec hole: legal-by-schema, unservable-by-emit.
          const err = emitError(body);
          if (err && !KNOWN_DIVERGENCE.some((re) => re.test(err.message))) {
            divergences.push(`${name}: ${label} -> ${err.code}: ${err.message}`);
          }
          continue;
        }
        const emitOk = !emitError(body);
        if (emitOk) divergences.push(`${name}: ${label}`);
        await t2.test(label, () => {
          assert.ok(!emitOk, `schema-invalid but emit validators accepted (${label})`);
        });
      }
    });
  }
});

test('emit divergences summary', () => {
  if (divergences.length) console.error('emit divergences:', divergences);
  assert.deepEqual(
    divergences,
    [],
    `schema-valid docs emit-rejected outside the known inexpressible classes:\n${divergences.join('\n')}`,
  );
});
