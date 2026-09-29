#!/usr/bin/env node
/**
 * features-cli — exercises the CLI surface against a live demo server.
 * Spawned per command with an isolated --home; asserts exit codes and
 * JSON envelope shapes. Usage: node demo/features-cli.mjs --base URL
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const BASE = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:8788';
const RUN = Math.random().toString(36).slice(2, 8);

const home = mkdtempSync(join(tmpdir(), 'app-cli-'));

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ok ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function cli(args) {
  const r = spawnSync(
    process.execPath,
    [CLI, '--home', home, '--bearer-env', 'APP_BEARER', ...args],
    { env: { ...process.env, APP_BEARER: 'tok' }, encoding: 'utf8' },
  );
  let json = null;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    /* pretty mode / non-json output */
  }
  return {
    code: r.status ?? -1,
    json,
    out: r.stdout.trim().slice(0, 160),
    err: r.stderr.trim().slice(0, 160),
  };
}

console.log(`features-cli → ${BASE} (home ${home}, run ${RUN})\n`);

/* ---------- discover + open ---------- */
const dis = cli(['discover', BASE]);
check('discover', dis.code === 0 && dis.json?.ok === true, dis.out + dis.err);

const open = cli(['open', `${BASE}/app/lab/counter`]);
check('open counter', open.code === 0 && open.json?.page?.id === 'lab_counter', open.out);

const acts = cli(['actions']);
check(
  'actions list',
  acts.code === 0 && JSON.stringify(acts.json ?? acts.out).includes('inc'),
  acts.out,
);

/* ---------- act with --param ---------- */
const inc = cli(['act', 'inc', '--param', 'delta=3']);
check('act inc --param', inc.code === 0 && inc.json?.ok === true, inc.out + inc.err);

const st = cli(['state', '--path', '/state/counter']);
check('state --path', st.code === 0 && /value/.test(JSON.stringify(st.json ?? st.out)), st.out);

/* ---------- watch ---------- */
const w = cli(['watch', '--once']);
check('watch --once', w.code === 0 && w.json?.ok === true, w.out + w.err);

/* ---------- navigate ---------- */
const nav = cli(['navigate', `${BASE}/app/lab/home`]);
check('navigate home', nav.code === 0 && nav.json?.page?.id === 'lab_home', nav.out + nav.err);

/* ---------- challenge: login → hold → otp submit ---------- */
const sec = cli(['open', `${BASE}/app/lab/secure`]);
check('open secure', sec.code === 0 && sec.json?.page?.id === 'lab_secure', sec.out);

const login = cli(['act', 'login', '--param', 'user=demo', '--param', 'password=demo']);
check(
  'login → hold (exit 10-13)',
  login.code >= 10 &&
    login.code <= 13 &&
    login.json?.status === 'hold' &&
    login.json?.hold?.kind === 'otp',
  `exit=${login.code} ${login.out}`,
);

const otp = cli(['challenge', 'submit', '--kind', 'otp', '--value', '123456']);
check(
  'challenge submit otp',
  otp.code === 0 && otp.json?.ok === true,
  `exit=${otp.code} ${otp.out} ${otp.err}`,
);

/* ---------- confirm: financial pay ---------- */
const idem = cli(['open', `${BASE}/app/lab/idem`]);
check('open idem', idem.code === 0 && idem.json?.page?.id === 'lab_idem', idem.out);

const pay = cli([
  'act',
  'pay',
  '--params-json',
  `{"amount":25}`,
  '--idempotency-key',
  `cli-pay-${RUN}`,
]);
check(
  'pay → confirmation hold',
  pay.code >= 10 && pay.code <= 13 && JSON.stringify(pay.json ?? {}).includes('hold'),
  `exit=${pay.code} ${pay.out}`,
);

const conf = cli(['confirm', '--approve']);
check(
  'confirm --approve',
  conf.code === 0 && conf.json?.ok === true,
  `exit=${conf.code} ${conf.out} ${conf.err}`,
);

/* ---------- soft error ---------- */
const soft = cli(['open', `${BASE}/app/lab/soft`]);
check('open soft', soft.code === 0 && soft.json?.page?.id === 'lab_soft', soft.out);
const softAct = cli(['act', 'retry']);
check(
  'soft-error retry clears error',
  softAct.code === 0 && softAct.json?.ok === true,
  `exit=${softAct.code} ${softAct.out} ${softAct.err}`,
);

/* ---------- sessions / logout / reset ---------- */
const ls = cli(['sessions', 'list']);
check('sessions list', ls.code === 0 && JSON.stringify(ls.json ?? {}).includes('ses_'), ls.out);

const lo = cli(['logout']);
check('logout', lo.code === 0 && lo.json?.ok === true, `exit=${lo.code} ${lo.out}`);

const rs = cli(['reset']);
check('reset', rs.code === 0 && rs.json?.ok === true, `exit=${rs.code} ${rs.out}`);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
