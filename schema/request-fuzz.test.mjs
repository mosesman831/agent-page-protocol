/**
 * Request-side fuzz oracle.
 *
 * Mirrors the manifest fuzz on the request path: synthesize a valid action
 * request for corpus actions, mutate it, and require the real server-side
 * validator (validateActionRequest) to reject anything schema-invalid —
 * plus the catalog-dependent cases only the server can see (unknown action,
 * missing required param, sensitive action without an idempotency key).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus, loadValidator } from './corpus.mjs';
import { validateActionRequest, requiresIdempotencyKey, validateParams } from '@agent-page/server';

const { ajv, validate } = await loadValidator();
const validateReq = ajv.getSchema('action-request.json');
const corpus = await loadCorpus();
const MEDIA = 'application/vnd.agent-page-action+json';
const GOOD_KEY = 'validkey-12345';
const BAD_KEY = 'bad!!';

function clone(v) {
  return structuredClone(v);
}
function set(d, path, val) {
  const parts = path.split('.');
  let cur = d;
  for (const p of parts.slice(0, -1)) cur = cur?.[p];
  if (cur) cur[parts.at(-1)] = val;
}
function drop(d, path) {
  const parts = path.split('.');
  let cur = d;
  for (const p of parts.slice(0, -1)) cur = cur?.[p];
  if (cur) delete cur[parts.at(-1)];
}

/** Minimal valid param value per ParamDef.type. */
function sampleFor(def) {
  switch (def.type) {
    case 'string':
      return 'x';
    case 'number':
      return 1;
    case 'boolean':
      return true;
    case 'date':
      return '2026-01-01';
    case 'datetime':
      return '2026-01-01T00:00:00Z';
    case 'enum':
      return (def.options ?? ['x'])[0];
    case 'array':
      return def.item_type ? [sampleFor(def.item_type)] : [];
    case 'object': {
      const out = {};
      for (const [k, child] of Object.entries(def.properties ?? {})) {
        if (child.required) out[k] = sampleFor(child);
      }
      return out;
    }
    case 'geopoint':
      return { lat: 1, lng: 2 };
    case 'file':
      return 'https://example.com/f.pdf';
    case 'date_range':
      return { from: '2026-01-01', to: '2026-01-31' };
    case 'datetime_range':
      return { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' };
    case 'quantity':
      return { value: 2, unit: 'kg' };
    case 'money':
      return { amount: 123, scale: 2, currency: 'GBP' };
    default:
      return 'x';
  }
}

const STRING_CANDIDATES = [
  'x',
  'a@b.co',
  'John',
  'LHR',
  '12A',
  '1A',
  '23F',
  '12345',
  '123',
  '4111111111111111',
  'SW1A 1AA',
  'SW1A1AA',
  '12/27',
  'AB12CD',
  '2026-01-01',
  'hello world',
  'aaaaaaaaaaaaaaaaaaaaaaaa',
];
const NUMBER_CANDIDATES = [1, 0, 50, 9.99, 100, 500, 5000, 10000, -1, 2026];

/** Pick the first candidate the real param validator accepts for this def. */
function pickValid(key, def, candidates) {
  for (const c of candidates) {
    const r = validateParams({ [key]: def }, { [key]: c }, { mode: 'strict' });
    if (r.ok) return c;
  }
  return candidates[0];
}

function sampleParams(input) {
  const out = {};
  for (const [k, def] of Object.entries(input ?? {})) {
    if (!def.required) continue;
    if (def.type === 'string' || def.type === 'file') out[k] = pickValid(k, def, STRING_CANDIDATES);
    else if (def.type === 'number') {
      const bounds = [];
      if (typeof def.min === 'number' && typeof def.max === 'number') {
        bounds.push(Math.floor((def.min + def.max) / 2), def.min, def.max);
      } else if (typeof def.min === 'number') bounds.push(def.min, def.min + 1);
      else if (typeof def.max === 'number') bounds.push(def.max, def.max - 1);
      out[k] = pickValid(k, def, [...bounds, ...NUMBER_CANDIDATES]);
    } else out[k] = sampleFor(def);
  }
  return out;
}

function firstRequired(input) {
  for (const [k, def] of Object.entries(input ?? {})) {
    if (def.required) return k;
  }
  return null;
}

const stats = { actions: 0, mutants: 0, schemaInvalidAndAccepted: [] };

test('request fuzz oracle', async (t) => {
  for (const [name, manifest] of corpus) {
    if (!validate(manifest)) continue;
    for (const [aid, def] of Object.entries(manifest.actions ?? {}).slice(0, 2)) {
      stats.actions++;
      const needsKey = requiresIdempotencyKey(def);
      const key = needsKey ? GOOD_KEY : undefined;
      const base = { app: '1.1', action: aid, params: sampleParams(def.input) };

      const run = (body, opts = {}) =>
        validateActionRequest({
          contentType: MEDIA,
          body,
          actions: manifest.actions,
          idempotencyKey: 'key' in opts ? opts.key : key,
          selectedVersion: '1.1',
          ...opts,
        });

      const reqOk = (body, opts) => {
        const r = run(body, opts);
        return r && r.ok === true;
      };
      const schemaOk = (body) => validateReq(body) === true;

      await t.test(`${name} ${aid} baseline`, () => {
        assert.ok(schemaOk(base), 'synthesized base request should be schema-valid');
        assert.ok(reqOk(base), `valid request must be accepted (${aid})`);
      });

      const mutations = [
        ['drop action', (d) => drop(d, 'action')],
        ['action unknown', (d) => set(d, 'action', 'zzz_unknown')],
        ['action bad pattern', (d) => set(d, 'action', 'Bad-Id!')],
        ['params array', (d) => set(d, 'params', [])],
        ['params scalar', (d) => set(d, 'params', 7)],
        ['extra root member', (d) => set(d, 'zzz', 1)],
        ['app=9.9', (d) => set(d, 'app', '9.9')],
        ['body array', () => ['x']],
        ['client.kind bogus', (d) => set(d, 'client', { kind: 'alien' })],
        [
          'params 65 keys',
          (d) => {
            for (let i = 0; i < 70; i++) d.params[`pad_${i}`] = 1;
            return d;
          },
        ],
        ['param name BAD', (d) => set(d, 'params.BadName!', 1)],
      ];
      const req = firstRequired(def.input);
      if (req) mutations.push([`missing required ${req}`, (d) => drop(d, `params.${req}`)]);
      // wrong-type mutation on the first declared param
      const p0 = Object.keys(def.input ?? {})[0];
      if (p0)
        mutations.push([`param ${p0} wrong type`, (d) => set(d, `params.${p0}`, { bogus: true })]);

      for (const [label, fn] of mutations) {
        stats.mutants++;
        let mutated = clone(base);
        const r = fn(mutated);
        if (r !== undefined) mutated = r;
        await t.test(`${name} ${aid}: ${label}`, () => {
          const sOk = schemaOk(mutated);
          const vOk = reqOk(mutated);
          if (!sOk && vOk) stats.schemaInvalidAndAccepted.push(`${name} ${aid}: ${label}`);
          assert.ok(!vOk, `validator accepted invalid request (${label})`);
        });
      }

      // Legal mutations — schema-valid by design, validator MUST accept.
      const legal = [
        ['app=1.0 (client still 1.0)', (d) => set(d, 'app', '1.0')],
        ['client extra member (schema-open)', (d) => set(d, 'client', { kind: 'agent', zzz: 1 })],
        ['context extra member (schema-open)', (d) => set(d, 'context', { zzz: 1 })],
      ];
      for (const [label, fn] of legal) {
        const mutated = clone(base);
        fn(mutated);
        await t.test(`${name} ${aid}: ${label}`, () => {
          assert.ok(reqOk(mutated), `validator rejected a legal request (${label})`);
        });
      }

      if (needsKey) {
        await t.test(`${name} ${aid}: missing idempotency key`, () => {
          assert.ok(!reqOk(base, { key: undefined }), 'sensitive action without key accepted');
        });
        await t.test(`${name} ${aid}: malformed idempotency key`, () => {
          assert.ok(!reqOk(base, { key: BAD_KEY }), 'malformed key accepted');
        });
      }
    }
  }
});

test('request fuzz summary', () => {
  console.error(
    `request fuzz: ${stats.actions} actions, ${stats.mutants} mutants, ` +
      `schema-invalid-but-accepted: ${stats.schemaInvalidAndAccepted.length}`,
  );
  for (const d of stats.schemaInvalidAndAccepted) console.error('  ', d);
});
