import { AgentClient } from '@agent-page/client';
import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { assert, tvPath } from './helpers.js';

export const tv04Vector: TestVector = {
  meta: metaFor(4),
  run: async function (ctx) {
    const id = this.meta.id;
    try {
      // §5.2: cursor:null + has_more:true is contradictory — clients treat as
      // has_more:false and surface app.warn.state.pagination_inconsistent.
      const client = new AgentClient({ fetch: ctx.fetch });
      const manifest = await client.hydrate(`${ctx.baseUrl}${tvPath(4)}`);
      const items = manifest.state.items as { pagination?: { has_more?: boolean } };
      assert(items.pagination?.has_more === false, 'normalized has_more');
      const warnings = (manifest.meta?.warnings ?? []) as { code?: string }[];
      assert(
        warnings.some((w) => w.code === 'app.warn.state.pagination_inconsistent'),
        'warn surfaced',
      );
      return pass(id, 'Pagination inconsistency normalized + warned');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
