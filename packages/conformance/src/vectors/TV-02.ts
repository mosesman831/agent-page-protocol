import { validateStateNode } from '@agent-page/server';
import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, errorCode, readJson, tvPath } from './helpers.js';

export const tv02Vector: TestVector = {
  meta: metaFor(2),
  run: async function (ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(2)}`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(res.status === 200, 'valid null node');
      const bad = await ctx.fetch(`${ctx.baseUrl}${tvPath(2)}/invalid-string-null`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(bad.status >= 400, 'invalid rejected');
      assert(errorCode(await readJson(bad)) === 'app.err.state.invalid_node', 'invalid_node');
      assert(
        validateStateNode({ type: 'string', value: null })?.code === 'app.err.state.invalid_node',
        'local',
      );
      return pass(id, 'Null nodes valid; string value:null rejected');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
