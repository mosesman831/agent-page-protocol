/**
 * Generative fuzz: random *valid* manifests through every enforcement layer.
 *
 * Mutation fuzzing explores the invalid-document space; this suite generates
 * schema-valid manifests (every node type, actions+params, present, nav) and
 * asserts all four consumers accept them — schema, emit validators, strict
 * hydrate, and a real wire GET. A schema-invalid generated doc is a generator
 * bug (asserted as such, with the seed for reproduction).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadValidator } from './corpus.mjs';
import { generateManifest } from './generator.mjs';
import {
  validateStateRoot,
  validateManifestActions,
  validatePageBlock,
  validateNavigation,
  validatePresent,
  validateMeta,
  createAppServer,
} from '@agent-page/server';
import { AgentClient } from '@agent-page/client';

const { validate } = await loadValidator();
const SEEDS = Number(process.env.GENFUZZ_SEEDS ?? 120);

const emitError = (m) =>
  validatePageBlock(m.page) ??
  validateStateRoot(m.state ?? {}) ??
  validateManifestActions(m) ??
  validateNavigation(m.navigation) ??
  validatePresent(m.present) ??
  validateMeta(m.meta);

async function strictAccepts(doc, url) {
  const fetchImpl = async () =>
    new Response(JSON.stringify(doc), {
      status: 200,
      headers: { 'content-type': 'application/vnd.agent-page+json', etag: '"gf"' },
    });
  const client = new AgentClient({ fetch: fetchImpl, strict: true });
  try {
    await client.hydrate(url);
    return true;
  } catch {
    return false;
  }
}

test('generator determinism: same seed, same doc', () => {
  assert.deepEqual(generateManifest(42), generateManifest(42));
});

test('generated manifests pass schema + emit + strict client', async (t) => {
  for (let seed = 0; seed < SEEDS; seed++) {
    const doc = generateManifest(seed);
    await t.test(`seed ${seed}`, async () => {
      assert.ok(validate(doc), `generator produced schema-invalid doc (seed ${seed})`);
      const emit = emitError(doc);
      assert.equal(emit, null, `emit rejected generated doc (seed ${seed}): ${emit?.code}`);
      assert.ok(
        await strictAccepts(doc, doc.page.url),
        `strict client rejected generated doc (seed ${seed})`,
      );
    });
  }
});

test('generated manifests serve 200 on the wire', async () => {
  let current = generateManifest(0);
  const app = createAppServer({
    getManifest: () => current,
    actionHandlers: {},
    origin: 'http://127.0.0.1',
  });
  const server = app.listen(0);
  await once(server, 'listening');
  const port = server.address().port;
  try {
    for (let seed = 0; seed < Math.min(SEEDS, 40); seed++) {
      current = generateManifest(seed);
      current.page.url = `http://127.0.0.1:${port}/gen`;
      const res = await fetch(`http://127.0.0.1:${port}/gen`, {
        headers: { accept: 'application/vnd.agent-page+json' },
      });
      assert.equal(res.status, 200, `wire rejected generated doc (seed ${seed})`);
    }
  } finally {
    server.close();
    await once(server, 'close').catch(() => {});
  }
});
