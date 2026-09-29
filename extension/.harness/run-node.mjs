/**
 * Node driver for the skin harness (runs under `npm test`).
 *
 * Serves the repo root on an ephemeral loopback port, loads
 * extension/.harness/index.html for every vector in both document-mount and
 * closed-shadow mounts (plus the reduced-motion variants), and collects the
 * `PASS|FAIL <vector> <assertion>` lines the harness writes into #verdict.
 * The page's top-level await holds the `load` event until all assertions ran,
 * so waitUntil:'load' yields a complete verdict.
 *
 * Exits non-zero if any FAIL line appears or a run produces no verdict.
 * Requires the puppeteer-bundled Chrome (`npm ci` installs it).
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PAGE_PATH = '/extension/.harness/index.html';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
      }
      const body = await readFile(path);
      res.writeHead(200, {
        'content-type': MIME[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const RUNS = [
  ...['V-SKIN-1', 'V-SKIN-2', 'V-SKIN-3', 'V-SKIN-4', 'V-SKIN-5', 'V-SKIN-6', 'V-SKIN-C'].flatMap(
    (v) => [
      { query: `v=${v}`, label: v },
      { query: `v=${v}&shadow=1`, label: `${v} shadow` },
    ],
  ),
  { query: 'v=V-SKIN-5&rm=1', label: 'V-SKIN-5 reduced', reducedMotion: true },
  { query: 'v=V-SKIN-4&rm=1', label: 'V-SKIN-4 reduced', reducedMotion: true },
];

async function main() {
  const server = await serve();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}${PAGE_PATH}`;
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });

  let failures = 0;
  let passes = 0;
  try {
    for (const { query, label, reducedMotion } of RUNS) {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 960, height: 1080 });
        if (reducedMotion) {
          await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        }
        await page.goto(`${base}?${query}`, { waitUntil: 'load', timeout: 30_000 });
        // the harness module writes #verdict once, after every assertion ran; a
        // module's top-level await does NOT hold the window load event, so poll
        // (string form: this expression is evaluated in the page, not Node)
        await page.waitForFunction(
          `document.getElementById('verdict')?.textContent?.includes('page errors')`,
          { timeout: 30_000 },
        );
        const text = await page.$eval('#verdict', (el) => el.textContent ?? '');
        const lines = text.split('\n').filter(Boolean);
        if (lines.length === 0) {
          console.log(`FAIL ${label} no harness output`);
          failures++;
        }
        for (const line of lines) {
          console.log(line.startsWith('FAIL') ? `${line} [${label}]` : line);
          if (line.startsWith('FAIL')) failures++;
          else if (line.startsWith('PASS')) passes++;
        }
      } catch (e) {
        console.log(`FAIL ${label} driver error: ${e.message}`);
        failures++;
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log(`harness: ${passes} passed, ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
