/**
 * APP Delegated Auth (docs/specs/SPEC-AUTH.md).
 * Token issuance (client_credentials, authorization_code+PKCE, refresh_token),
 * HS256 compact-JWS access tokens, and authenticate/authorize hooks for
 * createPageHandler. No external deps — node:crypto only.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { generatePkcePair as _pkce } from './oauth.js';
import type { ActionDef } from './types.js';
import type { Request } from 'express';

export { _pkce as generatePkcePair };

/* ---------------- JWS (compact, HS256) ---------------- */

const b64u = (b: Buffer | string) =>
  (typeof b === 'string' ? Buffer.from(b, 'utf8') : b)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const unb64u = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export interface TokenClaims {
  iss: string;
  sub: string;
  aud: string;
  scope: string;
  iat: number;
  exp: number;
  jti: string;
  [k: string]: unknown;
}

export function signToken(claims: TokenClaims, secret: string): string {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  const sig = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  return `${h}.${p}.${b64u(sig)}`;
}

export function verifyToken(
  token: string,
  secret: string,
): { ok: true; claims: TokenClaims } | { ok: false; code: string; message: string } {
  const parts = token.split('.');
  const bad = (code: string, message: string) => ({ ok: false as const, code, message });
  if (parts.length !== 3) return bad('app.err.auth.invalid_token', 'Malformed token');
  const [h, p, s] = parts;
  let claims: TokenClaims;
  try {
    const header = JSON.parse(unb64u(h).toString('utf8')) as { alg?: string };
    if (header.alg !== 'HS256') return bad('app.err.auth.invalid_token', 'Unsupported alg');
    claims = JSON.parse(unb64u(p).toString('utf8')) as TokenClaims;
  } catch {
    return bad('app.err.auth.invalid_token', 'Malformed token');
  }
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const actual = unb64u(s);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return bad('app.err.auth.invalid_token', 'Bad signature');
  }
  if (typeof claims.exp === 'number' && Math.floor(Date.now() / 1000) >= claims.exp) {
    return bad('app.err.auth.expired', 'Access token expired');
  }
  return { ok: true, claims };
}

/* ---------------- scopes (§3, §6) ---------------- */

export function parseScopes(scope: string | string[] | undefined): Set<string> {
  if (!scope) return new Set();
  const list = Array.isArray(scope) ? scope : scope.split(/\s+/);
  return new Set(list.filter((s) => s.length > 0));
}

export function scopeCovers(scopes: Set<string>, actionId: string, actionDef: ActionDef): boolean {
  if (scopes.has('*')) return true;
  if (scopes.has(`act:${actionId}`)) return true;
  const effect = actionDef?.side_effect;
  if (typeof effect === 'string' && scopes.has(`class:${effect}`)) return true;
  if (actionDef?.kind === 'query' && scopes.has('read')) return true;
  return false;
}

export function requiredScopeHint(_actionId: string, actionDef: ActionDef): string {
  return actionDef?.kind === 'query' ? 'read' : `class:${actionDef?.side_effect ?? 'safe'}`;
}

/* ---------------- stores ---------------- */

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  scope: string;
  code_challenge: string;
  expiresAt: number;
  spent: boolean;
}

export interface RefreshRecord {
  token: string;
  client_id: string;
  scope: string;
  expiresAt: number;
}

export interface CodeStore {
  get(code: string): Promise<AuthCode | null>;
  set(code: AuthCode): Promise<void>;
}

export interface RefreshStore {
  get(token: string): Promise<RefreshRecord | null>;
  set(rec: RefreshRecord): Promise<void>;
  delete(token: string): Promise<void>;
}

export class MemoryCodeStore implements CodeStore {
  private readonly codes = new Map<string, AuthCode>();
  async get(code: string) {
    return this.codes.get(code) ?? null;
  }
  async set(code: AuthCode) {
    this.codes.set(code.code, code);
  }
}

export class MemoryRefreshStore implements RefreshStore {
  private readonly tokens = new Map<string, RefreshRecord>();
  async get(token: string) {
    return this.tokens.get(token) ?? null;
  }
  async set(rec: RefreshRecord) {
    this.tokens.set(rec.token, rec);
  }
  async delete(token: string) {
    this.tokens.delete(token);
  }
}

