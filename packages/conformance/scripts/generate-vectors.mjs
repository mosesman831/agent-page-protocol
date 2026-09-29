#!/usr/bin/env node
/**
 * Generate TV-01..TV-60 vector source files from templates.
 * Run: node scripts/generate-vectors.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../src/vectors');

mkdirSync(outDir, { recursive: true });

const files = {
  'TV-01.ts': `import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, readJson, tvPath } from './helpers.js';

export const tv01Vector: TestVector = {
  meta: metaFor(1),
  async run(ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(\`\${ctx.baseUrl}\${tvPath(1)}\`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(res.status === 200, \`expected 200, got \${res.status}\`);
      const body = (await readJson(res)) as { state: unknown; actions?: unknown };
      assert(body.state && typeof body.state === 'object' && !Array.isArray(body.state) && Object.keys(body.state as object).length === 0, 'state must be {}');
      const actions = body.actions ?? {};
      assert(typeof actions === 'object' && !Array.isArray(actions) && Object.keys(actions as object).length === 0, 'actions must be empty');
      return pass(id, 'Empty state with zero actions');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
`,

  'TV-02.ts': `import { validateStateNode } from '@agent-page/server';
import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, errorCode, readJson, tvPath } from './helpers.js';

export const tv02Vector: TestVector = {
  meta: metaFor(2),
  async run(ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(\`\${ctx.baseUrl}\${tvPath(2)}\`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(res.status === 200, \`expected 200, got \${res.status}\`);
      const body = (await readJson(res)) as {
        state: { profile: { value: { middle_name: { type: string } } } };
      };
      assert(body.state.profile.value.middle_name.type === 'null', 'null node valid');

      const invalid = await ctx.fetch(\`\${ctx.baseUrl}\${tvPath(2)}/invalid-string-null\`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      assert(invalid.status === 502 || invalid.status === 400, \`invalid manifest expected error status, got \${invalid.status}\`);
      const err = await readJson(invalid);
      assert(errorCode(err) === 'app.err.state.invalid_node', \`expected invalid_node, got \${errorCode(err)}\`);

      const local = validateStateNode({ type: 'string', value: null });
      assert(local?.code === 'app.err.state.invalid_node', 'local validator rejects string value:null');
      return pass(id, 'Null nodes valid; string value:null rejected');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
`,

  'TV-03.ts': `import type { TestVector } from './types.js';
import { pass, fail } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, readJson, tvPath } from './helpers.js';

export const tv03Vector: TestVector = {
  meta: metaFor(3),
  async run(ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(\`\${ctx.baseUrl}\${tvPath(3)}\`, { headers: { Accept: ACCEPT_PAGE } });
      assert(res.status === 200, \`expected 200, got \${res.status}\`);
      const body = (await readJson(res)) as {
        state: { results: { pagination: { cursor: null; has_more: boolean; total: number } } };
      };
      const p = body.state.results.pagination;
      assert(p.cursor === null && p.has_more === false && p.total === 0, 'end-of-collection pagination');
      return pass(id, 'Empty table with valid pagination');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
`,

  'TV-04.ts': `import type { TestVector } from './types.js';
import { pass, fail, stub } from './types.js';
import { metaFor } from './registry.js';
import { ACCEPT_PAGE, assert, readJson, tvPath } from './helpers.js';

export const tv04Vector: TestVector = {
  meta: metaFor(4),
  async run(ctx) {
    const id = this.meta.id;
    try {
      const res = await ctx.fetch(\`\${ctx.baseUrl}\${tvPath(4)}\`, { headers: { Accept: ACCEPT_PAGE } });
      assert(res.status === 200, \`expected 200, got \${res.status}\`);
      const body = (await readJson(res)) as {
        state: { items: { pagination: { has_more: boolean } } };
        meta?: { warnings?: Array<{ code: string }> };
      };
      assert(body.state.items.pagination.has_more === false, 'has_more normalized to false');
      const warn = body.meta?.warnings?.find((w) => w.code === 'app.warn.state.pagination_inconsistent');
      if (!warn) {
        return stub(id, 'Pagination normalized; warn emission pending server support', { pagination: body.state.items.pagination });
      }
      return pass(id, 'Pagination inconsistency normalized with warning');
    } catch (e) {
      return fail(id, e instanceof Error ? e.message : String(e));
    }
  },
};
`,
};

// Generate remaining files with a compact template approach
for (let n = 5; n <= 60; n++) {
  const id = `TV-${String(n).padStart(2, '0')}`;
  if (files[`${id}.ts`]) continue;
  const exportName = `tv${String(n).padStart(2, '0')}Vector`;
  files[`${id}.ts`] = `import type { TestVector } from './types.js';
import { pass, fail, stub } from './types.js';
import { metaFor } from './registry.js';
import { runTv${String(n).padStart(2, '0')} } from './runs/tv-${String(n).padStart(2, '0')}.js';

export const ${exportName}: TestVector = {
  meta: metaFor(${n}),
  run: runTv${String(n).padStart(2, '0')},
};
`;
}

for (const [name, content] of Object.entries(files)) {
  writeFileSync(join(outDir, name), content);
}

console.log(`Wrote ${Object.keys(files).length} vector entry files`);
