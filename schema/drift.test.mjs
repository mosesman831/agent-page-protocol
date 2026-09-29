/**
 * Emit-validator ↔ schema drift oracle.
 *
 * The emit validators mirror the schema's closed member sets by hand. This
 * suite pins the mirror: for every closed object type (additionalProperties
 * false) the emit allowlist must equal the schema's property set exactly —
 * a schema change without an emit update (or vice versa) fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ERROR_REGISTRY as SERVER_REGISTRY,
  WARN_CODES as SERVER_WARN_CODES,
} from '@agent-page/server';
import { ERROR_REGISTRY as CLIENT_REGISTRY } from '@agent-page/client';
import {
  PAGE_MEMBERS,
  NAV_MEMBERS,
  NAV_ITEM_MEMBERS,
  NAV_ITEM_RELS,
  ACTION_DEF_MEMBERS,
  PARAM_MEMBERS,
  OPTIONS_SOURCE_MEMBERS,
  NODE_MEMBERS,
  PAGINATION_MEMBERS,
  PRESENT_MEMBERS,
  PRESENT_LAYOUTS,
  SECTION_MEMBERS,
  COLUMN_MEMBERS,
  COLUMN_FORMATS,
  COLUMN_ALIGNS,
  COMPONENT_TYPES,
  COMPONENT_MEMBERS,
  COMPONENT_VARIANTS,
  CHART_KINDS,
  TAB_MEMBERS,
  THEME_MEMBERS,
  A11Y_MEMBERS,
  LIVE_REGIONS,
  RESPONSIVE_MEMBERS,
  BREAKPOINT_MEMBERS,
  validateEventRecord,
} from '@agent-page/server';

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = (name) => JSON.parse(readFileSync(join(HERE, name), 'utf8'));

const exact = (emitSet, schemaProps, label) =>
  assert.deepEqual(
    [...emitSet].sort(),
    [...schemaProps].sort(),
    `${label}: emit allowlist and schema properties diverged`,
  );

test('page block members mirror manifest.json#/page', () => {
  const s = schema('manifest.json');
  const page = s.properties.page ?? s.$defs?.page ?? s;
  exact(PAGE_MEMBERS, Object.keys(page.properties), 'page');
});

test('navigation members mirror navigation.json', () => {
  const s = schema('navigation.json');
  exact(NAV_MEMBERS, Object.keys(s.properties), 'navigation');
  const item = s.$defs.navItem;
  assert.equal(item.additionalProperties, false);
  exact(NAV_ITEM_MEMBERS, Object.keys(item.properties), 'navigation item');
  assert.deepEqual([...NAV_ITEM_RELS].sort(), [...item.properties.rel.enum].sort());
});

test('action def members mirror action-def.json', () => {
  const s = schema('action-def.json');
  assert.equal(s.additionalProperties, false);
  exact(ACTION_DEF_MEMBERS, Object.keys(s.properties), 'action def');
  const param = s.$defs.param;
  assert.equal(param.additionalProperties, false);
  exact(PARAM_MEMBERS, Object.keys(param.properties), 'param def');
  const os = s.$defs.optionsSource;
  exact(OPTIONS_SOURCE_MEMBERS, Object.keys(os.properties), 'options_source');
});

test('state node members ⊆ state-node.json properties (per-type)', () => {
  const s = schema('state-node.json');
  // union of all property names the schema defines anywhere
  const allProps = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v.properties ?? {})) allProps.add(k);
    for (const sub of Object.values(v)) {
      if (Array.isArray(sub)) sub.forEach(walk);
      else walk(sub);
    }
  };
  walk(s.$defs ?? {});
  walk(s);
  for (const [type, members] of Object.entries(NODE_MEMBERS)) {
    for (const m of members) {
      assert.ok(allProps.has(m), `state node type ${type}: emit member ${m} not in schema`);
    }
  }
  exact(PAGINATION_MEMBERS, Object.keys(s.$defs.pagination.properties), 'pagination');
});

test('present members mirror present.json closed internals', () => {
  const s = schema('present.json');
  assert.equal(s.additionalProperties, false);
  exact(PRESENT_MEMBERS, Object.keys(s.properties), 'present root');
  const layoutDef = s.$defs.layout;
  assert.deepEqual([...PRESENT_LAYOUTS].sort(), [...layoutDef.enum].sort());
  const sec = s.$defs.section;
  assert.equal(sec.additionalProperties, false);
  exact(SECTION_MEMBERS, Object.keys(sec.properties), 'section');
  const col = sec.properties.columns.items;
  assert.equal(col.additionalProperties, false);
  exact(COLUMN_MEMBERS, Object.keys(col.properties), 'column');
  assert.deepEqual([...COLUMN_FORMATS].sort(), [...col.properties.format.enum].sort());
  assert.deepEqual([...COLUMN_ALIGNS].sort(), [...col.properties.align.enum].sort());
  const comp = s.$defs.componentHint;
  assert.equal(comp.additionalProperties, false);
  exact(COMPONENT_MEMBERS, Object.keys(comp.properties), 'component');
  assert.deepEqual([...COMPONENT_TYPES].sort(), [...comp.properties.type.enum].sort());
  assert.deepEqual([...COMPONENT_VARIANTS].sort(), [...comp.properties.variant.enum].sort());
  assert.deepEqual([...CHART_KINDS].sort(), [...comp.properties.chart_kind.enum].sort());
  const tab = comp.properties.tabs.items;
  assert.equal(tab.additionalProperties, false);
  exact(TAB_MEMBERS, Object.keys(tab.properties), 'tab');
  const theme = s.properties.theme;
  assert.equal(theme.additionalProperties, false);
  exact(THEME_MEMBERS, Object.keys(theme.properties), 'theme');
  const a11y = s.properties.a11y;
  assert.equal(a11y.additionalProperties, false);
  exact(A11Y_MEMBERS, Object.keys(a11y.properties), 'a11y');
  assert.deepEqual([...LIVE_REGIONS].sort(), [...a11y.properties.live_region.enum].sort());
  const resp = s.properties.responsive;
  assert.equal(resp.additionalProperties, false);
  exact(RESPONSIVE_MEMBERS, Object.keys(resp.properties), 'responsive');
  const bp = resp.properties.breakpoints;
  assert.equal(bp.additionalProperties, false);
  exact(BREAKPOINT_MEMBERS, Object.keys(bp.properties), 'breakpoints');
});

test('event record members mirror event.json', () => {
  const s = schema('event.json');
  const evProps = Object.keys(s.properties.event.properties);
  // validateEventRecord's allowlist is module-internal; probe it instead:
  // a doc carrying each schema member must not fail member-check, and an
  // invented member must fail.
  const base = {
    app: '1.1',
    event: {
      id: 'e1',
      type: 'state.changed',
      page_id: 'p',
      page_url: 'http://x/',
      version: 'v1',
      occurred_at: '2026-01-01T00:00:00Z',
      hint: 'revalidate',
    },
  };
  for (const m of evProps) {
    if (['id', 'type', 'page_id', 'page_url', 'version', 'occurred_at', 'hint'].includes(m))
      continue;
    const doc = structuredClone(base);
    doc.event[m] = m === 'pointers' ? [] : m === 'diff' ? null : 'x';
    assert.equal(validateEventRecord(doc), null, `event member ${m} rejected by emit`);
  }
  const extra = structuredClone(base);
  extra.event.invented = 1;
  assert.ok(validateEventRecord(extra), 'invented event member accepted');
});

test('every emitted app.err/app.warn literal is registered', () => {
  const errRegistered = new Set([...Object.keys(SERVER_REGISTRY), ...Object.keys(CLIENT_REGISTRY)]);
  const warnRegistered = new Set(Object.keys(SERVER_WARN_CODES));
  const roots = ['packages/server/src', 'packages/client/src', 'packages/tool-core/src'];
  const emitted = new Map(); // code -> first file seen
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) {
        for (const m of readFileSync(p, 'utf8').matchAll(/['"`]app\.(?:err|warn)\.[a-z0-9_.]+/g)) {
          const code = m[0].slice(1); // strip quote
          if (code.endsWith('.')) continue; // prefix concat, not a full code
          if (!emitted.has(code)) emitted.set(code, p);
        }
      }
    }
  };
  for (const r of roots) walk(join(HERE, '..', r));
  const missing = [...emitted.keys()].filter((c) =>
    c.startsWith('app.warn.') ? !warnRegistered.has(c) : !errRegistered.has(c),
  );
  assert.deepEqual(
    missing,
    [],
    `emitted codes missing from ERROR_REGISTRY/WARN_CODES: ${missing
      .map((c) => `${c} (${emitted.get(c)})`)
      .join(', ')}`,
  );
});
