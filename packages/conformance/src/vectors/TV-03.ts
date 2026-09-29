import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, readJson, tvPath } from './helpers.js';

export const tv03Vector: TestVector = {
  meta: metaFor(3),
  run: async function (ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(`${ctx.baseUrl}${tvPath(3)}`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      const body = (await readJson(res)) as {
        state: { results: { pagination: { cursor: null; has_more: boolean; total: number } } };
      };
      const p = body.state.results.pagination;
      assert(p.cursor === null && p.has_more === false && p.total === 0, 'end pagination');
      return pass(id, 'Empty table pagination valid');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
