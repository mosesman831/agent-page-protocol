/**
 * Delegated-auth conformance vectors (docs/specs/SPEC-AUTH.md).
 * Written before the implementation — each `it` is a vector.
 */
import { describe, it, expect } from 'vitest';
import {
  signToken,
  verifyToken,
  createAuthServer,
  scopeCovers,
  parseScopes,
  requiredScopeHint,
  generatePkcePair,
  type TokenRequest,
} from '../src/auth-server.js';
import type { ActionDef } from '../src/types.js';

const SECRET = 'test-secret-0123456789abcdef';
const CLIENTS = {
  'agent-cli': { secret: 's3cret-client', scopes: ['read', 'class:safe', 'act:whoami'] },
  'pay-bot': { secret: 's3cret-pay', scopes: ['read', 'class:safe', 'class:financial'] },
};

const QUERY_ACTION = {
  kind: 'query',
  side_effect: 'safe',
  description: 'q',
} as unknown as ActionDef;
const SAFE_ACTION = {
  kind: 'mutate',
  side_effect: 'safe',
  description: 'm',
} as unknown as ActionDef;
const FIN_ACTION = {
  kind: 'mutate',
  side_effect: 'financial',
  description: 'pay',
} as unknown as ActionDef;

const cred = (id: string, secret: string, scope = '') =>
  `grant_type=client_credentials&client_id=${id}&client_secret=${secret}` +
  (scope ? `&scope=${encodeURIComponent(scope)}` : '');

function server(over: Partial<Parameters<typeof createAuthServer>[0]> = {}) {
  return createAuthServer({
    secret: SECRET,
    issuer: 'https://demo.test',
    clients: (id) => (CLIENTS as Record<string, { secret: string; scopes: string[] }>)[id],
    ...over,
  });
}

async function tokenReq(srv: ReturnType<typeof server>, body: string | TokenRequest) {
  return srv.handleTokenRequest(typeof body === 'string' ? body : body);
}

describe('token sign/verify (§5)', () => {
  it('round-trips a signed token', () => {
    const tok = signToken(
      {
        iss: 'https://demo.test',
        sub: 'agent-cli',
        aud: 'o',
        scope: 'read',
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: 'j',
      },
      SECRET,
    );
    const claims = verifyToken(tok, SECRET);
    expect(claims.ok && claims.claims.sub).toBe('agent-cli');
  });
  it('rejects a tampered payload', () => {
    const tok = signToken(
      {
        iss: 'x',
        sub: 'a',
        aud: 'o',
        scope: '*',
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: 'j',
      },
      SECRET,
    );
    const [h, , s] = tok.split('.');
    expect(
      verifyToken(`${h}.${Buffer.from('{"scope":"*"}').toString('base64url')}.${s}`, SECRET).ok,
    ).toBe(false);
  });
  it('rejects a wrong secret', () => {
    const tok = signToken(
      {
        iss: 'x',
        sub: 'a',
        aud: 'o',
        scope: 'read',
        iat: 0,
        exp: Math.floor(Date.now() / 1000) + 3600,
        jti: 'j',
      },
      SECRET,
    );
    expect(verifyToken(tok, 'other-secret').ok).toBe(false);
  });
  it('rejects expired tokens (exp honored)', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const tok = signToken(
      { iss: 'x', sub: 'a', aud: 'o', scope: 'read', iat: 0, exp: past, jti: 'j' },
      SECRET,
    );
    const r = verifyToken(tok, SECRET);
    expect(!r.ok && r.code === 'app.err.auth.expired').toBe(true);
  });
});

