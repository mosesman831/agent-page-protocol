#!/usr/bin/env node
/**
 * Delegated-auth e2e (docs/specs/SPEC-AUTH.md) — raw HTTP against the demo
 * server in full mode. Covers discovery, all three grants, scope enforcement,
 * error codes, and WWW-Authenticate. Exit non-zero on failure.
 *
 * Usage: node demo/auth-run.mjs [--base http://127.0.0.1:8799]
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const BASE_ARG = args.includes('--base') ? args[args.indexOf('--base') + 1] : null;
const MEDIA = 'application/vnd.agent-page-action+json';

const RUN = `RUN${Math.floor(Math.random() * 1e6)}`;
let failures = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const act = (url, action, params, { token, idem, version, conf } = {}) =>
  fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': MEDIA,
      Origin: new URL(url).origin,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idem ? { 'X-APP-Idempotency-Key': idem } : {}),
      ...(version ? { 'X-APP-If-Match-Version': String(version) } : {}),
      ...(conf ? { 'X-APP-Confirmation': conf } : {}),
    },
    body: JSON.stringify({ app: '1.1', action, params: params ?? {} }),
  });

const tok = (BASE, id, secret, scope) =>
  fetch(`${BASE}/app-oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${id}&client_secret=${secret}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}`,
  });

async function main(BASE) {
  /* discovery */
  const wk = await (await fetch(`${BASE}/.well-known/agent-page`)).json();
  check(
    'well-known advertises token_endpoint',
    wk.state?.endpoints?.value?.token_endpoint?.value === `${BASE}/app-oauth/token`,
  );
  check(
    'well-known advertises scopes_supported',
    Array.isArray(wk.state?.scopes_supported?.value) &&
      wk.state.scopes_supported.value.some((n) => n.value === 'class:financial'),
  );

  /* client_credentials */
  const bad = await tok(BASE, 'agent-cli', 'wrong');
  check('bad client_secret → 401 invalid_client', bad.status === 401, String(bad.status));
  check('invalid_client code', (await bad.json()).error === 'app.err.auth.invalid_client');
  const noScope = await tok(BASE, 'agent-cli', 's3cret-agent', 'class:financial');
  check('scope outside allow-list → 400 invalid_scope', noScope.status === 400);
  const good = await tok(BASE, 'agent-cli', 's3cret-agent');
  const goodBody = await good.json();
  check('client_credentials → 200 + access_token', good.status === 200 && !!goodBody.access_token);
  check('token_type Bearer', goodBody.token_type === 'Bearer');
  check('default scope is allow-list', goodBody.scope === 'read class:safe class:identity');
  const agentToken = goodBody.access_token;

  /* no token → 401 + WWW-Authenticate */
  const unauth = await act(`${BASE}/app/lab/delegated`, 'touch', {}, { idem: `t-${RUN}` });
  const www = unauth.headers.get('www-authenticate') ?? '';
  check('touch without token → 401', unauth.status === 401, String(unauth.status));
  check('WWW-Authenticate Bearer present', /Bearer realm="app"/.test(www), www);

  /* bad token → 401 */
  const badTok = await act(
    `${BASE}/app/lab/delegated`,
    'touch',
    {},
    { token: 'garbage', idem: `g-${RUN}` },
  );
  check('garbage token → 401', badTok.status === 401, String(badTok.status));

  /* scoped token → success */
  const t = await act(
    `${BASE}/app/lab/delegated`,
    'touch',
    {},
    { token: agentToken, idem: `ok-${RUN}` },
  );
  check('touch with class:safe token → 200', t.status === 200, String(t.status));
  const tj = await t.json();
  check(
    'touch response is manifest',
    tj.page?.id === 'lab_delegated',
    JSON.stringify(tj).slice(0, 120),
  );
  const rq = await act(`${BASE}/app/lab/delegated`, 'read_status', {}, { token: agentToken });
  check('read_status with read scope → 200', rq.status === 200, String(rq.status));

  /* insufficient scope → 403 + scope hint */
  const fin = await act(
    `${BASE}/app/lab/delegated`,
    'charge',
    {},
    { token: agentToken, idem: `f-${RUN}` },
  );
  const finWww = fin.headers.get('www-authenticate') ?? '';
  check('charge with class:safe → 403', fin.status === 403, String(fin.status));
  check('insufficient_scope error name', /error="insufficient_scope"/.test(finWww), finWww);
  check('required scope hint class:financial', /scope="class:financial"/.test(finWww), finWww);
  const finBody = await fin.json();
  check(
    'envelope code insufficient_scope',
    finBody.error?.code === 'app.err.auth.insufficient_scope',
    JSON.stringify(finBody).slice(0, 200),
  );

  /* privileged client → charge ok (financial needs idempotency key) */
  const pay = await tok(BASE, 'pay-bot', 's3cret-pay');
  const payToken = (await pay.json()).access_token;
  const beforeCharge = await (
    await fetch(`${BASE}/app/lab/delegated`, {
      headers: { Accept: 'application/vnd.agent-page+json' },
    })
  ).json();
  const chargeIdem = `auth-e2e-${Date.now()}`;
  const chal = await act(
    `${BASE}/app/lab/delegated`,
    'charge',
    {},
    {
      token: payToken,
      idem: chargeIdem,
      version: beforeCharge.page?.version,
    },
  );
  const chalBody = await chal.json();
  const confTok = chalBody.error?.details?.confirmation_challenge?.value;
  check(
    'charge → 428 confirmation challenge',
    chal.status === 428 && !!confTok,
    `${chal.status} ${JSON.stringify(chalBody).slice(0, 160)}`,
  );
  const charged = await act(
    `${BASE}/app/lab/delegated`,
    'charge',
    {},
    {
      token: payToken,
      idem: chargeIdem,
      version: beforeCharge.page?.version,
      conf: confTok,
    },
  );
  check('charge confirmed → 200', charged.status === 200, String(charged.status));

  /* refresh grant */
  const r1 = await fetch(`${BASE}/app-oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${goodBody.refresh_token}`,
  });
  check('refresh grant → 200', r1.status === 200, String(r1.status));
  const r2 = await fetch(`${BASE}/app-oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${goodBody.refresh_token}`,
  });
  check('reused refresh → 400 invalid_grant', r2.status === 400, String(r2.status));

  /* authorization_code + PKCE: the authorize endpoint is a manifest */
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier, 'utf8').digest('base64url');
  const authzUrl =
    `${BASE}/app/oauth/authorize?response_type=code&client_id=agent-cli` +
    `&redirect_uri=${encodeURIComponent('https://agent.example/cb')}` +
    `&scope=${encodeURIComponent('read class:safe')}&state=xyz&code_challenge=${challenge}`;
  const authzPage = await fetch(authzUrl, {
    headers: { Accept: 'application/vnd.agent-page+json', 'X-APP-Accept-Versions': '1.1' },
  });
  const authzJson = await authzPage.json();
  check('authorize endpoint returns Page Manifest', authzJson.app === '1.1');
  check(
    'authorize page has authorize+deny actions',
    !!authzJson.actions?.authorize && !!authzJson.actions?.deny,
  );
  /* approve → navigate carries code */
  const approve = await act(authzUrl, 'authorize', {}, { idem: `authz-${Date.now()}` });
  const approveText = await approve.text();
  const approveJson = approveText ? JSON.parse(approveText) : {};
  const navUrl =
    approve.headers.get('location') ?? approveJson.navigation_effect?.url ?? approveJson.url ?? '';
  const code = navUrl.includes('code=') ? new URL(navUrl).searchParams.get('code') : null;
  check('authorize action → navigate with code', !!code, JSON.stringify(approveJson).slice(0, 200));
  /* exchange */
  const exch = await fetch(`${BASE}/app-oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      `grant_type=authorization_code&client_id=agent-cli` +
      `&redirect_uri=${encodeURIComponent('https://agent.example/cb')}` +
      `&code=${code}&code_verifier=${verifier}`,
  });
  check('code exchange → 200 + token', exch.status === 200, String(exch.status));
  const exchBody = await exch.json();
  check('exchanged token scope', exchBody.scope === 'read class:safe', exchBody.scope);
  const again = await fetch(`${BASE}/app-oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:
      `grant_type=authorization_code&client_id=agent-cli` +
      `&redirect_uri=${encodeURIComponent('https://agent.example/cb')}` +
      `&code=${code}&code_verifier=${verifier}`,
  });
  check('code reuse → 400 invalid_grant', again.status === 400, String(again.status));

  console.log(failures === 0 ? '\nauth e2e: all checks passed' : `\nauth e2e: ${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

if (BASE_ARG) {
  await main(BASE_ARG);
} else {
  const PORT = 8900 + Math.floor(Math.random() * 40);
  const base = `http://127.0.0.1:${PORT}`;
  const server = spawn(process.execPath, [join(ROOT, 'demo/serve.mjs')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    try {
      up = (await fetch(`${base}/.well-known/agent-page`)).ok;
    } catch {
      /* retry */
    }
    if (!up) await new Promise((r) => setTimeout(r, 200));
  }
  if (!up) {
    console.error('demo server did not start');
    server.kill();
    process.exit(1);
  }
  try {
    await main(base);
  } finally {
    server.kill();
  }
}
