/**
 * Generative diff oracle: for pairs of generated manifests sharing identity,
 * server-side generateDiff → buildDiffDocument → schema validation →
 * client applyDiffDocument must reconstruct `next` exactly (version moves to
 * result_version) and produce a schema-valid, emit-clean manifest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator } from './corpus.mjs';
import { generateManifest } from './generator.mjs';
import { buildDiffDocument } from '@agent-page/server';
import { applyDiffDocument } from '@agent-page/client';
import {
  validateStateRoot,
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
} from '@agent-page/server';

const { ajv, validate } = await loadValidator();
const validateDiffDoc = ajv.getSchema('diff-document.json');
const PAIRS = Number(process.env.GENFUZZ_SEEDS ?? 80);

const emitError = (m) =>
  validatePageBlock(m.page) ??
  validateStateRoot(m.state) ??
  validateManifestActions(m) ??
  validateNavigation(m.navigation) ??
  validatePresent(m.present) ??
  validateMeta(m.meta);

test('diff round-trip over generated pairs', async (t) => {
  for (let seed = 0; seed < PAIRS; seed++) {
    const base = generateManifest(seed);
    const next = generateManifest(100000 + seed);
    // normalize identity fields — diffs can never carry them (§7.2)
    next.page.id = base.page.id;
    next.page.url = base.page.url;
    next.app = base.app;
    next.page.version = `v${seed + 1000}`;
    const diffDoc = buildDiffDocument(base, next);
    const tag = `seeds ${seed}→${100000 + seed}`;
    await t.test(tag, () => {
      assert.ok(validateDiffDoc(diffDoc), `diff doc schema-invalid (${tag})`);
      const res = applyDiffDocument(base, diffDoc);
      assert.ok(res.ok, `apply failed (${tag}): ${res.code}`);
      const expected = structuredClone(next);
      expected.page.version = diffDoc.result_version;
      assert.deepEqual(res.manifest, expected, `applied ≠ next (${tag})`);
      assert.ok(validate(res.manifest), `applied doc schema-invalid (${tag})`);
      const emit = emitError(res.manifest);
      assert.equal(emit, null, `emit rejected applied doc (${tag}): ${emit?.code}`);
      // replay: same diff against the result must report stale_base
      const again = applyDiffDocument(res.manifest, diffDoc);
      assert.equal(again.ok, false);
      assert.equal(again.code, 'app.err.diff.stale_base');
    });
  }
});
