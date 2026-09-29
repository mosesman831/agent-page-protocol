/**
 * Diff-apply oracle.
 *
 * Takes the real wire diff captured from the demo middleware (counter inc)
 * and requires the client's applyDiffDocument to (a) produce a schema-valid
 * manifest and (b) cleanly reject mutated diffs with app.err.diff.* codes —
 * never corrupt state silently or throw.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator, loadWireCorpus } from './corpus.mjs';
import { applyDiffDocument } from '@agent-page/client';
import { validateStateRoot } from '@agent-page/server';

const { validate } = await loadValidator();
const docs = await loadWireCorpus();

const counter = docs.find(([n]) => n === 'wire/page counter')?.[2];
const diff = docs.find(([n]) => n === 'wire/diff inc')?.[2];

const mutateDiff = (fn) => {
  const d = structuredClone(diff);
  const r = fn(d);
  return r === undefined ? d : r;
};

test('wire diff applies cleanly and yields a schema-valid manifest', () => {
  assert.ok(counter && diff, 'wire corpus must contain counter page + diff');
  const res = applyDiffDocument(counter, diff);
  assert.equal(res.ok, true, `apply failed: ${res.code} ${res.message}`);
  assert.ok(validate(res.manifest), 'result must be schema-valid');
  assert.equal(res.manifest.page.version, diff.result_version);
  assert.equal(validateStateRoot(res.manifest.state), null);
});

test('applying the same diff twice fails stale_base (version moved)', () => {
  const first = applyDiffDocument(counter, diff);
  assert.equal(first.ok, true);
  const second = applyDiffDocument(first.manifest, diff);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'app.err.diff.stale_base');
});

test('malformed diffs reject cleanly with app.err.diff.* codes', async (t) => {
  const cases = [
    ['base page_id mismatch', (d) => void (d.base.page_id = 'other_page')],
    ['base page_url mismatch', (d) => void (d.base.page_url = 'http://evil.test/x')],
    ['base version mismatch', (d) => void (d.base.version = 'bogus')],
    [
      'op targets /page/id (forbidden)',
      (d) => void (d.diff = [{ op: 'replace', path: '/page/id', value: 'x' }]),
    ],
    [
      'op targets /page/url (forbidden)',
      (d) => void (d.diff = [{ op: 'replace', path: '/page/url', value: 'x' }]),
    ],
    [
      'proto path traversal',
      (d) => void (d.diff = [{ op: 'replace', path: '/state/x/__proto__/y', value: 1 }]),
    ],
    ['unsupported op', (d) => void (d.diff = [{ op: 'hack', path: '/state/n/value', value: 1 }])],
    [
      'move from is prefix of path',
      (d) => void (d.diff = [{ op: 'move', from: '/state/n', path: '/state/n/value/deep' }]),
    ],
    [
      'add outside allowed roots',
      (d) => void (d.diff = [{ op: 'add', path: '/zzz_evil', value: 1 }]),
    ],
  ];
  for (const [label, fn] of cases) {
    await t.test(label, () => {
      const res = applyDiffDocument(counter, mutateDiff(fn));
      assert.equal(res.ok, false, `expected rejection for ${label}`);
      assert.match(res.code, /^app\.err\.diff\./);
    });
  }
});

test('empty diff is a version-bumping no-op (TV-36)', () => {
  const empty = mutateDiff((d) => {
    d.diff = [];
    return d;
  });
  const res = applyDiffDocument(counter, empty);
  assert.equal(res.ok, true);
  assert.deepEqual(
    { ...res.manifest, page: { ...res.manifest.page, version: counter.page.version } },
    counter,
  );
});
