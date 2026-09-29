// Generator coverage self-test: the fuzzer is only useful while it keeps
// emitting the whole vocabulary. If an edit drops a node type, param type,
// action kind, layout, or component type from the generator, every
// generative suite quietly goes blind to it — pin the coverage here.
// Authoritative sets come from the schema files (drift-pinned to the
// validators), not re-declared locally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateManifest } from './generator.mjs';

const readJson = async (f) => JSON.parse(await readFile(new URL(f, import.meta.url), 'utf8'));

const stateNode = await readJson('state-node.json');
const NODE_TYPES = Object.values(stateNode.$defs)
  .map((d) => d.allOf?.map((a) => a.properties?.type?.const).find(Boolean))
  .filter(Boolean);

const actionDef = await readJson('action-def.json');
const PARAM_TYPES = actionDef.$defs.param.properties.type.enum;
const ACTION_KINDS = actionDef.properties.kind.enum;

const present = await readJson('present.json');
const COMPONENT_TYPES = present.$defs.componentHint.properties.type.enum;
const LAYOUTS = present.$defs.layout.enum;
assert.equal(NODE_TYPES.length, 20);
assert.equal(PARAM_TYPES.length, 14);
assert.ok(COMPONENT_TYPES.length >= 20);
assert.ok(LAYOUTS.length >= 8);

function collect(doc, seen) {
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      if (typeof v.type === 'string') seen.nodes.add(v.type);
      for (const c of Object.values(v)) walk(c);
    }
  };
  walk(doc.state);
  const walkParam = (d) => {
    if (!d || typeof d !== 'object') return;
    if (d.type) seen.params.add(d.type);
    walkParam(d.item_type);
    for (const inner of Object.values(d.properties ?? {})) walkParam(inner);
  };
  for (const a of Object.values(doc.actions ?? {})) {
    seen.kinds.add(a.kind);
    for (const p of Object.values(a.input ?? {})) walkParam(p);
  }
  for (const s of Object.values(doc.present?.sections ?? {})) {
    if (s.layout) seen.layouts.add(s.layout);
  }
  for (const c of Object.values(doc.present?.components ?? {})) {
    if (c.type) seen.components.add(c.type);
  }
}

test('generator covers the full schema vocabulary', () => {
  const seeds = Math.max(200, Number(process.env.GENFUZZ_SEEDS ?? 200));
  const seen = {
    nodes: new Set(),
    params: new Set(),
    kinds: new Set(),
    layouts: new Set(),
    components: new Set(),
  };
  for (let s = 0; s < seeds; s++) collect(generateManifest(s), seen);
  assert.deepEqual([...seen.nodes].sort(), [...NODE_TYPES].sort(), 'node types not emitted');
  assert.deepEqual([...seen.params].sort(), [...PARAM_TYPES].sort(), 'param types not emitted');
  assert.deepEqual([...seen.kinds].sort(), [...ACTION_KINDS].sort(), 'action kinds not emitted');
  assert.deepEqual([...seen.layouts].sort(), [...LAYOUTS].sort(), 'section layouts not emitted');
  assert.deepEqual(
    [...seen.components].sort(),
    [...COMPONENT_TYPES].sort(),
    'component types not emitted',
  );
});