/* ---------------- auth server ---------------- */

export interface TokenRequest {
  grant_type?: string;
  client_id?: string;
  client_secret?: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
  scope?: string;
}

export interface TokenResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface ClientRegistration {
  /** Plain-text secret for comparison; hash at rest in production. */
  secret: string;
  scopes: string[];
}

export interface AuthServerOptions {
  secret: string;
  issuer: string;
  audience?: string;
  tokenTtlSec?: number;
  codeTtlSec?: number;
  refreshTtlSec?: number;
  clients: (id: string) => ClientRegistration | undefined;
  codeStore?: CodeStore;
  refreshStore?: RefreshStore;
}

export interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  scope: string;
  state?: string;
  code_challenge: string;
  /** Absolute URL of the authorize endpoint (page.url of the manifest). */
  authorization_url: string;
}

const oauthErr = (status: number, error: string, description?: string): TokenResponse => ({
  status,
  body: { error, ...(description ? { error_description: description } : {}) },
});

function parseBody(body: string | TokenRequest): TokenRequest {
  if (typeof body === 'object') return body;
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as TokenRequest;
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(trimmed)) as TokenRequest;
}

export function createAuthServer(opts: AuthServerOptions) {
  const {
    secret,
    issuer,
    audience = issuer,
    tokenTtlSec = 300,
    codeTtlSec = 60,
    refreshTtlSec = 30 * 24 * 3600,
    clients,
  } = opts;
  const codes = opts.codeStore ?? new MemoryCodeStore();
  const refresh = opts.refreshStore ?? new MemoryRefreshStore();

  const issue = async (sub: string, scope: string): Promise<TokenResponse> => {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signToken(
      {
        iss: issuer,
        sub,
        aud: audience,
        scope,
        iat: now,
        exp: now + tokenTtlSec,
        jti: randomBytes(12).toString('base64url'),
      },
      secret,
    );
    const refresh_token = randomBytes(24).toString('base64url');
    await refresh.set({
      token: refresh_token,
      client_id: sub,
      scope,
      expiresAt: (now + refreshTtlSec) * 1000,
    });
    return {
      status: 200,
      body: {
        access_token,
        token_type: 'Bearer',
        expires_in: tokenTtlSec,
        scope,
        refresh_token,
      },
    };
  };

  const checkClient = (id: string | undefined, sec: string | undefined) => {
    if (!id || !sec) return null;
    const reg = clients(id);
    if (!reg) return null;
    const a = Buffer.from(sec);
    const b = Buffer.from(reg.secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return reg;
  };

  const narrowScope = (
    requested: string | undefined,
    allowed: string[],
  ): { ok: true; scope: string } | { ok: false } => {
    if (!requested) return { ok: true, scope: allowed.join(' ') };
    const req = parseScopes(requested);
    const allow = new Set(allowed);
    if (allow.has('*')) return { ok: true, scope: [...req].join(' ') };
    for (const s of req) if (!allow.has(s)) return { ok: false };
    return { ok: true, scope: [...req].join(' ') };
  };

  async function handleTokenRequest(body: string | TokenRequest): Promise<TokenResponse> {
    const r = parseBody(body);
    switch (r.grant_type) {
      case 'client_credentials': {
        const reg = checkClient(r.client_id, r.client_secret);
        if (!reg || !r.client_id) return oauthErr(401, 'app.err.auth.invalid_client');
        const sc = narrowScope(r.scope, reg.scopes);
        if (!sc.ok) return oauthErr(400, 'app.err.auth.invalid_scope');
        return issue(r.client_id, sc.scope);
      }
      case 'authorization_code': {
        const rec = r.code ? await codes.get(r.code) : null;
        if (!rec || rec.spent || Date.now() > rec.expiresAt) {
          return oauthErr(400, 'app.err.auth.invalid_grant');
        }
        if (rec.client_id !== r.client_id || rec.redirect_uri !== r.redirect_uri) {
          return oauthErr(400, 'app.err.auth.invalid_grant');
        }
        // PKCE S256: B64URL(SHA256(verifier)) must equal the stored challenge
        const actual = b64u(
          createHash('sha256')
            .update(r.code_verifier ?? '', 'utf8')
            .digest(),
        );
        if (actual !== rec.code_challenge) {
          return oauthErr(400, 'app.err.auth.invalid_grant');
        }
        rec.spent = true;
        await codes.set(rec);
        return issue(rec.client_id, rec.scope);
      }
      case 'refresh_token': {
        const rec = r.refresh_token ? await refresh.get(r.refresh_token) : null;
        if (!rec || Date.now() > rec.expiresAt) {
          return oauthErr(400, 'app.err.auth.invalid_grant');
        }
        await refresh.delete(rec.token); // rotation
        return issue(rec.client_id, rec.scope);
      }
      default:
        return oauthErr(400, 'app.err.auth.unsupported_grant');
    }
  }

  function mintCode(p: {
    client_id: string;
    redirect_uri: string;
    scope: string;
    code_challenge: string;
  }): string {
    const code = randomBytes(24).toString('base64url');
    void codes.set({
      code,
      client_id: p.client_id,
      redirect_uri: p.redirect_uri,
      scope: p.scope,
      code_challenge: p.code_challenge,
      expiresAt: Date.now() + codeTtlSec * 1000,
      spent: false,
    });
    return code;
  }

  /** The authorize endpoint is itself a Page Manifest (§4.2) — APP dogfoods. */
  function authorizeManifest(p: AuthorizeParams) {
    const str = (value: string, label?: string) => ({
      type: 'string' as const,
      value,
      ...(label ? { label } : {}),
    });
    return {
      app: '1.1',
      page: {
        id: 'oauth_authorize',
        url: p.authorization_url,
        title: 'Authorize agent access',
        version: 'auth-1',
      },
      state: {
        client_id: str(p.client_id, 'Requesting agent'),
        requested_scopes: {
          type: 'array' as const,
          label: 'Requested permissions',
          value: [...parseScopes(p.scope)].map((s) => str(s)),
        },
        redirect_uri: str(p.redirect_uri, 'Returns to'),
        // Server-internal grant parameters the authorize/deny handlers read
        // back on dispatch — carried in state so the page is self-contained.
        authz_params: {
          type: 'object' as const,
          label: 'Authorization request',
          value: {
            client_id: str(p.client_id),
            redirect_uri: str(p.redirect_uri),
            scope: str(p.scope),
            state: str(p.state ?? ''),
            code_challenge: str(p.code_challenge),
          },
        },
      },
      actions: {
        authorize: {
          description: 'Grant the requested scopes and issue an authorization code',
          kind: 'mutate' as const,
          side_effect: 'safe' as const,
        },
        deny: {
          description: 'Deny access and return without granting scopes',
          kind: 'mutate' as const,
          side_effect: 'safe' as const,
        },
      },
    };
  }

  async function authenticate(
    req: Request,
  ): Promise<
    | { ok: true; claims: TokenClaims }
    | { ok: false; code: string; message?: string; scope?: string }
  > {
    const auth = req.headers?.authorization;
    const raw = Array.isArray(auth) ? auth[0] : auth;
    if (!raw || !raw.startsWith('Bearer ')) {
      return { ok: false, code: 'app.err.auth.required', message: 'Bearer token required' };
    }
    const v = verifyToken(raw.slice(7), secret);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
    return { ok: true, claims: v.claims };
  }

  async function authorize(
    req: Request,
    actionId: string,
    actionDef: ActionDef,
  ): Promise<{ ok: true } | { ok: false; code: string; message?: string; scope?: string }> {
    const a = await authenticate(req);
    if (!a.ok) return a;
    const scopes = parseScopes(a.claims.scope);
    if (!scopeCovers(scopes, actionId, actionDef)) {
      return {
        ok: false,
        code: 'app.err.auth.insufficient_scope',
        message: `Action ${actionId} requires ${requiredScopeHint(actionId, actionDef)}`,
        scope: requiredScopeHint(actionId, actionDef),
      };
    }
    return { ok: true };
  }

  return { handleTokenRequest, mintCode, authorizeManifest, authenticate, authorize, issue };
}