describe('token endpoint — client_credentials (§4.1)', () => {
  it('issues a scoped token for a registered client', async () => {
    const srv = server();
    const r = await tokenReq(srv, cred('agent-cli', 's3cret-client', 'read class:safe'));
    expect(r.status).toBe(200);
    expect(r.body.access_token).toBeTypeOf('string');
    expect(r.body.token_type).toBe('Bearer');
    expect(r.body.scope).toBe('read class:safe');
    expect(r.body.expires_in).toBeGreaterThan(0);
  });
  it('rejects a bad client secret → invalid_client 401', async () => {
    const r = await tokenReq(server(), cred('agent-cli', 'wrong'));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('app.err.auth.invalid_client');
  });
  it('rejects an unknown client → invalid_client 401', async () => {
    const r = await tokenReq(server(), cred('nobody', 'x'));
    expect(r.status).toBe(401);
    expect(r.body.error).toBe('app.err.auth.invalid_client');
  });
  it('rejects scope outside client allowed set → invalid_scope 400', async () => {
    const r = await tokenReq(server(), cred('agent-cli', 's3cret-client', 'class:financial'));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('app.err.auth.invalid_scope');
  });
  it('empty scope request grants the client default scope set', async () => {
    const r = await tokenReq(server(), cred('agent-cli', 's3cret-client'));
    expect(r.status).toBe(200);
    expect(r.body.scope).toBe('read class:safe act:whoami');
  });
  it('rejects an unknown grant → unsupported_grant 400', async () => {
    const r = await tokenReq(server(), 'grant_type=password&client_id=x');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('app.err.auth.unsupported_grant');
  });
});

describe('scope enforcement (§6)', () => {
  it('parses and covers: read covers query actions', () => {
    expect(scopeCovers(parseScopes('read'), 'whoami', QUERY_ACTION)).toBe(true);
  });
  it('read does not cover mutates', () => {
    expect(scopeCovers(parseScopes('read'), 'mut', SAFE_ACTION)).toBe(false);
  });
  it('class:safe covers side_effect=safe actions', () => {
    expect(scopeCovers(parseScopes('class:safe'), 'mut', SAFE_ACTION)).toBe(true);
  });
  it('class:safe does not cover financial', () => {
    expect(scopeCovers(parseScopes('class:safe'), 'pay', FIN_ACTION)).toBe(false);
  });
  it('act:<id> covers exactly that action', () => {
    expect(scopeCovers(parseScopes('act:whoami'), 'whoami', SAFE_ACTION)).toBe(true);
    expect(scopeCovers(parseScopes('act:whoami'), 'other', SAFE_ACTION)).toBe(false);
  });
  it('* covers everything', () => {
    expect(scopeCovers(parseScopes('*'), 'pay', FIN_ACTION)).toBe(true);
  });
  it('requiredScopeHint names the scope needed', () => {
    expect(requiredScopeHint('pay', FIN_ACTION)).toBe('class:financial');
    expect(requiredScopeHint('whoami', QUERY_ACTION)).toBe('read');
  });
});

