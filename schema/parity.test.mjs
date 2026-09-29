/**
 * Wire-shape parity: every member of a wire-facing TS interface must be
 * declared in the matching JSON Schema, and every schema `required` field
 * must exist in the type. Interfaces are read with the TypeScript compiler
 * API (no regex guessing). Members tagged `@deprecated` are ignored.
 * The schema may legitimately declare fields no current interface emits —
 * the contract is a superset — but the inverse is a drift failure.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SOURCES = {
  client: join(ROOT, 'packages/client/src/types.ts'),
  server: join(ROOT, 'packages/server/src/types.ts'),
  clientConsent: join(ROOT, 'packages/client/src/consent.ts'),
  serverConsent: join(ROOT, 'packages/server/src/consent.ts'),
  clientIdentity: join(ROOT, 'packages/client/src/identity.ts'),
};

/** file -> interface name -> { members, required } */
function interfaceMembers(file, names) {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const wanted = new Set(names);
  const out = new Map();
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && wanted.has(node.name.text)) {
      const members = new Set();
      const required = new Set();
      for (const m of node.members) {
        if (!ts.isPropertySignature(m) || !m.name) continue;
        const name = ts.isIdentifier(m.name) || ts.isStringLiteral(m.name) ? m.name.text : null;
        if (!name) continue;
        const deprecated = (m.jsDoc ?? []).some((d) =>
          (d.tags ?? []).some((t) => t.tagName.text === 'deprecated'),
        );
        if (deprecated) continue;
        members.add(name);
        if (!m.questionToken) required.add(name);
      }
      out.set(node.name.text, { members, required });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

function collectProps(node) {
  const props = new Set();
  const required = new Set();
  if (node?.properties) for (const k of Object.keys(node.properties)) props.add(k);
  if (Array.isArray(node?.required)) for (const r of node.required) required.add(r);
  return { props, required };
}

function loadSchema(name) {
  return JSON.parse(readFileSync(join(HERE, name), 'utf8'));
}

/**
 * each: { schema, at?, client?, server?, clientSrc?, serverSrc?, tsOnly? }
 * - at: 'page' → properties.page; 'error' → properties.error;
 *   '$defs/X' → $defs.X
 * - client/server: interface name; absent = that side doesn't declare it
 * - src overrides choose which file an interface is read from
 * - tsOnly: fields the interface has that the wire never carries
 */
const PAIRS = [
  { schema: 'manifest.json', client: 'PageManifest', server: 'PageManifest' },
  { schema: 'manifest.json', at: 'page', client: 'PageInfo', server: 'PageInfo' },
  { schema: 'action-def.json', client: 'ActionDef', server: 'ActionDef' },
  { schema: 'error-envelope.json', client: 'ErrorEnvelope', server: 'ErrorEnvelope' },
  {
    schema: 'error-envelope.json',
    at: 'error',
    client: 'ErrorDetails',
    server: 'ErrorDetails',
  },
  { schema: 'navigation.json', client: 'Navigation', server: 'Navigation' },
  { schema: 'diff-document.json', client: 'DiffDocument', server: 'DiffDocument' },
  { schema: 'event.json', at: 'event', client: 'EventRecordBody', server: 'EventRecordBody' },
  { schema: 'challenge.json', client: 'ChallengeObject', server: 'ChallengeObject' },
  { schema: 'hold.json', client: 'HoldObject', server: 'HoldObject' },
  { schema: 'session.json', server: 'SessionStateValue' },
  {
    schema: 'consent.json',
    client: 'ConsentState',
    server: 'ConsentState',
    clientSrc: 'clientConsent',
    serverSrc: 'serverConsent',
  },
  {
    schema: 'flow.json',
    at: '$defs/catalogEntry',
    client: 'IdentityFlow',
    server: 'FlowCatalogEntry',
    clientSrc: 'clientIdentity',
    tsOnly: new Set(['id']), // client adds the map key as a field
  },
];

const ifaceCache = new Map();
function ifaces(srcKey, names) {
  if (!ifaceCache.has(srcKey)) ifaceCache.set(srcKey, new Map());
  const c = ifaceCache.get(srcKey);
  const missing = names.filter((n) => !c.has(n));
  if (missing.length) {
    for (const [k, v] of interfaceMembers(SOURCES[srcKey], missing)) c.set(k, v);
  }
  return c;
}

describe('schema ↔ types parity', () => {
  for (const pair of PAIRS) {
    const doc = loadSchema(pair.schema);
    let target = doc;
    if (pair.at === '$defs/catalogEntry') target = doc.$defs.catalogEntry;
    else if (pair.at) target = doc.properties[pair.at];
    const { props, required } = collectProps(target);

    for (const side of ['client', 'server']) {
      const iface = pair[side];
      if (!iface) continue;
      const srcKey = pair[`${side}Src`] ?? side;
      it(`${pair.schema}${pair.at ? ` ${pair.at}` : ''} vs ${side} ${iface}`, () => {
        const found = ifaces(srcKey, [iface]).get(iface);
        assert.ok(found, `${iface} not found in ${srcKey} sources`);
        const tsOnly = pair.tsOnly ?? new Set();
        const missing = [...found.members].filter((m) => !props.has(m) && !tsOnly.has(m));
        assert.deepEqual(
          missing.sort(),
          [],
          `${side} ${iface} members not declared in ${pair.schema}${pair.at ? ':' + pair.at : ''}`,
        );
        const reqMissing = [...required].filter((r) => !found.members.has(r));
        assert.deepEqual(
          reqMissing.sort(),
          [],
          `schema-required fields not present in ${side} ${iface}`,
        );
      });
    }
  }
});
