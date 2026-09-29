#!/usr/bin/env node
// Parse every schema JSON file and assert $schema is draft 2020-12.
// Usage: node schema/validate-schemas.mjs
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DRAFT = '2020-12';

async function walk(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walk(p)));
    else if (ent.isFile() && ent.name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = (await walk(ROOT)).sort();
if (files.length === 0) {
  console.error('No schema JSON files found under', ROOT);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const rel = relative(ROOT, file);
  let data;
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    console.error(`FAIL ${rel}: invalid JSON (${err.message})`);
    failed++;
    continue;
  }
  const schema = data.$schema;
  if (typeof schema !== 'string' || !schema.includes(DRAFT)) {
    console.error(`FAIL ${rel}: $schema must include ${DRAFT}, got ${JSON.stringify(schema)}`);
    failed++;
    continue;
  }
  console.log(`OK   ${rel}`);
}

if (failed > 0) {
  console.error(`\n${failed} schema file(s) failed`);
  process.exit(1);
}
console.log(`\n${files.length} schema file(s) ok (draft ${DRAFT})`);
