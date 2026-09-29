// Shared validator + document corpus for schema checks.
// Used by check-documents.mjs (CLI) and documents.test.mjs (node:test).
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCHEMA_DIR = join(ROOT, 'schema');
// Loopback origin: HTTP is legal only on loopback (v0.4 §3.3.3); the corpus
// never performs network I/O on this address — it exists for URL shape.
const ORIGIN = 'http://127.0.0.1:8788';

export async function loadValidator() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  // Register every schema file by its $id so $refs between files resolve.
  for (const dir of [SCHEMA_DIR, join(SCHEMA_DIR, 'tool')]) {
    for (const f of (await readdir(dir)).filter((f) => f.endsWith('.json'))) {
      ajv.addSchema(JSON.parse(await readFile(join(dir, f), 'utf8')));
    }
  }
  const validate = ajv.getSchema('page-manifest.json');
  if (!validate) throw new Error('page-manifest.json schema not registered');
  return { ajv, validate };
}

// Unwrap a state-node value into the logical document it carries:
// {type:'object', value:{id:{type:'string',value:'x'}}} -> {id:'x'}.
// Logical-value schemas (consent, session, challenge, features, …) describe
// the unwrapped shape, not the wire nodes.
export function unwrap(node) {
  if (
    node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    'type' in node &&
    'value' in node
  ) {
    return unwrap(node.value);
  }
  if (Array.isArray(node)) return node.map(unwrap);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = unwrap(v);
    return out;
  }
  return node;
}

// [name, document] for every manifest the repo produces.
export async function loadCorpus() {
  const docs = [];
  const { buildBaPages } = await import('../demo/british-airways/pages.mjs');
  const { buildHotelPages } = await import('../demo/hotel-booking/pages.mjs');
  const { buildGcPages } = await import('../demo/google-classroom/pages.mjs');
  const { buildLabPages } = await import('../demo/protocol-lab/pages.mjs');
  for (const [site, pages] of [
    ['ba', buildBaPages(ORIGIN)],
    ['hotel', buildHotelPages(ORIGIN)],
    ['gc', buildGcPages(ORIGIN)],
    ['protocol-lab', buildLabPages(ORIGIN)],
  ]) {
    for (const [slug, doc] of pages) docs.push([`demo/${site}/${slug}`, doc]);
  }

  const FIXTURES = join(ROOT, 'extension', '.harness', 'fixtures');
  // extras.json is intentionally non-conformant (bare `image: 5`, non-node
  // `status`) to test renderer robustness — excluded on purpose.
  const SKIP = new Set(['extras.json']);
  for (const f of (await readdir(FIXTURES))
    .filter((f) => f.endsWith('.json') && !SKIP.has(f))
    .sort()) {
    docs.push([`fixtures/${f}`, JSON.parse(await readFile(join(FIXTURES, f), 'utf8'))]);
  }

  // Deployed manifests: the protocol landing site (deploy/protocol-site) is
  // itself an APP page — validate what we ship, not just what we demo.
  const DEPLOY = join(ROOT, 'deploy', 'protocol-site', 'data');
  for (const f of (await readdir(DEPLOY)).filter((f) => f.endsWith('.json')).sort()) {
    docs.push([`deploy/protocol-site/${f}`, JSON.parse(await readFile(join(DEPLOY, f), 'utf8'))]);
  }
  return docs;
}

export function describeErrors(validate) {
  return (validate.errors || [])
    .slice(0, 5)
    .map((e) => `${e.instancePath || '/'} ${e.message} (${e.schemaPath})`)
    .join('; ');
}

/**
 * Wire corpus: [name, schemaId, doc] for the non-manifest schemas — real
 * documents produced by the real code paths, captured live:
 *  - HTTP against demo/full-server.mjs (Express + @agent-page/server dist)
 *  - hold/challenge/session/consent objects via the shipped builders
 *  - tool/* artifacts written by a real `app` CLI run into a temp --home
 * Requires `npm run build` first (packages dist output). The npm test chain
 * runs build before test:schema; run `npm run build` once for standalone use.
 */
