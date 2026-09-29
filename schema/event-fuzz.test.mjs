/**
 * Event-emit fuzz oracle.
 *
 * Mutates the real wire event doc captured from the demo middleware and
 * requires `validateEventRecord` to reject every schema-invalid mutation —
 * event records are the last emit surface, and MemoryEventStore.append now
 * enforces this before records reach SSE/long-poll subscribers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadValidator, loadWireCorpus } from './corpus.mjs';
import { validateEventRecord, MemoryEventStore } from '@agent-page/server';

const { ajv, validate } = await loadValidator();
const validateEventSchema = ajv.getSchema('event.json');
const docs = await loadWireCorpus();
const wireEvent = docs.find(([n]) => n === 'wire/event state.changed')?.[2];
assert.ok(wireEvent, 'wire corpus must contain an event doc');
assert.ok(validateEventSchema(wireEvent), 'captured wire event must be schema-valid');

const mutate = (fn) => {
  const d = structuredClone(wireEvent);
  const r = fn(d);
  return r === undefined ? d : r;
};

const INVALID = [
  ['drop app', (d) => void delete d.app],
  ['app bogus', (d) => void (d.app = '9.9')],
  ['extra root member', (d) => void (d.zzz = 1)],
  ['drop event', (d) => void delete d.event],
  ['event array', (d) => void (d.event = [])],
  ['drop type', (d) => void delete d.event.type],
  ['type bogus', (d) => void (d.event.type = 'made.up')],
  ['hint bogus', (d) => void (d.event.hint = 'maybe')],
  ['drop id', (d) => void delete d.event.id],
  ['id 129 chars', (d) => void (d.event.id = 'x'.repeat(129))],
  ['occurred_at bogus', (d) => void (d.event.occurred_at = 'not-a-date')],
  ['drop page_url', (d) => void delete d.event.page_url],
  ['page_url empty', (d) => void (d.event.page_url = '')],
  ['version empty', (d) => void (d.event.version = '')],
  ['extra event member', (d) => void (d.event.zzz = 1)],
  ['base_version number', (d) => void (d.event.base_version = 5)],
  ['pointers scalar', (d) => void (d.event.pointers = 'x')],
  ['proto key in diff', (d) => void (d.event.diff = JSON.parse('{"__proto__":{"x":1}}'))],
];

const wireDiff = docs.find(([n]) => n === 'wire/diff inc')?.[2];
const VALID = [
  ['with diff member', (d) => void (d.event.diff = wireDiff)],
  ['with base_version', (d) => void (d.event.base_version = 'v0')],
  ['with pointers', (d) => void (d.event.pointers = ['/state/n'])],
];

test('event oracle: schema-invalid mutants must fail emit validation', async (t) => {
  for (const [label, fn] of INVALID) {
    const mutated = mutate(fn);
    const schemaOk = validateEventSchema(mutated);
    if (schemaOk) continue; // schema-tolerated mutations aren't emit obligations
    await t.test(label, () => {
      assert.ok(validateEventRecord(mutated), `emit accepted schema-invalid: ${label}`);
    });
  }
});

test('event oracle: schema-valid mutants must pass emit validation', async (t) => {
  for (const [label, fn] of VALID) {
    const mutated = mutate(fn);
    await t.test(label, () => {
      assert.ok(validateEventSchema(mutated), `schema rejected legal: ${label}`);
      assert.equal(validateEventRecord(mutated), null);
    });
  }
});

test('MemoryEventStore.append rejects malformed records', async () => {
  const store = new MemoryEventStore();
  await assert.rejects(
    () => store.append(mutate((d) => void (d.event.type = 'made.up'))),
    (err) => err.envelope?.error?.code === 'app.err.event.invalid',
  );
  await store.append(wireEvent); // valid record stores fine
  const list = await store.list(wireEvent.event.page_url);
  assert.equal(list.length, 1);
});

// keep the manifest validator referenced so corpus loading stays honest
void validate;
