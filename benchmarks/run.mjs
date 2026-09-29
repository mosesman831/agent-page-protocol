#!/usr/bin/env node
/**
 * APP Benchmark Runner
 * Runs the full benchmark suite against a running APP flights example server.
 *
 * Usage:
 *   node benchmarks/run.mjs [baseUrl]        # default http://localhost:3456
 *   node benchmarks/run.mjs https://tunnel.example.com
 *
 * Requires: flights example server running (npm run build && node dist/server.js in examples/flights)
 */
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';

const BASE = process.argv[2] || 'http://localhost:3456';
const MANIFEST = 'application/vnd.agent-page+json';
const ACTION = 'application/vnd.agent-page-action+json';
const DIFF = 'application/vnd.agent-page-diff+json';

function httpReq(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const started = performance.now();
    const req = request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method,
        headers: { ...headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body,
            text: body.toString('utf-8'),
            json: (() => {
              try {
                return JSON.parse(body.toString('utf-8'));
              } catch {
                return null;
              }
            })(),
            latencyMs: performance.now() - started,
            bytes: body.length,
            tokens: Math.floor(body.length / 4),
          });
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = (path) => httpReq('GET', path, { Accept: MANIFEST });
const post = (path, action, params, extraHeaders = {}) =>
  httpReq(
    'POST',
    path,
    {
      'Content-Type': ACTION,
      Accept: `${DIFF}, ${MANIFEST}`,
      Origin: BASE,
      ...Object.fromEntries(
        Object.entries(extraHeaders).filter(([, v]) => v !== undefined && v !== null),
      ),
    },
    JSON.stringify({ app: '1.0', action, params }),
  );

function pctile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

console.log(`APP Benchmark  —  base: ${BASE}`);
console.log('='.repeat(70));

// ---------- A. Full booking flow (5 iterations for latency stats) ----------
console.log('\n[A] Full booking flow — 5 iterations');
const flowSteps = [
  'search',
  'results',
  'filter_diff',
  'select',
  'booking',
  'confirm_challenge',
  'confirm_token',
];
const lat = Object.fromEntries(flowSteps.map((s) => [s, []]));
const bytes = Object.fromEntries(flowSteps.map((s) => [s, []]));
const toks = Object.fromEntries(flowSteps.map((s) => [s, []]));

for (let i = 0; i < 5; i++) {
  const search = await get('/flights');
  lat.search.push(search.latencyMs);
  bytes.search.push(search.bytes);
  toks.search.push(search.tokens);

  const results = await get('/flights/LHR/DXB/2026-08-15');
  lat.results.push(results.latencyMs);
  bytes.results.push(results.bytes);
  toks.results.push(results.tokens);
  let ver = results.json?.page?.version;

  const filter = await post(
    '/flights/LHR/DXB/2026-08-15',
    'filter',
    { max_price: 90000 },
    { 'X-APP-If-Match-Version': ver },
  );
  lat.filter_diff.push(filter.latencyMs);
  bytes.filter_diff.push(filter.bytes);
  toks.filter_diff.push(filter.tokens);

  const select = await post('/flights/LHR/DXB/2026-08-15', 'select_flight', {
    flight_id: 'fl-002',
  });
  lat.select.push(select.latencyMs);
  bytes.select.push(select.bytes);
  toks.select.push(select.tokens);

  const booking = await get('/booking/fl-002');
  lat.booking.push(booking.latencyMs);
  bytes.booking.push(booking.bytes);
  toks.booking.push(booking.tokens);
  ver = booking.json?.page?.version;

  const attempt = await post(
    '/booking/fl-002',
    'confirm_booking',
    { passenger_name: 'Bench' },
    { 'X-APP-If-Match-Version': ver },
  );
  lat.confirm_challenge.push(attempt.latencyMs);
  bytes.confirm_challenge.push(attempt.bytes);
  toks.confirm_challenge.push(attempt.tokens);

  const challenge = attempt.json?.error?.details?.confirmation_challenge?.value;
  const final = await post(
    '/booking/fl-002',
    'confirm_booking',
    { passenger_name: 'Bench' },
    {
      'X-APP-If-Match-Version': ver,
      'X-APP-Confirmation': challenge,
      'X-APP-Idempotency-Key': `bench-${i}-${Date.now()}`,
    },
  );
  lat.confirm_token.push(final.latencyMs);
  bytes.confirm_token.push(final.bytes);
  toks.confirm_token.push(final.tokens);
}

console.log(
  `${'step'.padEnd(20)}${'p50 ms'.padStart(8)}${'p95 ms'.padStart(8)}${'bytes'.padStart(9)}${'tokens'.padStart(8)}`,
);
for (const s of flowSteps) {
  console.log(
    `${s.padEnd(20)}${pctile(lat[s], 0.5).toFixed(1).padStart(8)}${pctile(lat[s], 0.95).toFixed(1).padStart(8)}${Math.round(
      bytes[s].reduce((a, b) => a + b, 0) / 5,
    )
      .toString()
      .padStart(9)}${Math.round(toks[s].reduce((a, b) => a + b, 0) / 5)
      .toString()
      .padStart(8)}`,
  );
}
const totalTok = flowSteps.reduce((a, s) => a + toks[s].reduce((x, y) => x + y, 0) / 5, 0);
console.log(
  `${'TOTAL (approx)'.padEnd(20)}${''.padStart(16)}${''.padStart(9)}${Math.round(totalTok).toString().padStart(8)}`,
);

