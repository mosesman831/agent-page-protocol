#!/usr/bin/env node
/**
 * MCP agent driver for the demo sites. Spawns `packages/mcp/dist/bin.js`
 * (the agent-page-mcp stdio server) and walks the British Airways booking
 * flow end-to-end over MCP tools/call — discover → open → act → confirm —
 * printing each envelope. Exits non-zero if any step fails.
 *
 * Usage: node demo/agent-run.mjs [--base http://127.0.0.1:8788]
 * Requires: `npm run build` (packages/mcp/dist) and the demo server running.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:8788';

const BIN = join(ROOT, 'packages/mcp/dist/bin.js');
// Fresh --home per run: the runtime persists sessions on disk, and a stale
// session pinned to another origin makes app_open fail session_origin_mismatch.
const HOME = mkdtempSync(join(tmpdir(), 'agent-page-demo-'));
let nextId = 1;
let failures = 0;
const pending = new Map();
const proc = spawn(process.execPath, [BIN, '--home', HOME], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
let buf = Buffer.alloc(0);

proc.stdout.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
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

function rpc(method, params) {
  const id = nextId++;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      if (msg.error) reject(new Error(`${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    });
  });
}

const short = (v) => {
  const s = JSON.stringify(v);
  return s.length > 140 ? s.slice(0, 140) + '…' : s;
};

async function call(tool, args) {
  console.log(`→ ${tool} ${short(args)}`);
  const res = await rpc('tools/call', { name: tool, arguments: args });
  const text = res?.content?.[0]?.text ?? '{}';
  let env;
  try {
    env = JSON.parse(text);
  } catch {
    env = { raw: text };
  }
  const page = env.page ? `page=${env.page.id ?? env.page.url}` : '';
  const extra =
    env.status === 'error'
      ? ` ${env.error?.code}: ${env.error?.message}`
      : env.status === 'hold'
        ? ` hold=${short(env.hold?.reason ?? env.hold?.kind ?? '')}`
        : '';
  console.log(`← status=${env.status ?? env.raw ?? '?'} ${page}${extra}`);
  if (env.status === 'error') failures += 1;
  return env;
}

async function main() {
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'demo-agent-run', version: '0.1.0' },
  });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

  const tools = await rpc('tools/list', {});
  console.log(`tools: ${tools.tools.map((t) => t.name).join(', ')}`);

  await call('app_discover', { url: BASE });
  await call('app_open', { url: `${BASE}/app/ba/home` });
  await call('app_act', {
    action: 'search_flights',
    params: {
      from: 'lhr',
      to: 'jfk',
      depart: '2026-10-12',
      return_date: '2026-10-19',
      cabin: 'economy',
      adults: '1',
      trip_type: 'return',
    },
  });
  await call('app_act', { action: 'select_outbound' });
  await call('app_act', { action: 'select_return' });
  await call('app_act', { action: 'choose_fare' });
  await call('app_act', { action: 'pick_seat', params: { seat: '14A' } });
  await call('app_act', { action: 'continue_passengers' });
  await call('app_act', {
    action: 'save_passengers',
    params: {
      title: 'mr',
      given_name: 'Alex',
      family_name: 'Demo',
      dob: '1990-06-15',
      nationality: 'gb',
      passport_no: '512345678',
      passport_expiry: '2031-01-01',
      issuing_country: 'gb',
      email: 'alex.demo@example.com',
      phone: '+447700900123',
    },
  });
  const pay = await call('app_act', {
    action: 'pay',
    params: {
      card_number: '4111111111111111',
      expiry: '12/29',
      cvv: '123',
      name_on_card: 'ALEX DEMO',
      billing_country: 'gb',
      billing_postcode: 'SW1A 1AA',
      accept_terms: true,
    },
  });
  if (pay.status === 'hold') {
    await call('app_confirm', { decision: 'approve' });
  } else {
    failures += 1;
    console.log('!! pay did not produce a confirmation hold');
  }
  const read = await call('app_read', {});
  const pnr = read?.digest?.state?.pnr?.value?.booking_reference?.value;
  if (read?.page?.id === 'ba_confirmation' && pnr) {
    console.log(`\nBOOKED — reference ${pnr}`);
  } else {
    failures += 1;
    console.log(`\nFAIL: expected ba_confirmation with pnr, got ${short(read)}`);
  }
  await call('app_sessions', { op: 'list' });
  await call('app_logout', {});

  proc.kill();
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`FAIL: ${err.message ?? err}`);
  proc.kill();
  process.exit(1);
});