describe('authorization_code + PKCE (§4.2)', () => {
  it('authorize manifest is a manifest with authorize/deny actions', async () => {
    const srv = server();
    const m = srv.authorizeManifest({
      client_id: 'agent-cli',
      redirect_uri: 'https://agent.example/cb',
      scope: 'read',
      state: 'st',
      code_challenge: 'ch',
      authorization_url: 'https://demo.test/app-oauth/authorize',
    });
    expect(m.app).toBe('1.1');
    expect(Object.keys(m.actions ?? {})).toEqual(expect.arrayContaining(['authorize', 'deny']));
    expect(m.state?.requested_scopes?.value?.length).toBeGreaterThan(0);
  });
  it('full code flow: mint → exchange → usable token', async () => {
    const srv = server();
    const { verifier, challenge } = generatePkcePair();
    const code = srv.mintCode({
      client_id: 'agent-cli',
      redirect_uri: 'https://agent.example/cb',
      scope: 'read',
      code_challenge: challenge,
    });
    const r = await tokenReq(server(), {
      grant_type: 'authorization_code',
      client_id: 'agent-cli',
      code,
      redirect_uri: 'https://agent.example/cb',
      code_verifier: verifier,
    } as TokenRequest);
    // fresh server() lost the code store — mint on the same server
    void r;
    const srv2 = server();
    const code2 = srv2.mintCode({
      client_id: 'agent-cli',
      redirect_uri: 'https://agent.example/cb',
      scope: 'read',
      code_challenge: challenge,
    });
    const r2 = await srv2.handleTokenRequest({
      grant_type: 'authorization_code',
      client_id: 'agent-cli',
      code: code2,
      redirect_uri: 'https://agent.example/cb',
      code_verifier: verifier,
    } as TokenRequest);
    expect(r2.status).toBe(200);
    expect(r2.body.access_token).toBeTypeOf('string');
  });
  it('rejects wrong verifier → invalid_grant', async () => {
    const srv = server();
    const { challenge } = generatePkcePair();
    const code = srv.mintCode({
      client_id: 'agent-cli',
      redirect_uri: 'https://agent.example/cb',
      scope: 'read',
      code_challenge: challenge,
    });
    const r = await srv.handleTokenRequest({
      grant_type: 'authorization_code',
      client_id: 'agent-cli',
      code,
      redirect_uri: 'https://agent.example/cb',
      code_verifier: 'WRONG-verifier-0123456789abcdef0123456789abcdef',
    } as TokenRequest);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('app.err.auth.invalid_grant');
  });
  it('rejects code reuse → invalid_grant', async () => {
    const srv = server();
    const { verifier, challenge } = generatePkcePair();
    const code = srv.mintCode({
      client_id: 'agent-cli',
      redirect_uri: 'https://agent.example/cb',
      scope: 'read',
      code_challenge: challenge,
    });
    const req = {
      grant_type: 'authorization_code',
      client_id: 'agent-cli',
      code,
      redirect_uri: 'https://agent.example/cb',
      code_verifier: verifier,
    } as TokenRequest;
    await srv.handleTokenRequest(req);
    const r = await srv.handleTokenRequest(req);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('app.err.auth.invalid_grant');
  });
});

describe('refresh_token (§4.3)', () => {
  it('rotates: old refresh rejected after use', async () => {
    const srv = server();
    const r1 = await tokenReq(srv, cred('agent-cli', 's3cret-client', 'read'));
    expect(r1.body.refresh_token).toBeTypeOf('string');
    const r2 = await srv.handleTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: r1.body.refresh_token,
    } as TokenRequest);
    expect(r2.status).toBe(200);
    const r3 = await srv.handleTokenRequest({
      grant_type: 'refresh_token',
      refresh_token: r1.body.refresh_token,
    } as TokenRequest);
    expect(r3.status).toBe(400);
    expect(r3.body.error).toBe('app.err.auth.invalid_grant');
  });
});

describe('authenticate/authorize hooks', () => {
  it('no header → auth.required', async () => {
    const srv = server();
    const r = await srv.authenticate({ headers: {} } as never);
    expect(!r.ok && r.code === 'app.err.auth.required').toBe(true);
  });
  it('valid bearer → authorize covers class:safe, rejects financial', async () => {
    const srv = server();
    const tok = await tokenReq(srv, cred('agent-cli', 's3cret-client'));
    const req = { headers: { authorization: `Bearer ${tok.body.access_token}` } } as never;
    const a = await srv.authenticate(req);
    expect(a.ok).toBe(true);
    const azSafe = await srv.authorize(req, 'mut', SAFE_ACTION);
    expect(azSafe.ok).toBe(true);
    const azFin = await srv.authorize(req, 'pay', FIN_ACTION);
    expect(!azFin.ok && azFin.code === 'app.err.auth.insufficient_scope').toBe(true);
  });
  it('expired bearer → auth.expired', async () => {
    const srv = server({ tokenTtlSec: -1 });
    const tok = await tokenReq(srv, cred('agent-cli', 's3cret-client'));
    const a = await srv.authenticate({
      headers: { authorization: `Bearer ${tok.body.access_token}` },
    } as never);
    expect(!a.ok && a.code === 'app.err.auth.expired').toBe(true);
  });
});
