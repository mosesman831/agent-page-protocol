#!/usr/bin/env node
// Validate APP documents against schema/*.json via Ajv (draft 2020-12).
//   node schema/check-documents.mjs               — full corpus: every manifest
//                                                   + every wire document
//   node schema/check-documents.mjs file.json     — validate file(s) as page manifests
//   node schema/check-documents.mjs -s <schema> file.json — against a named schema
import { readFile } from 'node:fs/promises';
import { loadCorpus, loadWireCorpus, loadValidator, describeErrors } from './corpus.mjs';
import { lintManifest } from './lint-manifest.mjs';

const { ajv } = await loadValidator();

let docs; // [name, schemaId|null (manifest default), doc]
let unreadable = 0;
const args = process.argv.slice(2);
if (args.length > 0) {
  let schemaId = 'page-manifest.json';
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-s' || args[i] === '--schema') {
      schemaId = args[++i];
    } else {
      files.push(args[i]);
    }
  }
  docs = await Promise.all(
    files.map(async (path) => {
      try {
        return [path, schemaId, JSON.parse(await readFile(path, 'utf8'))];
      } catch (err) {
        console.error(`FAIL ${path}: ${err.message}`);
        unreadable++;
        return [path, schemaId, null];
      }
    }),
  );
  docs = docs.filter(([, , doc]) => doc != null);
} else {
  docs = (await loadCorpus()).map(([name, doc]) => [name, 'page-manifest.json', doc]);
  docs.push(...(await loadWireCorpus()));
}

let failed = 0;
for (const [name, schemaId, doc] of docs) {
  const v = ajv.getSchema(schemaId);
  if (!v) {
    console.error(`FAIL ${name}: unknown schema ${schemaId}`);
    failed++;
    continue;
  }
  if (v(doc)) {
    if (schemaId === 'page-manifest.json') {
      const findings = lintManifest(doc, { name });
      const errors = findings.filter((f) => f.level === 'error');
      for (const f of findings) {
        console.error(`  ${f.level} ${f.rule} ${f.path}: ${f.message}`);
      }
      if (errors.length) {
        failed++;
        continue;
      }
    }
    console.log(`OK   ${name}`);
    continue;
  }
  failed++;
  console.error(`FAIL ${name}: ${describeErrors(v)}`);
}

if (failed > 0 || unreadable > 0) {
  console.error(
    `\n${failed + unreadable}/${docs.length + unreadable} documents failed schema validation`,
  );
  process.exit(1);
}
console.log(`\n${docs.length} documents valid`);
