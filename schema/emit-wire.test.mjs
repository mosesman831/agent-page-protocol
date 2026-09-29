/**
 * Emit-wire oracle.
 *
 * Same mutations as emit.test.mjs, but served through the REAL middleware
 * (createAppServer). For every schema-invalid mutation the wire MUST answer
 * an error (4xx/5xx with an app error envelope) — never a 200 carrying an
 * invalid manifest. This pins the middleware wiring, not just the validators.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadCorpus, loadValidator } from './corpus.mjs';
import { manifestMutations, clone } from './mutations.mjs';
import { createAppServer } from '@agent-page/server';

const { validate } = await loadValidator();
const corpus = await loadCorpus();

const H = {
  Accept: 'application/vnd.agent-page+json',
  'X-APP-Accept-Versions': '1.1, 1.0',
  'X-APP-Client': 'emit-wire/1.0',
};

test('emit-wire oracle: mutated manifests never leave the wire as 200', async (t) => {
  for (const [name, doc] of corpus) {
    if (!validate(doc)) continue;
    await t.test(name, async (t2) => {
      let current = doc;
      const app = createAppServer({
        getManifest: async () => current,
        actionHandlers: {},
        origin: 'http://127.0.0.1',
      });
      const server = app.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const port = server.address().port;
      try {
        const get = () => fetch(`http://127.0.0.1:${port}/x`, { headers: H });
        const base = await get();
        assert.equal(base.status, 200, `${name}: baseline must serve`);
        for (const [label, fn] of manifestMutations(doc)) {
          const mutated = clone(doc);
          const r = fn(mutated);
          const body = r === undefined ? mutated : r;
          const schemaOk = validate(body);
          if (schemaOk) continue; // emit is stricter than schema by design
          current = body;
          try {
            const res = await get();
            const text = await res.text();
            let parsed = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              /* not json */
            }
            await t2.test(label, () => {
              assert.notEqual(res.status, 200, `schema-invalid served 200 (${label})`);
              assert.ok(parsed && parsed.error, `no error envelope for ${label}`);
            });
          } finally {
            current = doc;
          }
        }
      } finally {
        server.close();
        await once(server, 'close').catch(() => {});
      }
    });
  }
});