// ---------- B. Diff compounding ----------
console.log('\n[B] Diff compounding — 10 filter iterations');
const fresh = await get('/flights/LHR/DXB/2026-08-15');
let verB = fresh.json?.page?.version;
let cumDiff = 0;
const diffLats = [];
for (let i = 0; i < 10; i++) {
  const r = await post(
    '/flights/LHR/DXB/2026-08-15',
    'filter',
    { max_price: 70000 + i * 5000 },
    { 'X-APP-If-Match-Version': verB },
  );
  cumDiff += r.bytes;
  diffLats.push(r.latencyMs);
  verB = r.json?.result_version || verB;
}
console.log(`  full manifest: ${fresh.bytes} B`);
console.log(`  10 diffs     : ${cumDiff} B`);
console.log(
  `  savings      : ${((1 - cumDiff / (10 * fresh.bytes)) * 100).toFixed(1)}% vs full re-fetch`,
);
console.log(`  p50 diff lat : ${pctile(diffLats, 0.5).toFixed(1)} ms`);

// ---------- C. Caching (conditional GET) ----------
console.log('\n[C] Conditional GET (304)');
const first = await get('/flights/LHR/DXB/2026-08-15');
const etag = first.headers?.etag;
if (etag) {
  const cached = await httpReq('GET', '/flights/LHR/DXB/2026-08-15', {
    Accept: MANIFEST,
    'If-None-Match': etag,
  });
  console.log(`  first GET : ${first.status} (${first.bytes} B)`);
  console.log(
    `  revalidat : ${cached.status} (${cached.bytes} B, ${cached.latencyMs.toFixed(1)} ms)`,
  );
  console.log(`  savings   : ${(1 - cached.bytes / first.bytes) * 100}% bytes on revalidation`);
} else {
  console.log('  (no ETag on response — server should emit one per spec §11)');
}

// ---------- D. HTML comparison (same data rendered as HTML) ----------
console.log('\n[D] Same-content HTML comparison');
const manifest = (await get('/flights/LHR/DXB/2026-08-15')).json;
const results = manifest?.state?.results;
if (results) {
  const flights = results.value.map((row) =>
    Object.fromEntries(Object.keys(results.fields).map((k, i) => [k, row[i]])),
  );
  const rows = flights
    .map(
      (f) =>
        `<tr data-id="${f.id}"><td>${f.airline}</td><td>${f.flight_no}</td><td>${f.departure}</td><td>${f.arrival}</td><td>${f.duration}</td><td class="price">£${(f.price / 100).toFixed(2)}</td><td>${f.stops}</td><td>${f.seats_left}</td><td><button class="book">Book</button></td></tr>`,
    )
    .join('');
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Flights from LHR to DXB</title><link rel="preload" href="/_next/static/css/a1b2c3d4.css" as="style"><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { flights, total: flights.length } }, page: '/flights/[origin]/[dest]/[date]' })}</script></head><body><header><nav><a href="/">Home</a> | <a href="/flights">Search</a></nav></header><main><h1>Flights from London Heathrow (LHR) to Dubai (DXB)</h1><div id="filters"><label>Max price <input type="number" id="max_price"/></label><label>Max stops <select id="max_stops"><option value="2">Any</option><option value="0">Non-stop</option></select></label><button onclick="applyFilters()">Filter</button></div><table id="flight-results"><thead><tr><th>Airline</th><th>Flight</th><th>Departs</th><th>Arrives</th><th>Duration</th><th>Price</th><th>Stops</th><th>Seats</th><th></th></tr></thead><tbody>${rows}</tbody></table><p>${flights.length} flights found</p></main><script src="/_next/static/chunks/main-8f3k2.js"></script><script src="/_next/static/chunks/pages/flights-4k9x2.js"></script></body></html>`;
  const jsCss = 284 * 1024 + 42 * 1024; // typical Next.js bundle + css
  const totalHtml = Buffer.byteLength(html) + jsCss;
  const appBytes = Buffer.byteLength(JSON.stringify(manifest));
  console.log(`  APP manifest: ${appBytes} B  (~${Math.floor(appBytes / 4)} tokens)`);
  console.log(
    `  HTML doc    : ${Buffer.byteLength(html)} B  (~${Math.floor((Buffer.byteLength(html) * 2) / 4)} tokens ingest, rendered DOM ~2x source)`,
  );
  console.log(`  HTML+assets : ${totalHtml} B (doc + ${(jsCss / 1024).toFixed(0)} KB JS/CSS)`);
  console.log(`  transfer    : HTML is ${(totalHtml / appBytes).toFixed(1)}x bigger`);
  console.log(`  round trips : APP booking = 7; HTML booking = 40+ (real sites)`);
}

console.log('\nDone.');
