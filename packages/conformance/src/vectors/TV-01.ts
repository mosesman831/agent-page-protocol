import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, readJson, tvPath } from './helpers.js';

export const tv01Vector: TestVector = {
  meta: metaFor(1),
  run: async function (ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(1)}`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const body = (await readJson(res)) as {
        state: Record<string, unknown>;
        actions?: Record<string, unknown>;
      };
      assert(Object.keys(body.state).length === 0, 'state must be {}');
      assert(Object.keys(body.actions ?? {}).length === 0, 'actions empty');
      return pass(id, 'Empty state with zero actions');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
