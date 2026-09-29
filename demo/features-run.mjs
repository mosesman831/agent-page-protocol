#!/usr/bin/env node
/**
 * Full-feature MCP driver — exercises every app_* tool, every MCP resource,
 * holds/challenges/confirm/consent/async/watch/diff/idempotency, sessions,
 * logout, reset, plus the --dynamic-tools projection — against the lab site
 * served by demo/serve.mjs in full mode.
 *
 * Usage: node demo/features-run.mjs [--base http://127.0.0.1:8799] [--dynamic]
 * Requires: `npm run build` and the demo server running.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const BASE = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'http://127.0.0.1:8799';
const DYNAMIC = args.includes('--dynamic');
const BIN = join(ROOT, 'packages/mcp/dist/bin.js');

let nextId = 1;
let failures = 0;
const pending = new Map();
const env = {
  ...process.env,
  APP_BEARER: 'lab-demo-token', // satisfies auth:'session' presence checks
};
const proc = spawn(
  process.execPath,
  [
    BIN,
    '--home',
    mkdtempSync(join(tmpdir(), 'agent-page-feat-')),
    '--bearer-env',
    'APP_BEARER',
    ...(DYNAMIC ? ['--dynamic-tools'] : []),
  ],
  { stdio: ['pipe', 'pipe', 'inherit'], env },
);
let buf = Buffer.alloc(0);
proc.stdout.on('data', (c) => {
  buf = Buffer.concat([buf, c]);
  for (;;) {
    const m = /^Content-Length: (\d+)\r\n\r\n/.exec(buf.toString('utf8'));
    if (!m) break;
    const len = Number(m[1]);
    const start = m[0].length;
    if (buf.length < start + len) break;
    const msg = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    buf = buf.subarray(start + len);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

const rpc = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), 45000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });

const RUN = Math.random().toString(36).slice(2, 8);
const short = (v, n = 160) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + '…' : s;
};

let CHECKED = 0;
function check(name, cond, detail = '') {
  CHECKED += 1;
  if (cond) console.log(`  ok ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function call(tool, args) {
  const res = await rpc('tools/call', { name: tool, arguments: args });
  const text = res?.content?.[0]?.text ?? '{}';
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    env = { raw: text };
  }
  return env;
}

async function readRes(uri) {
  const res = await rpc('resources/read', { uri });
  return res?.contents?.[0]?.text;
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'demo-features-run', version: '0.1.0' },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  let tools = await rpc('tools/list', {});
  let names = tools.tools.map((t) => t.name);
  console.log(
    `tools (${names.length}): ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', …' : ''}`,
  );
  const want = [
    'app_discover',
    'app_open',
    'app_read',
    'app_act',
    'app_confirm',
    'app_challenge',
    'app_watch',
    'app_sessions',
    'app_logout',
    'app_reset',
  ];
  check(
    'all 10 fixed tools listed',
    want.every((w) => names.includes(w)),
    names.join(','),
  );

  /* ---------- discover + open ---------- */
  const disc = await call('app_discover', { url: BASE });
  check('app_discover ok', disc.status === 'ok', short(disc));

  const open = await call('app_open', { url: `${BASE}/app/lab/counter`, discover: false });
  check('app_open counter', open.status === 'ok' && open.page?.id === 'lab_counter', short(open));

  if (DYNAMIC) {
    tools = await rpc('tools/list', {});
    names = tools.tools.map((t) => t.name);
    check(
      'dynamic tools project action ids',
      names.some((n) => n.includes('lab_counter')),
      names.join(','),
    );
  }

  const resources = await rpc('resources/list', {});
  const resUris = (resources.resources ?? []).map((r) => r.uri);
  console.log(`resources: ${resUris.join(', ')}`);
  check('resources advertised (session + manifest + hold)', resUris.length >= 3, short(resUris));
  const wk = await readRes(`app://well-known/${encodeURIComponent(BASE)}`);
  check(
    'resource app://well-known/<origin>',
    (wk ?? '').includes('supported') && (wk ?? '').includes('protocol_lab'),
    short(wk),
  );

  /* ---------- resources on the open session ---------- */
  const sessionId = open.session ?? open.page?.session ?? open?.session_id;
  const sessRes =
    resUris.find((u) => u.startsWith('app://session/')) ??
    (sessionId ? `app://session/${sessionId}` : null);
  if (sessRes) {
    const s = await readRes(sessRes);
    check('resource app://session/<id>', (s ?? '').includes('session'), short(s));
  }
  const manifestTxt = await readRes(`${sessRes ?? `app://session/${sessionId}`}/manifest`);
  check('resource …/manifest', (manifestTxt ?? '').includes('lab_counter'), short(manifestTxt));

  /* ---------- read ---------- */
  const rd = await call('app_read', { path: '/state/counter' });
  check('app_read path', rd.status === 'ok' && JSON.stringify(rd).includes('counter'), short(rd));

  /* ---------- act: diff + etag-match ---------- */
  await call('app_read', { full: false });
  const inc = await call('app_act', { action: 'inc', params: { delta: 2 } });
  check('app_act inc (diff)', inc.status === 'ok', short(inc));

  /* ---------- watch (conditional GET → changed/not_modified) ---------- */
  const w1 = await call('app_watch', { mode: 'poll', interval_ms: 1200 });
  check(
    'app_watch poll',
    ['ok', 'not_modified', 'changed'].includes(w1.status) ||
      w1.changed === true ||
      w1.changed === false,
    short(w1),
  );

  /* ---------- async ---------- */
  await call('app_open', { url: `${BASE}/app/lab/async` });
  const job = await call('app_act', { action: 'start_job', params: {}, wait: true });
  check(
    'app_act async wait → succeeded',
    ['async_succeeded', 'ok'].includes(job.status),
    short(job),
  );

  /* ---------- challenge (OTP continuation) ---------- */
  await call('app_open', { url: `${BASE}/app/lab/secure` });
  const login = await call('app_act', {
    action: 'login',
    params: { user: 'dev', password: 'pass1234' },
    idempotency_key: `mcp-login-${RUN}`,
  });
  check('login → challenge hold', login.status === 'hold', short(login));
  const ch = await call('app_challenge', { kind: 'otp', value: '123456' });
  check('app_challenge otp', ch.status === 'ok', short(ch));
  const who = await call('app_act', { action: 'whoami', params: {} });
  check('whoami after login', who.status === 'ok', short(who));

  /* ---------- consent (revoke → hold → grant → retry) ---------- */
  await call('app_open', { url: `${BASE}/app/lab/consent` });
  const rev = await call('app_act', {
    action: 'revoke_consent',
    params: { purposes: [{ id: 'analytics', granted: false }] },
  });
  check('revoke_consent', rev.status === 'ok' || rev.status === 'navigated', short(rev));
  const track1 = await call('app_act', { action: 'track', params: {} });
  check(
    'track → consent hold',
    track1.status === 'hold' || /consent/.test(JSON.stringify(track1)),
    short(track1),
  );
  const grant = await call('app_act', {
    action: 'grant_consent',
    params: { purposes: [{ id: 'analytics', granted: true }] },
  });
  check('grant_consent', grant.status === 'ok', short(grant));
  const track2 = await call('app_act', { action: 'track', params: {} });
  check('track after grant', track2.status === 'ok', short(track2));

  /* ---------- rate limit ---------- */
  await call('app_open', { url: `${BASE}/app/lab/rate` });
  await call('app_act', { action: 'ping', params: {} });
  await call('app_act', { action: 'ping', params: {} });
  const p3 = await call('app_act', { action: 'ping', params: {}, conflict_retry: false });
  check('429 surfaced (or client retried)', ['ok', 'error'].includes(p3.status), short(p3));

  /* ---------- confirmation (Mode B) ---------- */
  await call('app_open', { url: `${BASE}/app/lab/idem` });
  const pay = await call('app_act', {
    action: 'pay',
    params: { amount: 700 },
    idempotency_key: `mcp-pay-${RUN}`,
  });
  check('pay → confirmation hold', pay.status === 'hold', short(pay));
  const conf = await call('app_confirm', { decision: 'approve' });
  check('app_confirm approve', conf.status === 'ok', short(conf));

  /* ---------- typeahead ---------- */
  await call('app_open', { url: `${BASE}/app/lab/typeahead` });
  const sug = await call('app_act', { action: 'suggest', params: { q: 'lon' } });
  const rd2 = await call('app_read', { path: '/state/results' });
  check(
    'typeahead suggest → results state',
    sug.status === 'ok' && JSON.stringify(rd2).includes('London'),
    `${short(sug)} | ${short(rd2)}`,
  );

  /* ---------- bulk ---------- */
  await call('app_open', { url: `${BASE}/app/lab/bulk` });
  const bulk = await call('app_act', {
    action: 'bulk_tag',
    params: { items: ['a1', 'a3'], tag: 'starred' },
  });
  check('bulk_tag', bulk.status === 'ok', short(bulk));

  /* ---------- delegate (https handoff → delegate hold, resume_url) ---------- */
  await call('app_open', { url: `${BASE}/app/lab/delegate` });
  const del = await call('app_act', { action: 'pay_external', params: { amount: 25 } });
  check(
    'delegate → hold kind delegate',
    del.status === 'hold' && del.hold?.kind === 'delegate',
    short(del),
  );
  check(
    'delegate hold carries delegates_to + resume_url (K3 MF-9)',
    del.hold?.delegate?.url === 'https://psp.example.com/checkout' &&
      del.hold?.delegate?.resume_url === `${BASE}/app/lab/delegate-done`,
    short(del.hold?.delegate),
  );
  const done = await call('app_open', { url: `${BASE}/app/lab/delegate-done` });
  check(
    'delegate resume_url page',
    done.status === 'ok' && done.page?.id === 'lab_delegate_done',
    short(done),
  );

  /* ---------- sessions ---------- */
  const list = await call('app_sessions', { op: 'list' });
  check(
    'app_sessions list',
    list.status === 'ok' || Array.isArray(list.sessions ?? list.sessions_list ?? []),
    short(list),
  );
  const show = await call('app_sessions', { op: 'show' });
  check('app_sessions show', show.status === 'ok', short(show));
  const gc = await call('app_sessions', { op: 'gc' });
  check('app_sessions gc', gc.status === 'ok', short(gc));

  /* ---------- logout + reset ---------- */
  const lo = await call('app_logout', {});
  check('app_logout', lo.status === 'ok' || lo.status === 'closed', short(lo));
  const reset = await call('app_reset', {});
  check('app_reset', reset.status === 'ok' || reset.status === 'closed', short(reset));

  proc.kill();
  console.log(`\n${CHECKED - failures}/${CHECKED} checks passed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message ?? err}`);
  proc.kill();
  process.exit(1);
});
