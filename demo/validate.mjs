#!/usr/bin/env node
/**
 * Validates every demo manifest through BOTH wire-format implementations —
 * the same checks the extension-equivalence conformance test runs:
 *
 *   extension JS:  classifyDocument + validateManifest (extension/protocol/)
 *   packages TS:   isPageManifest + validateManifestState (dist builds)
 *
 * Requires `npm run build` (reads packages' dist/ output like the fixture generator).
 * Usage: npm run test:demo
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildBaPages } from './british-airways/pages.mjs';
import { buildHotelPages } from './hotel-booking/pages.mjs';
import { buildGcPages } from './google-classroom/pages.mjs';
import { buildMvaPages } from './multiversal/pages.mjs';
import { buildLabPages } from './protocol-lab/pages.mjs';
import { classifyDocument } from '../extension/protocol/parse.js';
import { validateManifest } from '../extension/protocol/validate.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'http://127.0.0.1:8788';

const { isPageManifest } = await import(join(HERE, '../packages/client/dist/index.js'));
const { validateManifestState } = await import(
  join(HERE, '../packages/conformance/dist/server/validate.js')
);

const SITES = {
  ba: buildBaPages(ORIGIN),
  hotel: buildHotelPages(ORIGIN),
  gc: buildGcPages(ORIGIN),
  lab: buildLabPages(ORIGIN),
  mva: buildMvaPages(ORIGIN),
};

let count = 0;
let failed = 0;
for (const [site, pages] of Object.entries(SITES)) {
  for (const [slug, doc] of pages) {
    count++;
    const tag = `${site}/${slug}`;
    const cls = classifyDocument(doc);
    if (cls.kind !== 'manifest') {
      console.error(`FAIL ${tag}: classifyDocument -> ${cls.kind}`);
      failed++;
      continue;
    }
    const js = validateManifest(doc);
    if (!js.ok) {
      console.error(`FAIL ${tag}: JS validateManifest -> ${js.message}`);
      failed++;
      continue;
    }
    if (!isPageManifest(doc)) {
      console.error(`FAIL ${tag}: TS isPageManifest -> false`);
      failed++;
      continue;
    }
    const stateErr = validateManifestState(doc.state);
    if (stateErr) {
      console.error(`FAIL ${tag}: validateManifestState -> ${JSON.stringify(stateErr)}`);
      failed++;
      continue;
    }
    console.log(`OK   ${tag} (${doc.page.id})`);
  }
}
console.log(`\ndemo manifests: ${count - failed}/${count} valid`);
process.exit(failed ? 1 : 0);