export async function loadWireCorpus() {
  // NOTE: must be async spawn — spawnSync blocks the loop and the in-process
  // server could never answer the CLI's HTTP requests (deadlock).
  const { spawn } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { createServer: createProbe } = await import('node:http');
  const { createFullDemoApp } = await import('../demo/full-server.mjs');
  const { buildLabPages } = await import('../demo/protocol-lab/pages.mjs');
  const { wellKnownManifest } = await import('../demo/lib/discovery.mjs');

  const docs = [];
  // Page origin is bound into manifest page.url at build time and CSRF checks
  // Origin against it — so reserve the port first, then build with it.
  const probe = await new Promise((resolve) => {
    const s = createProbe();
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const origin = `http://127.0.0.1:${port}`;
  const sites = { lab: buildLabPages(origin) };
  const app = await createFullDemoApp({ sites, origin });

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const base = origin;

  const H = {
    'Content-Type': 'application/vnd.agent-page-action+json',
    'X-APP-Accept-Versions': '1.1, 1.0',
    'X-APP-Client': 'schema-corpus/1.0',
    'X-APP-Origin': base,
    Origin: base,
  };
  const get = (p, headers = {}) => fetch(`${base}${p}`, { headers: { ...H, ...headers } });
  const post = (p, body, headers = {}) =>
    fetch(`${base}${p}`, {
      method: 'POST',
      headers: { ...H, ...headers },
      body: JSON.stringify(body),
    });

  try {
    // action-request: the bodies clients actually send
    const incReq = {
      app: '1.1',
      action: 'inc',
      params: { delta: 1 },
      client: { kind: 'test', name: 'schema-corpus', version: '1.0' },
    };
    docs.push(['wire/action-request inc', 'action-request.json', incReq]);

    // diff-document: GET for the page version (If-Match), then negotiate diff
    const counter = await (await get('/app/lab/counter')).json();
    docs.push(['wire/page counter', 'page-manifest.json', counter]);
    const incRes = await post('/app/lab/counter', incReq, {
      Accept: 'application/vnd.agent-page-diff+json',
      'X-APP-Idempotency-Key': 'corpus-inc-1',
      'X-APP-If-Match-Version': counter.page.version,
    });
    docs.push(['wire/diff inc', 'diff-document.json', await incRes.json()]);

    // error-envelope: param validation failure
    const badRes = await post('/app/lab/counter', {
      app: '1.1',
      action: 'inc',
      params: { bogus: 'x' },
      client: { kind: 'test', name: 'schema-corpus' },
    });
    docs.push(['wire/error unknown_param', 'error-envelope.json', await badRes.json()]);

    // event record: the inc above pushed a state.changed event
    const evRes = await get('/app-events?mode=longpoll', {
      Accept: 'application/vnd.agent-page-event+json',
    });
    const evBody = evRes.status === 200 ? await evRes.json() : null;
    if (evBody && evBody.event) docs.push(['wire/event state.changed', 'event.json', evBody]);

    // consent logical value: object node at state.consent
    const consentManifest = await (await get('/app/lab/consent')).json();
    docs.push(['wire/consent value', 'consent.json', unwrap(consentManifest.state.consent)]);

    // OTP challenge: login without otp -> 428 challenge_required
    const loginRes = await post(
      '/app/lab/secure',
      {
        app: '1.1',
        action: 'login',
        params: { user: 'demo', password: 'x' },
        client: { kind: 'test', name: 'schema-corpus' },
      },
      { 'X-APP-Idempotency-Key': 'corpus-login' },
    );
    const loginBody = await loginRes.json();
    docs.push(['wire/error challenge_required', 'error-envelope.json', loginBody]);
    const chNode = loginBody?.error?.details?.challenge;
    if (chNode) docs.push(['wire/challenge value', 'challenge.json', unwrap(chNode)]);

    // features logical value from the well-known discovery manifest
    docs.push([
      'wire/features value',
      'features.json',
      unwrap(wellKnownManifest(base).state.features),
    ]);

    // v1.0 projection: negotiate 1.0-only and capture what the server
    // actually emits (1.1-only state/param types must be projected away)
    for (const slug of ['showcase', 'consent', 'secure', 'home']) {
      const res = await get(`/app/lab/${slug}`, {
        'X-APP-Accept-Versions': '1.0',
      });
      const doc = await res.json();
      docs.push([`wire/v10 ${slug}`, 'page-manifest.json', doc]);
    }

    // hold object via the real issueHold path (SPEC §7)
    const { MemoryHoldStore, issueHold, holdToObject } = await import('@agent-page/server');
    const holds = new MemoryHoldStore();
    const issued = await issueHold(holds, {
      identityKey: 'corpus',
      actionId: 'pay',
      kind: 'captcha',
      verifyUrl: `${base}/verify`,
      widgetUrl: `${base}/widget`,
      ttlMs: 60_000,
    });
    if (issued.ok) docs.push(['wire/hold object', 'hold.json', holdToObject(issued.record)]);

    // session logical value via the flights example's own builder
    const { buildSessionStateNode } = await import('../examples/flights/dist/sessions.js');
    docs.push([
      'wire/session value',
      'session.json',
      unwrap(
        buildSessionStateNode({
          id: 'ses_corpus',
          status: 'authenticated',
          email: 'demo@example.com',
          subjectRef: 'sub_demo',
          accessToken: 'at',
          refreshToken: 'rt',
          resumeToken: 'rs',
          expiresAt: new Date(Date.now() + 3600e3).toISOString(),
          refreshAt: new Date(Date.now() + 1800e3).toISOString(),
          epoch: 1,
          consent: { analytics: true },
          consentVersion: 'v1',
        }),
      ),
    ]);

    // flow: meta.flow on the flights login manifest
    const { buildLoginManifest } = await import('../examples/flights/dist/pages/login.js');
    const loginManifest = buildLoginManifest(base, undefined);
    if (loginManifest?.meta?.flow) {
      docs.push(['wire/flow value', 'flow.json', unwrap(loginManifest.meta.flow)]);
    }

    // tool/*: artifacts a real CLI run writes under --home
    const home = mkdtempSync(join(tmpdir(), 'app-corpus-cli-'));
    writeFileSync(join(home, 'config.json'), JSON.stringify({ output: 'json', top_k: 10 }));
    const cli = (args) =>
      new Promise((resolve, reject) => {
        const p = spawn(
          process.execPath,
          [
            join(ROOT, 'packages/cli/dist/bin.js'),
            '--home',
            home,
            '--bearer-env',
            'APP_BEARER',
            ...args,
          ],
          { env: { ...process.env, APP_BEARER: 'tok' } },
        );
        p.on('close', (code) => resolve(code));
        p.on('error', reject);
      });
    await cli(['open', `${base}/app/lab/idem`]);
    await cli(['act', 'pay', '--param', 'amount=10']); // hold -> holds/*.json
    const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
    const first = (dir, re) =>
      existsSync(join(home, dir))
        ? readdirSync(join(home, dir))
            .filter((f) => re.test(f))
            .map((f) => join(home, dir, f))[0]
        : undefined;
    const sessFile = first('sessions', /^ses_.*\.json$/);
    const holdFile = first('holds', /\.json$/);
    const cacheFile = first('cache', /\.json$/);
    if (sessFile)
      docs.push(['tool/session.json (cli open)', 'tool/session.json', readJson(sessFile)]);
    if (holdFile)
      docs.push(['tool/hold-file.json (cli hold)', 'tool/hold-file.json', readJson(holdFile)]);
    if (cacheFile)
      docs.push([
        'tool/cache-entry.json (cli cache)',
        'tool/cache-entry.json',
        readJson(cacheFile),
      ]);
    docs.push([
      'tool/index.json (cli open)',
      'tool/index.json',
      readJson(join(home, 'index.json')),
    ]);
    docs.push(['tool/config.json', 'tool/config.json', readJson(join(home, 'config.json'))]);

    // The reference server: examples/flights emits real manifests over HTTP.
    // Boot it in-process on a second port and capture every GET-only route.
    const flightsProbe = await new Promise((resolve) => {
      const s = createProbe();
      s.listen(0, '127.0.0.1', () => resolve(s));
    });
    const flightsPort = flightsProbe.address().port;
    await new Promise((r) => flightsProbe.close(r));
    const flightsOrigin = `http://127.0.0.1:${flightsPort}`;
    const { createApp } = await import('../examples/flights/dist/server.js');
    const flightsApp = createApp({ PORT: String(flightsPort), PAGE_ORIGIN: flightsOrigin });
    const flightsServer = await new Promise((resolve, reject) => {
      const s = flightsApp.listen(flightsPort, '127.0.0.1', () => resolve(s));
      s.once('error', reject);
    });
    try {
      const fget = (p) => fetch(`${flightsOrigin}${p}`, { headers: { 'X-APP-Client': 'corpus' } });
      for (const [name, route] of [
        ['search', '/flights'],
        ['results', '/flights/LHR/JFK/2026-10-01?pax=2'],
        ['booking', '/booking/fl-001'],
        ['login', '/login'],
        ['logout', '/logout'],
        ['consent', '/consent'],
        ['order unpaid', '/orders/ord-demo-unpaid'],
        ['order pay', '/orders/ord-demo-unpaid/pay'],
        ['order cancel', '/orders/ord-demo-cancel'],
        ['well-known', '/.well-known/agent-page'],
      ]) {
        const res = await fget(route);
        if (res.status !== 200) continue;
        const doc = await res.json();
        docs.push([`flights/${name}`, 'page-manifest.json', doc]);
      }
    } finally {
      flightsServer.closeAllConnections?.();
      await new Promise((r) => flightsServer.close(r));
    }
  } finally {
    // fetch keep-alive sockets keep the listener alive otherwise
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }

  return docs;
}
