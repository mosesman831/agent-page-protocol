/**
 * Conformance-emit oracle.
 *
 * Boots the real conformance server and fetches every vector route. Every
 * manifest it serves (200) MUST be schema-valid — the reference implementation
 * is what vectors are judged against, so it may never emit an invalid page.
 * Routes that deliberately serve non-200 (negative fixtures the emit layer
 * now intercepts, auth gates, redirect chains) are pinned in EXPECTED_NON_200:
 * the set must match exactly, so a newly failing route trips this suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator } from './corpus.mjs';
import { startConformanceServer } from '@agent-page/conformance';

const { validate } = await loadValidator();

const H = {
  Accept: 'application/vnd.agent-page+json',
  'X-APP-Accept-Versions': '1.1, 1.0',
  'X-APP-Client': 'conformance-emit/1.0',
};

const SUFFIXES = ['', '/ok', '/too-many', '/invalid-string-null', '/a', '/b'];

// Deliberate: these routes intentionally emit invalid manifests (the emit
// layer intercepts them as 5xx), gate on auth, or redirect.
const EXPECTED_NON_200 = new Map([
  ['/vectors/tv-02/invalid-string-null', 502],
  ['/vectors/tv-05', 500],
  ['/vectors/tv-06', 500],
  ['/vectors/tv-06/too-many', 500],
  ['/vectors/tv-08', 500],
  ['/vectors/tv-09', 502],
  ['/vectors/tv-10', 500],
  ['/vectors/tv-11', 500],
  ['/vectors/tv-12', 500],
  ['/vectors/tv-13', 502],
  ['/vectors/tv-14', 500],
  ['/vectors/tv-15', 500],
  ['/vectors/tv-42/a', 303],
  ['/vectors/tv-42/b', 303],
  ['/vectors/tv-49', 401],
  ['/vectors/tv-147', 500],
  ['/vectors/tv-148', 500],
]);

const srv = await startConformanceServer({ port: 0 });
const base = `http://127.0.0.1:${srv.port}`;

const seenNon200 = new Map();
let served = 0;
let valid = 0;

test('conformance server emits schema-valid manifests on every route', async (t) => {
  for (let n = 1; n <= 158; n++) {
    for (const suffix of SUFFIXES) {
      const path = `/vectors/tv-${String(n).padStart(2, '0')}${suffix}`;
      const res = await fetch(base + path, { headers: H, redirect: 'manual' });
      if (res.status === 404) continue;
      served++;
      if (res.status !== 200) {
        seenNon200.set(path, res.status);
        await res.arrayBuffer(); // drain
        continue;
      }
      const doc = await res.json();
      await t.test(path, () => {
        const ok = validate(doc);
        if (ok) valid++;
        assert.ok(ok, `invalid manifest: ${JSON.stringify(validate.errors?.[0] ?? '')}`);
      });
    }
  }
});

test('non-200 routes match the pinned deliberate-negative set', () => {
  assert.deepEqual([...seenNon200.entries()].sort(), [...EXPECTED_NON_200.entries()].sort());
  console.error(`conformance-emit: ${served} routes served, ${valid} schema-valid`);
});

test.after(() => srv.close());
