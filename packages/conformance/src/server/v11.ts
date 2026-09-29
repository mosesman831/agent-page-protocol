/**
 * APP 1.1 conformance fixtures (SPEC §27). Custom routes so TV-01..60 stay on 1.0.
 */

import type { Application, Request, Response } from 'express';
import {
  MEDIA_PAGE,
  MEDIA_ERROR,
  HEADER_APP_VERSION,
  HEADER_APP_RESPONSE_MODE,
  HEADER_APP_ACCEPT_VERSIONS,
  HEADER_APP_CONFIRMATION,
  HEADER_APP_CLIENT,
  HEADER_APP_IF_MATCH_VERSION,
  buildErrorEnvelope,
  isAllowedAppUrlScheme,
  type PageManifest,
  type StateNode,
} from '@agent-page/server';
import type { ConformanceState, V11Challenge, V11Hold, V11Session } from './state.js';
import {
  PAGE_HOST,
  pageUrl,
  wellKnown11,
  wellKnown10From11,
  wellKnown10Only,
  strNode,
  numNode,
  boolNode,
  enumNode,
} from './fixtures.js';
import {
  MEDIA_EVENT_STREAM,
  HEADER_APP_CHALLENGE,
  HEADER_APP_HOLD_TOKEN,
  HEADER_APP_RESUME,
  HEADER_SET_APP_RESUME,
  HEADER_APP_ACCESS_TOKEN,
  HEADER_APP_REFRESH_TOKEN,
  HEADER_APP_ACCESS_TOKEN_TTL,
  selectProtocolVersion,
  negotiateV11,
  type WireVersion,
} from './v11-types.js';

type PageDoc = Omit<PageManifest, 'app' | 'page' | 'state' | 'actions'> & {
  app: string;
  page: PageManifest['page'] & { focus?: string; time_zone?: string };
  state: Record<string, unknown>;
  actions?: Record<string, unknown>;
};

const OTP_OK = '123456';
const MAX_LOGIN_FAILS = 5;
const PASSWORD_OK = 'correct-horse';

type Json = Record<string, unknown>;

function selectedVersion(req: Request, supported: readonly string[] = ['1.0', '1.1']): WireVersion {
  const sel = selectProtocolVersion({
    acceptVersions: header(req, HEADER_APP_ACCEPT_VERSIONS),
    xAppVersion: header(req, HEADER_APP_VERSION),
    supported,
  });
  if (sel.none) return '1.0';
  return sel.selected === '1.1' ? '1.1' : '1.0';
}

function header(req: Request, name: string): string | undefined {
  const v = req.header(name);
  return v ?? undefined;
}

function cookieValue(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie ?? '';
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(raw);
  return m?.[1];
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  opts: {
    app?: WireVersion;
    path?: string;
    details?: Record<string, StateNode>;
    recoverable_actions?: string[];
    retry_after_ms?: number;
    message_id?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): void {
  const app = opts.app ?? '1.1';
  const env = buildErrorEnvelope(code, {
    message,
    httpStatus: status,
    request_id: 'conf11',
    path: opts.path,
    details: opts.details,
    recoverable_actions: opts.recoverable_actions,
    retry_after_ms: opts.retry_after_ms,
  });
  (env as { app: string }).app = app;
  if (opts.message_id) (env.error as { message_id?: string }).message_id = opts.message_id;
  for (const [k, v] of Object.entries(opts.extraHeaders ?? {})) res.setHeader(k, v);
  res
    .status(status)
    .type(MEDIA_ERROR)
    .setHeader(HEADER_APP_RESPONSE_MODE, 'error')
    .setHeader(HEADER_APP_VERSION, app)
    .setHeader('Cache-Control', 'no-store');
  if (status === 429 || status === 403) {
    if (opts.retry_after_ms != null) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(opts.retry_after_ms / 1000))));
    }
  }
  res.json(env);
}

function sendManifest(
  res: Response,
  manifest: PageDoc,
  status = 200,
  extra: Record<string, string> = {},
): void {
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
  res
    .status(status)
    .type(MEDIA_PAGE)
    .setHeader(HEADER_APP_RESPONSE_MODE, 'full')
    .setHeader(HEADER_APP_VERSION, manifest.app)
    .setHeader('Cache-Control', extra['Cache-Control'] ?? 'no-store');
  if (manifest.page.etag) res.setHeader('ETag', manifest.page.etag);
  res.json(manifest);
}

function parseAction(req: Request): { app?: string; action?: string; params: Json } {
  const body = (req.body ?? {}) as Json;
  const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Json;
  return {
    app: typeof body.app === 'string' ? body.app : undefined,
    action: typeof body.action === 'string' ? body.action : undefined,
    params,
  };
}

function newId(prefix: string): string {
  const rnd = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  return `${prefix}_${rnd}`;
}

function sessionStatusNode(status: string): StateNode {
  return {
    type: 'object',
    label: 'Session',
    value: {
      status: enumNode(status, [
        'anonymous',
        'pending_mfa',
        'authenticated',
        'expired',
        'locked',
        'pending_consent',
      ]),
    },
  };
}

function challengeNode(ch: V11Challenge): StateNode {
  return {
    type: 'object',
    label: 'Challenge',
    value: {
      id: strNode(ch.id),
      kind: enumNode(ch.kind, [
        'otp',
        'totp',
        'webauthn',
        'magic_link',
        'password',
        'backup_code',
        'push',
      ]),
      channel: enumNode(
        ch.kind === 'webauthn' ? 'passkey' : ch.kind === 'magic_link' ? 'email' : 'sms',
        ['sms', 'email', 'totp', 'authenticator_push', 'passkey', 'backup_code', 'voice'],
      ),
      expires_at: { type: 'datetime', value: new Date(ch.expiresAt).toISOString() },
      ttl_ms: numNode(Math.max(0, ch.expiresAt - Date.now())),
      attempts_remaining: numNode(ch.attemptsRemaining),
      max_attempts: numNode(ch.maxAttempts),
      mask: strNode('+44 ••••••421'),
      length: numNode(6),
      pattern: strNode('^[0-9]{6}$'),
      param: strNode(ch.param ?? 'otp'),
    },
  };
}

function issueChallenge(
  state: ConformanceState,
  email: string,
  opts: { expired?: boolean; kind?: V11Challenge['kind']; sessionId?: string } = {},
): V11Challenge {
  const ttl = opts.expired ? -1000 : 300_000;
  const ch: V11Challenge = {
    id: newId('chg'),
    kind: opts.kind ?? 'otp',
    email,
    otp: OTP_OK,
    attemptsRemaining: 3,
    maxAttempts: 5,
    expiresAt: Date.now() + ttl,
    spent: false,
    sessionId: opts.sessionId,
  };
  state.v11.challenges.set(ch.id, ch);
  return ch;
}

function createSession(
  state: ConformanceState,
  email: string,
  status: V11Session['status'],
): V11Session {
  const id = newId('sess');
  const family = newId('fam');
  const sess: V11Session = {
    id,
    email,
    status,
    access: `at_${id}`,
    refresh: `rt_${family}_1`,
    family,
    resume: `resume_${id}`,
    createdAt: Date.now(),
  };
  state.v11.sessions.set(id, sess);
  state.v11.accessToSession.set(sess.access, id);
  state.v11.refreshToSession.set(sess.refresh, id);
  state.v11.resumeToSession.set(sess.resume, id);
  return sess;
}

function resolveSession(req: Request, state: ConformanceState): V11Session | undefined {
  const sid = cookieValue(req, 'session');
  if (sid) {
    const s = state.v11.sessions.get(sid);
    if (s) return s;
  }
  const auth = req.headers.authorization;
  const m = typeof auth === 'string' ? /^Bearer\s+(\S+)$/i.exec(auth) : null;
  if (m?.[1]) {
    const id = state.v11.accessToSession.get(m[1]);
    if (id) return state.v11.sessions.get(id);
  }
  const resume = header(req, HEADER_APP_RESUME);
  if (resume) {
    const id = state.v11.resumeToSession.get(resume);
    if (id) return state.v11.sessions.get(id);
  }
  return undefined;
}

function authHeaders(sess: V11Session): Record<string, string> {
  return {
    'Set-Cookie': `session=${sess.id}; Path=/; HttpOnly; SameSite=Lax`,
    [HEADER_SET_APP_RESUME]: `${sess.resume}; ttl=3600`,
    [HEADER_APP_ACCESS_TOKEN]: sess.access,
    [HEADER_APP_REFRESH_TOKEN]: sess.refresh,
    [HEADER_APP_ACCESS_TOKEN_TTL]: '3600',
    'Cache-Control': 'no-store',
  };
}

function loginPage(port: number, sess?: V11Session, ch?: V11Challenge): PageDoc {
  const status = sess?.status ?? 'anonymous';
  const state: Record<string, StateNode> = {
    session: sessionStatusNode(status),
  };
  if (ch && !ch.spent) state.challenge = challengeNode(ch);
  const actions: PageDoc['actions'] = {
    submit_credentials: {
      description: 'Sign in with email and password',
      kind: 'mutate',
      input: {
        email: { type: 'string', required: true, min_length: 3, max_length: 254 },
        password: { type: 'string', required: true, min_length: 1, max_length: 256 },
      },
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      auth: 'none',
      policy: { pii_params: ['email'], secret_params: ['password'] },
    },
    submit_otp: {
      description: 'Submit the verification code',
      kind: 'mutate',
      input: { otp: { type: 'string', required: true, min_length: 6, max_length: 6 } },
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      auth: 'none',
      policy: { secret_params: ['otp'] },
    },
    start_passkey: {
      description: 'Sign in with passkey',
      kind: 'mutate',
      input: {},
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      auth: 'none',
    },
    start_google: {
      description: 'Continue with Google',
      kind: 'delegate',
      input: {},
      output: {
        delegates_to:
          'https://accounts.google.com/o/oauth2/v2/auth?client_id=demo&redirect_uri=https%3A%2F%2Fexample.com%2Fauth%2Fgoogle%2Fcallback',
        delegate_protocol: 'https',
      },
      side_effect: 'identity',
      idempotent: false,
      auth: 'none',
    },
    refresh_session: {
      description: 'Refresh session',
      kind: 'mutate',
      input: { refresh_token: { type: 'string', required: true } },
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      auth: 'none',
      policy: { secret_params: ['refresh_token'] },
    },
    logout: {
      description: 'Sign out',
      kind: 'mutate',
      input: {},
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: true,
    },
  };
  return {
    app: '1.1',
    page: {
      id: 'login',
      url: pageUrl(port, '/login'),
      title: 'Sign in',
      version: 'lg-1',
      language: 'en',
    },
    state,
    actions,
    meta: {
      flow: {
        id: 'login',
        kind: 'password',
        step: ch ? 'mfa' : 'credentials',
        step_index: ch ? 2 : 1,
        step_count: 3,
        can_abandon: true,
        abandon_url: pageUrl(port, '/'),
        resume_supported: true,
      },
    },
  };
}

function accountPage(port: number, sess: V11Session | undefined, epoch: number): PageDoc {
  const authenticated = sess?.status === 'authenticated';
  return {
    app: '1.1',
    page: {
      id: 'account',
      url: pageUrl(port, '/account'),
      title: 'Account',
      version: authenticated ? `acc-${epoch}-${sess!.id}` : `acc-anon-${epoch}`,
      etag: `"acc-${epoch}-${sess?.id ?? 'anon'}"`,
    },
    state: {
      session: sessionStatusNode(authenticated ? 'authenticated' : 'anonymous'),
      email: strNode(authenticated ? sess!.email : '', 'Email'),
      consent: consentState({ necessary: true, analytics: false, marketing: false }, 1),
    },
    actions: {
      logout: {
        description: 'Sign out',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'identity',
        idempotent: true,
      },
      logout_all: {
        description: 'Sign out all devices',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'identity',
        idempotent: true,
      },
    },
    meta: { session_epoch: epoch },
  };
}

function consentState(grants: Record<string, boolean>, version: number): StateNode {
  const purposes: Record<string, StateNode> = {};
  for (const [k, v] of Object.entries(grants)) {
    purposes[k] = boolNode(v, k);
  }
  return {
    type: 'object',
    label: 'Consent',
    value: {
      version: numNode(version),
      purposes: { type: 'object', value: purposes },
    },
  };
}

function genericFailMessage(): string {
  return 'Authentication failed';
}

function isLocked(state: ConformanceState, email: string): boolean {
  const until = state.v11.lockedUntil.get(email) ?? 0;
  return until > Date.now();
}

function recordFail(state: ConformanceState, email: string): boolean {
  const n = (state.v11.loginFails.get(email) ?? 0) + 1;
  state.v11.loginFails.set(email, n);
  if (n >= MAX_LOGIN_FAILS) {
    state.v11.lockedUntil.set(email, Date.now() + 15 * 60_000);
    return true;
  }
  return false;
}

function storeIdemDirect(
  state: ConformanceState,
  rec: {
    key: string;
    action: string;
    path: string;
    originalJson: string;
    status: number;
    headers: Record<string, string>;
    body: unknown;
    challengeId?: string;
    continued?: boolean;
    terminal?: boolean;
  },
): void {
  state.v11.idem.set(rec.key, {
    key: rec.key,
    action: rec.action,
    path: rec.path,
    originalJson: rec.originalJson,
    status: rec.status,
    headers: rec.headers,
    body: typeof rec.body === 'string' ? rec.body : JSON.stringify(rec.body),
    challengeId: rec.challengeId,
    continued: rec.continued ?? false,
    terminal: rec.terminal ?? rec.status < 400,
  });
}

function replayIdem(
  res: Response,
  rec: { status: number; headers: Record<string, string>; body: string },
): void {
  for (const [k, v] of Object.entries(rec.headers)) res.setHeader(k, v);
  res
    .status(rec.status)
    .type(rec.status >= 400 ? MEDIA_ERROR : MEDIA_PAGE)
    .send(rec.body);
}

function sameCoreParams(a: Json, b: Json, extraAllowed: string[]): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (extraAllowed.includes(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

function pushEvent(
  state: ConformanceState,
  type: string,
  pageUrlValue: string,
  data: Record<string, unknown>,
): void {
  state.v11.eventSeq += 1;
  const ev = {
    id: state.v11.eventSeq,
    type,
    version: typeof data.version === 'string' ? data.version : undefined,
    pageUrl: pageUrlValue,
    data,
  };
  state.v11.events.push(ev);
  for (const c of state.v11.sseClients) {
    if (c.pageUrl && c.pageUrl !== pageUrlValue) continue;
    writeSse(c.res, ev.id, type, { type, ...data, page_url: pageUrlValue });
  }
}

function writeSse(res: Response, id: number, event: string, data: unknown): void {
  res.write(`id: ${id}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function userKind(email: string): 'plain' | 'mfa' | 'inline' | 'expired' {
  if (email.startsWith('mfa@')) return 'mfa';
  if (email.startsWith('inline@')) return 'inline';
  if (email.startsWith('expired@')) return 'expired';
  return 'plain';
}

function knownUser(email: string): boolean {
  return (
    email === 'user@example.com' ||
    email === 'mfa@example.com' ||
    email === 'inline@example.com' ||
    email === 'expired@example.com' ||
    email === 'existing@example.com'
  );
}

function emitHold(state: ConformanceState, _port: number, expired = false): V11Hold {
  state.v11.holdIssued += 1;
  const id = newId('hold');
  const hold: V11Hold = {
    id,
    status: expired ? 'expired' : 'pending',
    expiresAt: expired ? Date.now() - 1000 : Date.now() + 300_000,
    verifyPath: `/holds/${id}`,
    widgetUrl: `https://challenges.example-cdn.net/widget/${id}`,
    tokenUsed: false,
  };
  state.v11.holds.set(id, hold);
  if (!expired) state.v11.pendingHoldId = id;
  return hold;
}

function holdDetails(hold: V11Hold, port: number): StateNode {
  return {
    type: 'object',
    value: {
      id: strNode(hold.id),
      kind: enumNode('captcha', ['captcha', 'webview', 'liveness', 'tos']),
      status: enumNode(hold.status, ['pending', 'cleared', 'expired', 'failed']),
      verify_url: strNode(pageUrl(port, hold.verifyPath)),
      widget_url: strNode(hold.widgetUrl),
      resume_action: strNode('resume_held_action'),
      expires_at: { type: 'datetime', value: new Date(hold.expiresAt).toISOString() },
      ttl_ms: numNode(Math.max(0, hold.expiresAt - Date.now())),
      who: enumNode('human', ['human']),
      agent_solvable: boolNode(false),
      issued_count: numNode(1),
    },
  };
}

function checkVersionNegotiation(
  req: Request,
  res: Response,
  supported: readonly string[],
): WireVersion | null {
  const accept = req.headers.accept;
  const acceptVersions = header(req, HEADER_APP_ACCEPT_VERSIONS);
  const xAppVersion = header(req, HEADER_APP_VERSION);
  const neg = negotiateV11(accept, {
    acceptVersions,
    xAppVersion,
    supported,
  });
  if (neg.versionMismatch) {
    sendError(
      res,
      400,
      'app.err.version.version_mismatch',
      'Media v= names an unsupported version',
      {
        app: neg.highestOffered === '1.1' ? '1.1' : '1.0',
      },
    );
    return null;
  }
  if (neg.versionUnsupported) {
    const highest: WireVersion = neg.highestOffered === '1.1' ? '1.1' : '1.0';
    sendError(res, 406, 'app.err.version.unsupported', 'No mutually supported protocol version', {
      app: highest,
      details: {
        supported: {
          type: 'array',
          value: supported.map((v) => ({ type: 'string', value: v })),
        },
      },
    });
    return null;
  }
  const sel = selectProtocolVersion({ acceptVersions, xAppVersion, supported });
  return sel.selected === '1.1' ? '1.1' : '1.0';
}

export function mountV11(app: Application, state: ConformanceState, port: number): void {
  const origin = `http://${PAGE_HOST}:${port}`;

  // --- well-known version negotiation ---
  app.get('/.well-known/agent-page', (req, res) => {
    const ver = selectedVersion(req);
    const body = ver === '1.1' ? wellKnown11(port) : wellKnown10From11(port);
    sendManifest(res, body);
  });

  app.get('/.well-known/agent-page-v10', (req, res) => {
    const ver = checkVersionNegotiation(req, res, ['1.0']);
    if (!ver) return;
    sendManifest(res, wellKnown10Only(port));
  });

  app.get('/.well-known/agent-page-no-login', (_req, res) => {
    sendError(
      res,
      502,
      'app.err.discovery.invalid_well_known',
      'identity_flows requires flows.login',
    );
  });

  // 1.0-only page for MF-2/3
  app.get('/v10/page', (req, res) => {
    const ver = checkVersionNegotiation(req, res, ['1.0']);
    if (!ver) return;
    sendManifest(res, {
      app: '1.0',
      page: { id: 'v10', url: pageUrl(port, '/v10/page'), title: '1.0 only', version: 'v1' },
      state: { n: numNode(1, 'N') },
      actions: {},
    });
  });

  // --- identity ---
  app.get('/login', (req, res) => {
    const sess = resolveSession(req, state);
    sendManifest(res, loginPage(port, sess));
  });

  app.post('/login', (req, res) => handleLoginPost(req, res, state, port, 'page'));
  app.post('/v11/login-inline', (req, res) => handleLoginPost(req, res, state, port, 'inline'));

  // TV-158: 3-factor chains — declared step_count 3 completes; declared 2 aborts client-side.
  app.get('/v11/login3fa', (_req, res) =>
    sendManifest(res, login3faPage(port, '/v11/login3fa', 1, 3), 200),
  );
  app.post('/v11/login3fa', (req, res) => handle3faStep(req, res, state, port));
  app.get('/v11/login3fa-tight', (_req, res) =>
    sendManifest(res, login3faPage(port, '/v11/login3fa-tight', 1, 2), 200),
  );
  app.post('/v11/login3fa-tight', (req, res) => handle3faStep(req, res, state, port));

  app.get('/account', (req, res) => {
    const resume = header(req, HEADER_APP_RESUME);
    if (resume) {
      const sid = state.v11.resumeToSession.get(resume);
      const sess = sid ? state.v11.sessions.get(sid) : undefined;
      if (!sess) {
        sendError(res, 401, 'app.err.auth.resume_invalid', 'Resume token invalid');
        return;
      }
      if (state.v11.revokedFamilies.has(sess.family)) {
        sendError(res, 401, 'app.err.auth.resume_invalid', 'Resume family revoked');
        return;
      }
      if (sess.status !== 'authenticated') {
        sendError(res, 401, 'app.err.auth.expired', 'Resume expired', {
          details: { refresh_available: boolNode(true) },
        });
        return;
      }
      sendManifest(res, accountPage(port, sess, state.v11.sessionEpoch), 200, authHeaders(sess));
      return;
    }
    const sess = resolveSession(req, state);
    if (!sess || sess.status !== 'authenticated') {
      sendError(res, 401, 'app.err.auth.required', 'Sign in to continue', {
        details: {
          login_url: strNode(`${origin}/login`),
          flow_id: strNode('login'),
        },
        extraHeaders: {
          'WWW-Authenticate': `APP realm="conformance", flow="login", url="${origin}/login"`,
        },
      });
      return;
    }
    const inm = req.header('If-None-Match');
    const page = accountPage(port, sess, state.v11.sessionEpoch);
    if (inm && page.page.etag && inm === page.page.etag) {
      res.status(304).setHeader(HEADER_APP_VERSION, '1.1').end();
      return;
    }
    sendManifest(res, page, 200, { 'Cache-Control': 'private, no-store' });
  });

  app.post('/account', (req, res) => {
    const { action } = parseAction(req);
    if (action === 'logout' || action === 'logout_all') {
      return handleLogout(req, res, state, port, action === 'logout_all');
    }
    sendError(res, 404, 'app.err.action.not_found', 'Unknown action');
  });

  app.get('/logout', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: { id: 'logout', url: pageUrl(port, '/logout'), title: 'Sign out', version: 'lo-1' },
      state: { session: sessionStatusNode('authenticated') },
      actions: {
        logout: {
          description: 'Confirm sign out',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: true,
        },
      },
    });
  });

  app.post('/logout', (req, res) => handleLogout(req, res, state, port, false));

  app.get('/signup', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: { id: 'signup', url: pageUrl(port, '/signup'), title: 'Sign up', version: 'su-1' },
      state: { session: sessionStatusNode('anonymous') },
      actions: {
        signup: {
          description: 'Create account',
          kind: 'mutate',
          input: {
            email: { type: 'string', required: true },
            password: { type: 'string', required: true },
          },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: false,
          policy: { secret_params: ['password'] },
        },
      },
    });
  });

  app.post('/signup', (req, res) => {
    const { params } = parseAction(req);
    const email = String(params.email ?? '');
    if (knownUser(email) || email === 'existing@example.com') {
      sendError(res, 409, 'app.err.auth.identity_conflict', 'Could not create account');
      return;
    }
    sendManifest(res, loginPage(port, createSession(state, email, 'authenticated')));
  });

  app.get('/recover', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: { id: 'recover', url: pageUrl(port, '/recover'), title: 'Recover', version: 'rc-1' },
      state: { sent: boolNode(false, 'Sent') },
      actions: {
        start_recovery: {
          description: 'Start recovery',
          kind: 'mutate',
          input: { email: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: true,
        },
      },
    });
  });

  app.post('/recover', (req, res) => {
    const { action } = parseAction(req);
    if (action !== 'start_recovery') {
      sendError(res, 404, 'app.err.action.not_found', 'Unknown action');
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: { id: 'recover', url: pageUrl(port, '/recover'), title: 'Recover', version: 'rc-2' },
      state: {
        sent: boolNode(true, 'Sent'),
        message: strNode('If an account exists, a recovery email was sent'),
      },
      actions: {},
    });
  });

  // --- OAuth ---
  app.get('/auth/google', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'oauth_start',
        url: pageUrl(port, '/auth/google'),
        title: 'Continue with Google',
        version: 'og-1',
      },
      state: { session: sessionStatusNode('anonymous') },
      actions: {
        start_google: {
          description: 'Open Google',
          kind: 'delegate',
          input: {},
          output: {
            delegates_to:
              'https://accounts.google.com/o/oauth2/v2/auth?client_id=demo&redirect_uri=https%3A%2F%2Fexample.com%2Fcb',
            delegate_protocol: 'https',
          },
          side_effect: 'identity',
          idempotent: false,
        },
      },
    });
  });

  app.get('/auth/google/callback', (req, res) => {
    const idpError = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (idpError) {
      sendError(res, 400, 'app.err.auth.oauth_denied', `IdP denied: ${idpError}`, {
        path: '/query/error',
      });
      return;
    }
    const code = String(req.query.code ?? '');
    const page: PageDoc = {
      app: '1.1',
      page: {
        id: 'oauth_callback',
        url: pageUrl(port, '/auth/google/callback'),
        title: 'OAuth callback',
        version: 'og-cb-1',
      },
      state: {
        session: sessionStatusNode('anonymous'),
        ready: boolNode(true, 'Ready'),
      },
      actions: {
        complete_oauth: {
          description: 'Finish Google sign-in',
          kind: 'mutate',
          input: { state: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: false,
        },
      },
    };
    const text = JSON.stringify(page);
    if (code && text.includes(code)) {
      sendError(res, 500, 'app.err.internal.server', 'callback leaked code');
      return;
    }
    sendManifest(res, page);
  });

  app.post('/auth/google', (req, res) => {
    const { action } = parseAction(req);
    if (action !== 'complete_oauth') {
      sendError(res, 404, 'app.err.action.not_found', 'Unknown action');
      return;
    }
    const slot = state.v11.oauthCodes.get('splendid');
    if (!slot || slot.spent) {
      sendError(res, 409, 'app.err.auth.oauth_code_spent', 'Authorization code already used');
      return;
    }
    slot.spent = true;
    const sess = createSession(state, 'user@example.com', 'authenticated');
    sendManifest(res, accountPage(port, sess, state.v11.sessionEpoch), 200, authHeaders(sess));
  });

  app.get('/auth/google/callback-scan', (req, res) => {
    // alias used by TV-75 same as callback
    req.url = '/auth/google/callback';
    res.redirect(
      308,
      `/auth/google/callback?${new URL(req.originalUrl, origin).searchParams.toString()}`,
    );
  });

  // --- magic link ---
  app.get('/v11/magic-link', (_req, res) => {
    const ch = issueChallenge(state, 'user@example.com', { kind: 'magic_link' });
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'magic',
        url: pageUrl(port, '/v11/magic-link'),
        title: 'Magic link',
        version: 'mg-1',
      },
      state: {
        session: sessionStatusNode(state.v11.magicComplete ? 'authenticated' : 'pending_mfa'),
        challenge: {
          type: 'object',
          value: {
            ...(challengeNode(ch) as { value: Record<string, StateNode> }).value,
            poll_interval_ms: numNode(1000),
          },
        },
      },
      actions: {
        complete_magic_link: {
          description: 'Complete magic link',
          kind: 'mutate',
          input: { slot: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: false,
        },
      },
    });
  });

  app.post('/v11/magic-link', (req, res) => {
    const { action } = parseAction(req);
    if (action !== 'complete_magic_link') {
      sendError(res, 404, 'app.err.action.not_found', 'Unknown');
      return;
    }
    state.v11.magicComplete = true;
    const sess = createSession(state, 'user@example.com', 'authenticated');
    sendManifest(res, loginPage(port, sess), 200, authHeaders(sess));
  });

  // --- hold ---
  app.get('/v11/search', (_req, res) => {
    sendManifest(res, searchPage(port));
  });

  app.post('/v11/search', (req, res) => handleSearchHold(req, res, state, port, origin));

  app.get('/holds/:id', (req, res) => {
    const hold = state.v11.holds.get(req.params.id!);
    if (!hold) {
      sendError(res, 404, 'app.err.page.not_found', 'Hold not found');
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: { id: 'hold', url: pageUrl(port, hold.verifyPath), title: 'Verify', version: 'h-1' },
      state: { hold: holdDetails(hold, port) },
      actions: {
        complete_hold: {
          description: 'Complete human verification',
          kind: 'mutate',
          input: { widget_response: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: false,
          auth: 'session',
        },
      },
    });
  });

  app.post('/holds/:id', (req, res) => {
    const hold = state.v11.holds.get(req.params.id!);
    if (!hold) {
      sendError(res, 404, 'app.err.page.not_found', 'Hold not found');
      return;
    }
    const client = header(req, HEADER_APP_CLIENT) ?? '';
    if (client.startsWith('agent/')) {
      sendError(res, 403, 'app.err.hold.invalid', 'Agents cannot complete holds');
      return;
    }
    const { action } = parseAction(req);
    if (action !== 'complete_hold') {
      sendError(res, 404, 'app.err.action.not_found', 'Unknown');
      return;
    }
    hold.status = 'cleared';
    hold.token = newId('htok');
    state.v11.pendingHoldId = null;
    state.v11.booking.holdCleared = true;
    sendManifest(
      res,
      {
        app: '1.1',
        page: { id: 'hold', url: pageUrl(port, hold.verifyPath), title: 'Verify', version: 'h-2' },
        state: { hold: holdDetails(hold, port), hold_token: strNode(hold.token) },
        actions: {},
      },
      200,
      { 'X-APP-Hold-Token': hold.token },
    );
  });

  // multi-gate booking
  app.get('/v11/booking', (_req, res) => {
    sendManifest(res, bookingPage(port));
  });
  app.post('/v11/booking', (req, res) => handleBooking(req, res, state, port));

  // --- consent ---
  app.get('/v11/home', (req, res) => {
    const ver = selectedVersion(req);
    const page: PageDoc = {
      app: ver,
      page: { id: 'home', url: pageUrl(port, '/v11/home'), title: 'Home', version: 'hm-1' },
      state: {
        consent: consentState(state.v11.consentGrants, state.v11.consentVersion),
        note: strNode('ok', 'Note'),
      },
      actions: {
        track: {
          description: 'Analytics ping',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          policy: { consent_purposes: ['analytics'] },
        },
        grant_consent: {
          description: 'Grant consent',
          kind: 'mutate',
          input: {
            purposes: { type: 'array', required: true },
            version: { type: 'number', required: false },
          },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: true,
        },
        revoke_consent: {
          description: 'Revoke consent',
          kind: 'mutate',
          input: { ids: { type: 'array', required: true } },
          output: { state_diff: true },
          side_effect: 'identity',
          idempotent: true,
        },
      },
    };
    sendManifest(res, page);
  });

  app.post('/v11/home', (req, res) => handleConsent(req, res, state, port));

  // agent-native consent page (no HTML)
  app.get('/v11/agent-native', (req, res) => {
    const accept = (req.headers.accept ?? '').toLowerCase();
    if (accept.includes('text/html') && !accept.includes('vnd.agent-page')) {
      sendError(res, 406, 'app.err.negotiate.not_acceptable', 'No HTML representation');
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'agent_native',
        url: pageUrl(port, '/v11/agent-native'),
        title: 'Native',
        version: 'an-1',
      },
      state: { consent: consentState(state.v11.consentGrants, state.v11.consentVersion) },
      actions: {},
    });
  });

  // --- types / typeahead / upload ---
  app.get('/v11/geo', (req, res) => {
    const ver = selectedVersion(req);
    const tz = header(req, 'X-APP-Time-Zone');
    const dt = '2026-08-19T10:00:00.000Z';
    const geo11 = { type: 'geopoint', value: { lat: 51.47, lng: -0.45 }, label: 'Loc' };
    const geo10: StateNode = {
      type: 'object',
      label: 'Loc',
      value: {
        lat: numNode(51.47, 'lat'),
        lng: numNode(-0.45, 'lng'),
      },
    };
    sendManifest(res, {
      app: ver,
      page: {
        id: 'geo',
        url: pageUrl(port, '/v11/geo'),
        title: 'Geo',
        version: 'g-1',
        ...(ver === '1.1' && tz ? { time_zone: tz } : {}),
      },
      state: {
        loc: ver === '1.1' ? geo11 : geo10,
        when: { type: 'datetime', value: dt, label: 'When' },
      },
      actions: {
        set_loc: {
          description: 'Set location',
          kind: 'mutate',
          input: {
            loc: {
              type: 'geopoint',
              required: true,
              properties: {
                lat: { type: 'number', required: true },
                lng: { type: 'number', required: true },
              },
            },
            range: { type: 'date_range', required: false },
            dtrange: { type: 'datetime_range', required: false },
            qty: { type: 'quantity', required: false, units: ['kg'] },
            price: { type: 'money', required: false, scale: 2, currency: 'GBP' },
            q: { type: 'string', required: false },
          },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    });
  });

  app.post('/v11/geo', (req, res) => handleGeo(req, res, state, port));

  app.get('/v11/airports', (_req, res) => {
    sendManifest(res, airportsPage(port, []));
  });
  app.post('/v11/airports', (req, res) => {
    const { action, params } = parseAction(req);
    if (action === 'publish_mutate') {
      sendError(
        res,
        400,
        'app.err.action.options_source_invalid',
        'options_source must not target mutate',
      );
      return;
    }
    if (action !== 'search_airports') {
      sendError(res, 404, 'app.err.action.not_found', 'Unknown');
      return;
    }
    const q = String(params.q ?? '');
    const rows =
      q.length === 0
        ? []
        : [
            ['LHR', 'London Heathrow'],
            ['LCY', 'London City'],
          ].slice(0, 64);
    sendManifest(res, airportsPage(port, rows, q));
  });

  app.get('/v11/bad-typeahead', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'bad_ta',
        url: pageUrl(port, '/v11/bad-typeahead'),
        title: 'Bad typeahead',
        version: 'bt-1',
      },
      state: { suggestions: { type: 'table', fields: { id: 'string' }, value: [], label: 'S' } },
      actions: {
        publish_mutate: {
          description: 'Mutate (illegal options_source target)',
          kind: 'mutate',
          input: { q: { type: 'string' } },
          output: { state_diff: true },
          side_effect: 'destructive',
          idempotent: false,
        },
        search_box: {
          description: 'Search',
          kind: 'query',
          input: {
            q: {
              type: 'string',
              options_source: {
                action: 'publish_mutate',
                param: 'q',
                results_path: '/state/suggestions',
                min_query_length: 2,
              },
            },
          },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    });
  });

  app.post('/v11/upload', (req, res) => {
    const ct = req.headers['content-type'] ?? '';
    if (ct.includes('multipart/form-data')) {
      sendManifest(res, {
        app: '1.1',
        page: { id: 'upload', url: pageUrl(port, '/v11/upload'), title: 'Upload', version: 'up-2' },
        state: { ok: boolNode(true, 'Ok') },
        actions: {},
      });
      return;
    }
    sendError(res, 415, 'app.err.action.upload_unsupported', 'Expected multipart');
  });

  app.post('/v11/upload-off', (_req, res) => {
    sendError(
      res,
      415,
      'app.err.action.upload_unsupported',
      'file_upload capability not advertised',
    );
  });

  app.get('/v11/presign', (_req, res) => {
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'presign',
        url: pageUrl(port, '/v11/presign'),
        title: 'Presign',
        version: 'ps-1',
      },
      state: {
        slot: strNode('file_fresh'),
        put_url: strNode('https://uploads.example-cdn.net/put/file_fresh'),
      },
      actions: {
        attach_file: {
          description: 'Attach uploaded file',
          kind: 'mutate',
          input: {
            file_id: { type: 'string', required: true },
            sha256: { type: 'string', required: false },
          },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    });
  });

  app.post('/v11/presign', (req, res) => {
    const { params } = parseAction(req);
    const fileId = String(params.file_id ?? '');
    const sha = params.sha256 != null ? String(params.sha256) : undefined;
    const slot = state.v11.fileSlots.get(fileId);
    if (!slot || slot.expired) {
      sendError(res, 409, 'app.err.action.upload_expired', 'Upload slot expired');
      return;
    }
    if (sha && sha !== slot.sha256) {
      sendError(res, 400, 'app.err.validation.param_file', 'sha256 mismatch', {
        path: '/params/sha256',
      });
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'presign',
        url: pageUrl(port, '/v11/presign'),
        title: 'Presign',
        version: 'ps-2',
      },
      state: { attached: boolNode(true) },
      actions: {},
    });
  });

  // --- commerce ---
  app.get('/v11/order', (_req, res) => sendManifest(res, orderPage(port, state)));
  app.post('/v11/order', (req, res) => handleOrder(req, res, state, port));

  app.get('/pay/3ds-callback', (req, res) => {
    const code = String(req.query.code ?? '');
    const page: PageDoc = {
      app: '1.1',
      page: {
        id: 'pay_3ds_cb', // schema/manifest.json: page.id must match ^[a-z][a-z0-9_-]{0,127}$
        url: pageUrl(port, '/pay/3ds-callback'),
        title: '3DS callback',
        version: '3ds-1',
      },
      state: {
        order: orderNode(state, 'awaiting_3ds'),
        ready: boolNode(true),
      },
      actions: {
        complete_payment: {
          description: 'Complete payment',
          kind: 'mutate',
          input: { state: { type: 'string', required: false } },
          output: { state_diff: true },
          side_effect: 'financial',
          idempotent: false,
          requires_confirmation: false,
        },
      },
    };
    const text = JSON.stringify(page);
    if (code && text.includes(code)) {
      sendError(res, 500, 'app.err.internal.server', 'callback leaked');
      return;
    }
    sendManifest(res, page);
  });

  // --- live / events / focus / bulk ---
  app.get('/v11/live', (req, res) => {
    const page = livePage(port, state);
    const inm = req.header('If-None-Match');
    if (inm && page.page.etag && inm === page.page.etag) {
      res.status(304).setHeader(HEADER_APP_VERSION, '1.1').end();
      return;
    }
    sendManifest(res, page);
  });

  app.post('/v11/live', (req, res) => {
    const match = header(req, HEADER_APP_IF_MATCH_VERSION);
    if (match && match !== state.v11.liveVersion) {
      sendError(res, 409, 'app.err.diff.conflict', 'Stale version');
      return;
    }
    const n = state.v11.liveN + 1;
    state.v11.liveN = n;
    const next = `v${Number(state.v11.liveVersion.slice(1) || '1') + 1}`;
    state.v11.liveVersion = next;
    const url = pageUrl(port, '/v11/live');
    pushEvent(state, 'state.changed', url, { version: next, type: 'state.changed' });
    sendManifest(res, livePage(port, state));
  });

  app.get('/v11/focus', (req, res) => {
    const focus = typeof req.query.app_focus === 'string' ? req.query.app_focus : undefined;
    const valid = focus === '/state/results';
    const url = `${pageUrl(port, '/v11/focus')}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    sendManifest(res, {
      app: '1.1',
      page: {
        id: 'focus',
        url,
        title: 'Focus',
        version: 'f-1',
        ...(valid && focus ? { focus } : {}),
      },
      state: {
        results: { type: 'table', fields: { id: 'string' }, value: [['a']], label: 'Results' },
      },
      actions: {},
    });
  });

  app.get('/v11/bulk', (_req, res) => sendManifest(res, bulkPage(port, state, true)));
  app.post('/v11/bulk', (req, res) => handleBulk(req, res, state, port, true));
  app.get('/v11/no-bulk', (_req, res) => sendManifest(res, bulkPage(port, state, false)));
  app.post('/v11/no-bulk', (req, res) => handleBulk(req, res, state, port, false));

  app.get('/app-events', (req, res) => handleEvents(req, res, state, origin));
}

function searchPage(port: number): PageDoc {
  return {
    app: '1.1',
    page: { id: 'search', url: pageUrl(port, '/v11/search'), title: 'Search', version: 's-1' },
    state: { q: strNode('', 'Q') },
    actions: {
      search: {
        description: 'Search',
        kind: 'mutate',
        input: { q: { type: 'string', required: false } },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
      },
    },
  };
}

function bookingPage(port: number): PageDoc {
  return {
    app: '1.1',
    page: { id: 'booking', url: pageUrl(port, '/v11/booking'), title: 'Booking', version: 'bk-1' },
    state: { status: strNode('hold', 'Status') },
    actions: {
      confirm_booking: {
        description: 'Confirm booking',
        kind: 'mutate',
        input: { itinerary: { type: 'string', required: false } },
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
        requires_confirmation: true,
        policy: { consent_purposes: ['marketing'] },
      },
      grant_consent: {
        description: 'Grant',
        kind: 'mutate',
        input: { purposes: { type: 'array', required: true } },
        output: { state_diff: true },
        side_effect: 'identity',
        idempotent: true,
      },
    },
  };
}

function airportsPage(port: number, rows: unknown[], q = ''): PageDoc {
  return {
    app: '1.1',
    page: {
      id: 'airports',
      url: pageUrl(port, '/v11/airports'),
      title: 'Airports',
      version: 'ap-1',
    },
    state: {
      q: strNode(q, 'Q'),
      suggestions: {
        type: 'table',
        label: 'Suggestions',
        fields: { code: 'string', name: 'string' },
        value: rows,
      },
    },
    actions: {
      search_airports: {
        description: 'Search airports',
        kind: 'query',
        input: {
          q: {
            type: 'string',
            required: true,
            options_source: {
              action: 'search_airports',
              param: 'q',
              results_path: '/state/suggestions',
              min_query_length: 2,
            },
          },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
      },
    },
  };
}

function orderNode(
  state: ConformanceState,
  status = state.v11.order.status,
): Record<string, unknown> {
  return {
    type: 'order',
    label: 'Order',
    value: {
      id: state.v11.order.id,
      status: status as never,
      currency: state.v11.order.currency,
      total: state.v11.order.total,
      scale: state.v11.order.scale,
    },
  };
}

function orderPage(port: number, state: ConformanceState): PageDoc {
  return {
    app: '1.1',
    page: { id: 'order', url: pageUrl(port, '/v11/order'), title: 'Order', version: 'or-1' },
    state: { order: orderNode(state), paid: boolNode(state.v11.order.status === 'paid') },
    actions: {
      set_status: {
        description: 'Set status',
        kind: 'mutate',
        input: { status: { type: 'string', required: true } },
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
      },
      pay_redirect: {
        description: 'Pay',
        kind: 'delegate',
        input: {},
        output: {
          delegates_to: 'https://bank.example/3ds/start',
          delegate_protocol: 'https',
        },
        side_effect: 'financial',
        idempotent: false,
        requires_confirmation: true,
      },
      refund: {
        description: 'Refund',
        kind: 'mutate',
        input: { amount: { type: 'number', required: true } },
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
      },
      cancel: {
        description: 'Cancel',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
      },
      complete_payment: {
        description: 'Complete payment',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
      },
    },
  };
}

function livePage(port: number, state: ConformanceState): PageDoc {
  return {
    app: '1.1',
    page: {
      id: 'live',
      url: pageUrl(port, '/v11/live'),
      title: 'Live',
      version: state.v11.liveVersion,
      etag: `"live-${state.v11.liveVersion}"`,
    },
    state: { n: numNode(state.v11.liveN, 'N') },
    actions: {
      bump: {
        description: 'Bump',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
      },
    },
    meta: { session_epoch: state.v11.sessionEpoch },
  };
}

function bulkPage(port: number, _state: ConformanceState, featured: boolean): PageDoc {
  return {
    app: '1.1',
    page: {
      id: featured ? 'bulk' : 'nobulk',
      url: pageUrl(port, featured ? '/v11/bulk' : '/v11/no-bulk'),
      title: 'Bulk',
      version: 'bu-1',
    },
    state: {
      items: {
        type: 'table',
        label: 'Items',
        fields: { id: 'string', ok: 'boolean' },
        value: [
          ['a', true],
          ['b', true],
        ],
      },
    },
    actions: {
      apply_bulk: {
        description: 'Apply bulk',
        kind: 'mutate',
        input: {
          items: { type: 'array', required: true },
          mode: { type: 'enum', options: ['all_or_nothing', 'best_effort'] },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: false,
        ...(featured ? { bulk: { max_items: 20, mode: 'all_or_nothing' as const } } : {}),
      },
    },
  };
}

function handleLoginPost(
  req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  mode: 'page' | 'inline',
): void {
  const { action, params } = parseAction(req);
  const key = header(req, 'X-APP-Idempotency-Key');
  const rawBody = JSON.stringify(req.body ?? {});

  if (action === 'refresh_session') {
    return handleRefresh(req, res, state, port, params);
  }
  if (action === 'logout') {
    return handleLogout(req, res, state, port, false);
  }
  if (action === 'start_passkey') {
    const pub = {
      challenge: 'dGVzdGNoYWxsZW5nZQ',
      timeout: 60000,
      rpId: '127.0.0.1',
      allowCredentials: [{ type: 'public-key', id: 'Y3JlZA' }],
    };
    const details: Record<string, StateNode> = {
      challenge: {
        type: 'object',
        value: {
          id: strNode(newId('chg')),
          kind: enumNode('webauthn', [
            'otp',
            'totp',
            'webauthn',
            'magic_link',
            'password',
            'backup_code',
            'push',
          ]),
          public_key: {
            type: 'object',
            value: {
              challenge: strNode(pub.challenge),
              timeout: numNode(pub.timeout),
              rpId: strNode(pub.rpId),
              allowCredentials: {
                type: 'array',
                value: [
                  {
                    type: 'object',
                    value: {
                      type: strNode('public-key'),
                      id: strNode('Y3JlZA'),
                    },
                  },
                ],
              },
            },
          },
        },
      },
    };
    sendError(res, 428, 'app.err.auth.challenge_required', 'Passkey required', { details });
    return;
  }
  if (action === 'submit_otp') {
    return handleSubmitOtp(req, res, state, port, params, key);
  }
  if (action !== 'submit_credentials') {
    sendError(res, 404, 'app.err.action.not_found', 'Unknown action');
    return;
  }

  const email = String(params.email ?? '');
  const password = String(params.password ?? '');
  const challengeHdr = header(req, HEADER_APP_CHALLENGE);

  if (key) {
    const existing = state.v11.idem.get(key);
    if (existing) {
      if (challengeHdr) {
        if (existing.terminal) {
          if (
            existing.continued &&
            challengeHdr === existing.challengeId &&
            existing.originalJson === rawBody
          ) {
            replayIdem(res, existing);
            return;
          }
          sendError(
            res,
            403,
            'app.err.auth.challenge_invalid',
            'Key already completed a challenge',
          );
          return;
        }
        if (existing.challengeId && challengeHdr !== existing.challengeId) {
          sendError(
            res,
            403,
            'app.err.auth.challenge_invalid',
            'Second distinct challenge id for key',
          );
          return;
        }
        const prev = JSON.parse(existing.originalJson) as { params?: Json };
        const prevParams = (prev.params ?? {}) as Json;
        if (!sameCoreParams(prevParams, params, ['otp', 'credential'])) {
          sendError(
            res,
            409,
            'app.err.action.idempotency_conflict',
            'Continuation mutated bound params',
          );
          return;
        }
        const ch = state.v11.challenges.get(challengeHdr);
        if (!ch) {
          sendError(res, 403, 'app.err.auth.challenge_invalid', 'Unknown challenge');
          return;
        }
        return finishInlineOtp(req, res, state, port, ch, params, key, rawBody);
      }
      replayIdem(res, existing);
      return;
    }
  }

  if (isLocked(state, email)) {
    sendError(res, 403, 'app.err.auth.locked', genericFailMessage(), { retry_after_ms: 900_000 });
    return;
  }
  if (password !== PASSWORD_OK || !knownUser(email)) {
    const locked = recordFail(state, email);
    if (locked) {
      sendError(res, 403, 'app.err.auth.locked', genericFailMessage(), { retry_after_ms: 900_000 });
      return;
    }
    sendError(res, 401, 'app.err.auth.failed', genericFailMessage());
    return;
  }

  const kind = userKind(email);
  const forceInline = mode === 'inline' || kind === 'inline' || kind === 'expired';
  if (forceInline) {
    const ch = issueChallenge(state, email, { expired: kind === 'expired' });
    const details = { challenge: challengeNode(ch) };
    const env = buildErrorEnvelope('app.err.auth.challenge_required', {
      message: 'Enter the 6-digit code sent to your device',
      httpStatus: 428,
      details,
      request_id: 'conf11',
    });
    (env as { app: string }).app = '1.1';
    const body = JSON.stringify(env);
    if (key) {
      storeIdemDirect(state, {
        key,
        action: 'submit_credentials',
        path: req.path,
        originalJson: rawBody,
        status: 428,
        headers: {
          'Content-Type': MEDIA_ERROR,
          [HEADER_APP_VERSION]: '1.1',
          [HEADER_APP_RESPONSE_MODE]: 'error',
        },
        body,
        challengeId: ch.id,
        continued: false,
        terminal: false,
      });
    }
    res
      .status(428)
      .type(MEDIA_ERROR)
      .setHeader(HEADER_APP_VERSION, '1.1')
      .setHeader(HEADER_APP_RESPONSE_MODE, 'error')
      .setHeader('Cache-Control', 'no-store')
      .send(body);
    return;
  }

  if (kind === 'mfa') {
    const sess = createSession(state, email, 'pending_mfa');
    const ch = issueChallenge(state, email, { sessionId: sess.id });
    const page = loginPage(port, sess, ch);
    const body = JSON.stringify(page);
    if (key) {
      storeIdemDirect(state, {
        key,
        action: 'submit_credentials',
        path: req.path,
        originalJson: rawBody,
        status: 200,
        headers: { 'Content-Type': MEDIA_PAGE, [HEADER_APP_VERSION]: '1.1' },
        body,
        terminal: false,
      });
    }
    sendManifest(res, page, 200, { 'Set-Cookie': `session=${sess.id}; Path=/; HttpOnly` });
    return;
  }

  const sess = createSession(state, email, 'authenticated');
  const page = loginPage(port, sess);
  const hdrs = authHeaders(sess);
  if (key) {
    storeIdemDirect(state, {
      key,
      action: 'submit_credentials',
      path: req.path,
      originalJson: rawBody,
      status: 200,
      headers: { 'Content-Type': MEDIA_PAGE, ...hdrs },
      body: page,
      terminal: true,
    });
  }
  sendManifest(res, page, 200, hdrs);
}

function finishInlineOtp(
  req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  ch: V11Challenge,
  params: Json,
  key: string | undefined,
  rawBody: string,
): void {
  if (ch.spent) {
    sendError(res, 403, 'app.err.auth.challenge_invalid', 'Challenge already spent');
    return;
  }
  if (Date.now() > ch.expiresAt) {
    sendError(res, 401, 'app.err.auth.challenge_expired', 'Challenge expired');
    return;
  }
  const otp = String(params.otp ?? '');
  if (otp !== ch.otp) {
    ch.attemptsRemaining = Math.max(0, ch.attemptsRemaining - 1);
    if (ch.attemptsRemaining === 0) {
      state.v11.lockedUntil.set(ch.email, Date.now() + 15 * 60_000);
      sendError(res, 403, 'app.err.auth.locked', 'Locked');
      return;
    }
    sendError(res, 401, 'app.err.auth.challenge_failed', 'Incorrect code', {
      details: { attempts_remaining: numNode(ch.attemptsRemaining) },
    });
    return;
  }
  ch.spent = true;
  const sess = createSession(state, ch.email, 'authenticated');
  const page = loginPage(port, sess);
  const hdrs = authHeaders(sess);
  if (key) {
    storeIdemDirect(state, {
      key,
      action: 'submit_credentials',
      path: req.path,
      originalJson: rawBody,
      status: 200,
      headers: { 'Content-Type': MEDIA_PAGE, ...hdrs },
      body: page,
      challengeId: ch.id,
      continued: true,
      terminal: true,
    });
  }
  sendManifest(res, page, 200, hdrs);
}

/* ---------- TV-158: 3-factor login chain (declared meta.flow.step_count) ---------- */

const FA_STEPS = [
  { action: 'submit_credentials', param: 'otp', kind: 'otp' },
  { action: 'submit_factor', param: 'totp', kind: 'totp' },
  { action: 'submit_final', param: 'backup', kind: 'backup_code' },
] as const;

const FA_STEP_NAMES = ['credentials', 'mfa', 'factor'] as const;

function login3faPage(port: number, path: string, step: 1 | 2 | 3, declaredCount: number): PageDoc {
  const def = FA_STEPS[step - 1];
  const input: Record<string, unknown> =
    step === 1
      ? {
          email: { type: 'string', required: true },
          password: { type: 'string', required: true },
        }
      : { [def.param]: { type: 'string', required: true, min_length: 4 } };
  return {
    app: '1.1',
    page: {
      id: `login3fa_${step}`,
      url: pageUrl(port, path),
      title: `Sign in — step ${step} of ${declaredCount}`,
      version: `3fa-${step}`,
    },
    state: {},
    actions: {
      [def.action]: {
        description: `Continue sign-in (factor ${step})`,
        kind: 'mutate',
        side_effect: 'identity',
        input,
        output: { state_diff: true },
      },
    },
    meta: {
      flow: {
        id: 'login3fa',
        kind: 'password',
        step: FA_STEP_NAMES[step - 1],
        step_index: step,
        step_count: declaredCount,
        can_abandon: true,
        abandon_url: pageUrl(port, '/'),
        resume_supported: false,
      },
    },
  };
}

function handle3faStep(req: Request, res: Response, state: ConformanceState, port: number): void {
  const declared = req.path.endsWith('-tight') ? 2 : 3;
  const params = ((req.body as { params?: Json } | undefined)?.params ?? {}) as Json;
  const key = header(req, 'X-APP-Idempotency-Key');
  const rawBody = JSON.stringify(req.body ?? {});
  const action = String((req.body as { action?: unknown } | undefined)?.action ?? '');
  const stepIdx = FA_STEPS.findIndex((s) => s.action === action);
  if (stepIdx < 0) {
    sendError(res, 404, 'app.err.action.not_found', 'Unknown action');
    return;
  }
  const step = (stepIdx + 1) as 1 | 2 | 3;
  const def = FA_STEPS[stepIdx];
  const challengeHdr = header(req, HEADER_APP_CHALLENGE);
  const next = (email: string): { page: PageDoc; hdrs: Record<string, string> } => {
    if (step < 3) {
      return { page: login3faPage(port, req.path, (step + 1) as 2 | 3, declared), hdrs: {} };
    }
    const sess = createSession(state, email, 'authenticated');
    return { page: accountPage(port, sess, state.v11.sessionEpoch), hdrs: authHeaders(sess) };
  };

  if (key) {
    const existing = state.v11.idem.get(key);
    if (existing) {
      if (challengeHdr) {
        if (existing.terminal) {
          if (
            existing.continued &&
            challengeHdr === existing.challengeId &&
            existing.originalJson === rawBody
          ) {
            replayIdem(res, existing);
            return;
          }
          sendError(
            res,
            403,
            'app.err.auth.challenge_invalid',
            'Key already completed a challenge',
          );
          return;
        }
        if (existing.challengeId && challengeHdr !== existing.challengeId) {
          sendError(
            res,
            403,
            'app.err.auth.challenge_invalid',
            'Second distinct challenge id for key',
          );
          return;
        }
        const prev = JSON.parse(existing.originalJson) as { params?: Json };
        if (!sameCoreParams(prev.params ?? {}, params, [def.param, 'credential'])) {
          sendError(
            res,
            409,
            'app.err.action.idempotency_conflict',
            'Continuation mutated bound params',
          );
          return;
        }
        const ch = state.v11.challenges.get(challengeHdr);
        if (!ch || ch.spent) {
          sendError(res, 403, 'app.err.auth.challenge_invalid', 'Unknown or spent challenge');
          return;
        }
        if (Date.now() > ch.expiresAt) {
          sendError(res, 401, 'app.err.auth.challenge_expired', 'Challenge expired');
          return;
        }
        if (String(params[def.param] ?? '') !== ch.otp) {
          sendError(res, 401, 'app.err.auth.challenge_failed', 'Incorrect code');
          return;
        }
        ch.spent = true;
        const { page, hdrs } = next(ch.email);
        storeIdemDirect(state, {
          key,
          action,
          path: req.path,
          originalJson: rawBody,
          status: 200,
          headers: { 'Content-Type': MEDIA_PAGE, ...hdrs },
          body: page,
          challengeId: ch.id,
          continued: true,
          terminal: true,
        });
        sendManifest(res, page, 200, hdrs);
        return;
      }
      replayIdem(res, existing);
      return;
    }
  }

  if (step === 1) {
    const email = String(params.email ?? '');
    const password = String(params.password ?? '');
    if (!knownUser(email) || password !== PASSWORD_OK) {
      sendError(res, 401, 'app.err.auth.failed', genericFailMessage());
      return;
    }
  }
  const ch = issueChallenge(state, `3fa@example.com`, { kind: def.kind });
  ch.param = def.param;
  const details = { challenge: challengeNode(ch) };
  const env = buildErrorEnvelope('app.err.auth.challenge_required', {
    message: `Factor ${step} required`,
    httpStatus: 428,
    details,
    request_id: 'conf3fa',
  });
  (env as { app: string }).app = '1.1';
  const body = JSON.stringify(env);
  if (key) {
    storeIdemDirect(state, {
      key,
      action,
      path: req.path,
      originalJson: rawBody,
      status: 428,
      headers: {
        'Content-Type': MEDIA_ERROR,
        [HEADER_APP_VERSION]: '1.1',
        [HEADER_APP_RESPONSE_MODE]: 'error',
      },
      body,
      challengeId: ch.id,
      continued: false,
      terminal: false,
    });
  }
  res
    .status(428)
    .type(MEDIA_ERROR)
    .setHeader(HEADER_APP_VERSION, '1.1')
    .setHeader(HEADER_APP_RESPONSE_MODE, 'error')
    .setHeader('Cache-Control', 'no-store')
    .send(body);
}

function handleSubmitOtp(
  req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  params: Json,
  _key: string | undefined,
): void {
  const sess = resolveSession(req, state);
  const otp = String(params.otp ?? '');
  let ch: V11Challenge | undefined;
  for (const c of state.v11.challenges.values()) {
    if (!c.spent && (c.sessionId === sess?.id || c.email === sess?.email)) {
      ch = c;
    }
  }
  if (!ch) {
    sendError(res, 403, 'app.err.auth.challenge_invalid', 'No challenge');
    return;
  }
  if (Date.now() > ch.expiresAt) {
    sendError(res, 401, 'app.err.auth.challenge_expired', 'Challenge expired');
    return;
  }
  if (otp !== ch.otp) {
    ch.attemptsRemaining = Math.max(0, ch.attemptsRemaining - 1);
    if (ch.attemptsRemaining === 0) {
      if (sess) sess.status = 'locked';
      sendError(res, 403, 'app.err.auth.locked', 'Locked');
      return;
    }
    sendError(res, 401, 'app.err.auth.challenge_failed', 'Incorrect code', {
      details: { attempts_remaining: numNode(ch.attemptsRemaining) },
    });
    return;
  }
  ch.spent = true;
  if (sess) sess.status = 'authenticated';
  const next = sess ?? createSession(state, ch.email, 'authenticated');
  next.status = 'authenticated';
  sendManifest(res, loginPage(port, next), 200, authHeaders(next));
}

function handleRefresh(
  _req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  params: Json,
): void {
  const rt = String(params.refresh_token ?? '');
  const spentSid = state.v11.spentRefresh.get(rt);
  if (spentSid || [...state.v11.revokedFamilies].some((f) => rt.includes(f))) {
    const sid = spentSid ?? state.v11.refreshToSession.get(rt);
    const sess = sid ? state.v11.sessions.get(sid) : undefined;
    if (sess) {
      state.v11.revokedFamilies.add(sess.family);
      state.v11.resumeToSession.delete(sess.resume);
      sess.status = 'expired';
    }
    sendError(res, 401, 'app.err.auth.refresh_reuse', 'Refresh token reused');
    return;
  }
  const sid = state.v11.refreshToSession.get(rt);
  const sess = sid ? state.v11.sessions.get(sid) : undefined;
  if (!sess) {
    sendError(res, 401, 'app.err.auth.expired', 'Refresh expired');
    return;
  }
  if (state.v11.revokedFamilies.has(sess.family)) {
    sendError(res, 401, 'app.err.auth.refresh_reuse', 'Family revoked');
    return;
  }
  state.v11.spentRefresh.set(rt, sess.id);
  state.v11.accessToSession.delete(sess.access);
  sess.access = `at_${sess.id}_${Date.now()}`;
  const nextRefresh = `rt_${sess.family}_2`;
  state.v11.refreshToSession.delete(rt);
  sess.refresh = nextRefresh;
  state.v11.accessToSession.set(sess.access, sess.id);
  state.v11.refreshToSession.set(nextRefresh, sess.id);
  sendManifest(res, loginPage(port, sess), 200, authHeaders(sess));
}

function handleLogout(
  req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  all: boolean,
): void {
  const sess = resolveSession(req, state);
  // Illegal transition: only an authenticated session may log out (§5.1).
  if (!sess || sess.status !== 'authenticated') {
    sendError(res, 409, 'app.err.auth.session_invalid', 'No authenticated session to end', {
      path: '/state/session',
    });
    return;
  }
  if (all) {
    state.v11.sessionEpoch += 1;
    for (const s of state.v11.sessions.values()) {
      s.status = 'expired';
    }
  } else {
    sess.status = 'expired';
    state.v11.sessionEpoch += 1;
  }
  sendManifest(
    res,
    {
      app: '1.1',
      page: { id: 'logout', url: pageUrl(port, '/logout'), title: 'Signed out', version: 'lo-2' },
      state: { session: sessionStatusNode('anonymous') },
      actions: {},
      meta: { session_epoch: state.v11.sessionEpoch },
    },
    200,
    { 'Set-Cookie': 'session=; Path=/; Max-Age=0', 'Cache-Control': 'no-store' },
  );
}

function handleSearchHold(
  req: Request,
  res: Response,
  state: ConformanceState,
  port: number,
  _origin: string,
): void {
  const { params } = parseAction(req);
  const q = String(params.q ?? 'captcha');
  const key = header(req, 'X-APP-Idempotency-Key');
  const holdTok = header(req, HEADER_APP_HOLD_TOKEN);

  if (holdTok) {
    const hold = [...state.v11.holds.values()].find((h) => h.token === holdTok);
    if (!hold || hold.tokenUsed) {
      sendError(res, 403, 'app.err.hold.invalid', 'Hold token invalid');
      return;
    }
    if (hold.status !== 'cleared') {
      sendError(res, 403, 'app.err.hold.invalid', 'Hold not cleared');
      return;
    }
    hold.tokenUsed = true;
    sendManifest(res, {
      app: '1.1',
      page: { id: 'search', url: pageUrl(port, '/v11/search'), title: 'Search', version: 's-2' },
      state: { q: strNode(q, 'Q'), results: { type: 'array', value: [strNode('ok')] } },
      actions: {},
    });
    return;
  }

  if (q === 'expired' || q === 'timeout') {
    const hold = emitHold(state, port, true);
    sendError(res, 409, 'app.err.hold.expired', 'Hold expired', {
      details: { hold: holdDetails(hold, port) },
    });
    return;
  }

  if (q === 'nested' && state.v11.pendingHoldId) {
    sendError(res, 409, 'app.err.hold.nested', 'Hold already pending');
    return;
  }

  if (q === 'badwidget') {
    // §7 table: a hold whose widget_url is http non-loopback MUST NOT be
    // emitted — the server refuses with hold.invalid_widget (500).
    const hold = emitHold(state, port, false);
    hold.widgetUrl = `http://widgets.evil-cdn.example/${hold.id}`;
    if (!isAllowedAppUrlScheme(hold.widgetUrl)) {
      sendError(res, 500, 'app.err.hold.invalid_widget', 'widget_url not https/loopback', {
        details: { widget_url: strNode(hold.widgetUrl) },
      });
      return;
    }
  }

  if (state.v11.holdIssued >= 3 && q !== 'force') {
    sendError(res, 429, 'app.err.hold.rate', 'Too many holds', { retry_after_ms: 60_000 });
    return;
  }

  const hold = emitHold(state, port, false);
  const details = holdDetails(hold, port);
  (details as { value: Record<string, StateNode> }).value.issued_count = numNode(
    state.v11.holdIssued,
  );
  sendError(res, 428, 'app.err.hold.human_required', 'Complete human verification to continue', {
    details: { hold: details },
    retry_after_ms: 0,
  });
  void key;
}

function handleBooking(req: Request, res: Response, state: ConformanceState, port: number): void {
  const { action, params } = parseAction(req);
  if (action === 'grant_consent') {
    state.v11.booking.consentGranted = true;
    state.v11.consentGrants.marketing = true;
    sendManifest(res, bookingPage(port));
    return;
  }
  if (action !== 'confirm_booking') {
    sendError(res, 404, 'app.err.action.not_found', 'Unknown');
    return;
  }
  const holdTok = header(req, HEADER_APP_HOLD_TOKEN);
  const confirm = header(req, HEADER_APP_CONFIRMATION);

  if (!state.v11.booking.holdCleared && !holdTok) {
    if (state.v11.holdIssued >= 3) {
      sendError(res, 429, 'app.err.hold.rate', 'Too many holds', { retry_after_ms: 60_000 });
      return;
    }
    const hold = emitHold(state, port);
    sendError(res, 428, 'app.err.hold.human_required', 'Human verification required', {
      details: { hold: holdDetails(hold, port) },
    });
    return;
  }
  if (holdTok) {
    const hold = [...state.v11.holds.values()].find((h) => h.token === holdTok);
    if (hold && hold.status === 'cleared' && !hold.tokenUsed) {
      hold.tokenUsed = true;
      state.v11.booking.holdCleared = true;
    }
  }
  if (!state.v11.booking.consentGranted) {
    sendError(res, 403, 'app.err.consent.required', 'Consent required', {
      details: { missing: { type: 'array', value: [strNode('marketing')] } },
      recoverable_actions: ['grant_consent'],
    });
    return;
  }
  if (!confirm) {
    const tok = newId('conf');
    state.v11.booking.confirmToken = tok;
    sendError(res, 428, 'app.err.action.confirmation_required', 'Confirm booking', {
      details: {
        confirmation_challenge: strNode(tok),
      },
    });
    return;
  }
  if (confirm !== state.v11.booking.confirmToken) {
    sendError(res, 403, 'app.err.action.confirmation_invalid', 'Bad confirmation');
    return;
  }
  state.v11.booking.confirmed = true;
  sendManifest(res, {
    app: '1.1',
    page: { id: 'booking', url: pageUrl(port, '/v11/booking'), title: 'Booking', version: 'bk-9' },
    state: { status: strNode('awaiting_3ds', 'Status') },
    actions: {},
  });
  void params;
}

function handleConsent(req: Request, res: Response, state: ConformanceState, port: number): void {
  const { action, params } = parseAction(req);
  if (action === 'grant_consent') {
    const version = params.version != null ? Number(params.version) : state.v11.consentVersion;
    if (version !== state.v11.consentVersion) {
      sendError(res, 409, 'app.err.consent.version_stale', 'Consent version stale');
      return;
    }
    const purposes = Array.isArray(params.purposes) ? params.purposes.map(String) : ['analytics'];
    // §5.8: unknown purpose ids → 400 consent.unknown_purpose; declared
    // catalog is the consent page's purposes object (consentGrants keys).
    for (const p of purposes) {
      if (!Object.prototype.hasOwnProperty.call(state.v11.consentGrants, p)) {
        sendError(res, 400, 'app.err.consent.unknown_purpose', `Unknown purpose: ${p}`, {
          path: `/params/purposes/${p}`,
        });
        return;
      }
    }
    for (const p of purposes) state.v11.consentGrants[p] = true;
    sendManifest(res, {
      app: '1.1',
      page: { id: 'home', url: pageUrl(port, '/v11/home'), title: 'Home', version: 'hm-2' },
      state: { consent: consentState(state.v11.consentGrants, state.v11.consentVersion) },
      actions: {},
    });
    return;
  }
  if (action === 'revoke_consent') {
    const ids = Array.isArray(params.ids) ? params.ids.map(String) : [];
    for (const id of ids) {
      if (id === 'necessary') continue;
      state.v11.consentGrants[id] = false;
    }
    sendManifest(res, {
      app: '1.1',
      page: { id: 'home', url: pageUrl(port, '/v11/home'), title: 'Home', version: 'hm-3' },
      state: { consent: consentState(state.v11.consentGrants, state.v11.consentVersion) },
      actions: {},
    });
    return;
  }
  if (action === 'track' || action === 'analytics') {
    if (!state.v11.consentGrants.analytics) {
      sendError(res, 403, 'app.err.consent.required', 'Consent required', {
        details: { missing: { type: 'array', value: [strNode('analytics')] } },
        recoverable_actions: ['grant_consent'],
      });
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: { id: 'home', url: pageUrl(port, '/v11/home'), title: 'Home', version: 'hm-4' },
      state: {
        consent: consentState(state.v11.consentGrants, state.v11.consentVersion),
        tracked: boolNode(true),
      },
      actions: {},
    });
    return;
  }
  if (action === 'bump_version') {
    state.v11.consentVersion += 1;
    sendManifest(res, {
      app: '1.1',
      page: { id: 'home', url: pageUrl(port, '/v11/home'), title: 'Home', version: 'hm-v' },
      state: { consent: consentState(state.v11.consentGrants, state.v11.consentVersion) },
      actions: {},
    });
    return;
  }
  sendError(res, 404, 'app.err.action.not_found', 'Unknown');
}

function handleGeo(req: Request, res: Response, _state: ConformanceState, port: number): void {
  const { params } = parseAction(req);
  const lang = req.header('accept-language') ?? '';
  if (params.loc && typeof params.loc === 'object') {
    const loc = params.loc as { lat?: unknown; lng?: unknown };
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      sendError(res, 400, 'app.err.validation.param_range', 'lat out of range', {
        path: '/params/loc/lat',
      });
      return;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      sendError(res, 400, 'app.err.validation.param_range', 'lng out of range', {
        path: '/params/loc/lng',
      });
      return;
    }
  }
  if (params.range && typeof params.range === 'object') {
    const r = params.range as { from?: string; to?: string };
    if (r.from && r.to && r.from > r.to) {
      sendError(res, 400, 'app.err.validation.param_range', 'from > to', { path: '/params/range' });
      return;
    }
  }
  if (params.dtrange && typeof params.dtrange === 'object') {
    const r = params.dtrange as { from?: string; to?: string };
    const naive = (s?: string) => !!s && !/[zZ]|[+-]\d{2}:\d{2}$/.test(s);
    if (naive(r.from) || naive(r.to)) {
      sendError(res, 400, 'app.err.validation.param_type', 'datetime_range requires offset', {
        path: '/params/dtrange',
      });
      return;
    }
  }
  if (params.qty && typeof params.qty === 'object') {
    const q = params.qty as { unit?: string };
    if (q.unit && q.unit !== 'kg') {
      sendError(res, 400, 'app.err.validation.param_unit', 'unit not allowed', {
        path: '/params/qty/unit',
      });
      return;
    }
  }
  if (params.price && typeof params.price === 'object') {
    const p = params.price as { amount?: unknown };
    if (typeof p.amount === 'number' && !Number.isInteger(p.amount)) {
      sendError(res, 400, 'app.err.validation.param_money', 'amount must be integer', {
        path: '/params/price/amount',
      });
      return;
    }
  }
  const action = (req.body as Json | undefined)?.action;
  if (
    action === 'need_q' ||
    (!('loc' in params) &&
      !('range' in params) &&
      !('q' in params) &&
      !('price' in params) &&
      !('qty' in params) &&
      !('dtrange' in params))
  ) {
    const msg = lang.toLowerCase().startsWith('fr')
      ? 'Parametre requis manquant'
      : 'Missing required param';
    sendError(res, 400, 'app.err.validation.missing_param', msg, {
      path: '/params/q',
      message_id: 'validation.missing_param',
    });
    return;
  }
  sendManifest(res, {
    app: '1.1',
    page: { id: 'geo', url: pageUrl(port, '/v11/geo'), title: 'Geo', version: 'g-2' },
    state: { ok: boolNode(true) },
    actions: {},
  });
}

function handleOrder(req: Request, res: Response, state: ConformanceState, port: number): void {
  const { action, params } = parseAction(req);
  const confirm = header(req, HEADER_APP_CONFIRMATION);
  if (action === 'set_status') {
    const next = String(params.status ?? '');
    const cur = state.v11.order.status;
    const illegal = cur === 'paid' && next === 'draft';
    if (illegal) {
      sendError(res, 409, 'app.err.commerce.illegal_transition', 'paid cannot become draft');
      return;
    }
    state.v11.order.status = next;
    sendManifest(res, orderPage(port, state));
    return;
  }
  if (action === 'pay_redirect') {
    if (!confirm) {
      const tok = newId('conf');
      state.v11.booking.confirmToken = tok;
      sendError(res, 428, 'app.err.action.confirmation_required', 'Confirm payment', {
        details: { confirmation_challenge: strNode(tok) },
      });
      return;
    }
    sendManifest(res, {
      app: '1.1',
      page: { id: 'order', url: pageUrl(port, '/v11/order'), title: 'Pay', version: 'or-pay' },
      state: { order: orderNode(state, 'awaiting_3ds') },
      actions: {
        continue_pay: {
          description: 'Bank 3DS',
          kind: 'delegate',
          input: {},
          output: { delegates_to: 'https://bank.example/3ds/start', delegate_protocol: 'https' },
          side_effect: 'financial',
          idempotent: false,
        },
      },
    });
    return;
  }
  if (action === 'refund') {
    const amount = Number(params.amount);
    if (amount > state.v11.order.total) {
      sendError(res, 400, 'app.err.commerce.amount', 'Refund exceeds order total');
      return;
    }
    state.v11.order.status = 'refunded';
    sendManifest(res, orderPage(port, state));
    return;
  }
  if (action === 'cancel') {
    if (state.v11.order.status === 'delivered') {
      sendError(res, 409, 'app.err.commerce.illegal_transition', 'Cannot cancel delivered order');
      return;
    }
    state.v11.order.status = 'cancelled';
    sendManifest(res, orderPage(port, state));
    return;
  }
  if (action === 'complete_payment') {
    state.v11.order.status = 'paid';
    sendManifest(res, orderPage(port, state));
    return;
  }
  if (action === 'mark_delivered') {
    state.v11.order.status = 'delivered';
    sendManifest(res, orderPage(port, state));
    return;
  }
  if (action === 'mark_paid') {
    state.v11.order.status = 'paid';
    sendManifest(res, orderPage(port, state));
    return;
  }
  sendError(res, 404, 'app.err.action.not_found', 'Unknown');
}

function handleBulk(
  req: Request,
  res: Response,
  _state: ConformanceState,
  port: number,
  featured: boolean,
): void {
  if (!featured) {
    sendError(res, 400, 'app.err.feature.unsupported', 'bulk_actions is not advertised');
    return;
  }
  const { params } = parseAction(req);
  const items = Array.isArray(params.items) ? params.items : [];
  const mode = String(params.mode ?? 'all_or_nothing');
  const results: Array<[string, boolean]> = [];
  let illegal = false;
  for (const it of items) {
    const row = it as { id?: string; op?: string };
    const ok = row.op !== 'illegal';
    if (!ok) illegal = true;
    results.push([String(row.id ?? '?'), ok]);
  }
  if (mode === 'all_or_nothing' && illegal) {
    sendError(res, 409, 'app.err.action.conflict', 'all_or_nothing rollback');
    return;
  }
  sendManifest(res, {
    app: '1.1',
    page: { id: 'bulk', url: pageUrl(port, '/v11/bulk'), title: 'Bulk', version: 'bu-2' },
    state: {
      items: {
        type: 'table',
        label: 'Items',
        fields: { id: 'string', ok: 'boolean' },
        value: results,
      },
    },
    actions: {},
  });
}

function handleEvents(req: Request, res: Response, state: ConformanceState, origin: string): void {
  const pageUrlQ = typeof req.query.page_url === 'string' ? req.query.page_url : undefined;
  const mode = typeof req.query.mode === 'string' ? req.query.mode : 'sse';
  const timeoutMs = Number(req.query.timeout_ms ?? 0);

  if (pageUrlQ) {
    try {
      const u = new URL(pageUrlQ, origin);
      if (u.origin !== origin) {
        sendError(res, 403, 'app.err.security.cross_origin', 'page_url is cross-origin');
        return;
      }
    } catch {
      sendError(res, 403, 'app.err.security.cross_origin', 'page_url is cross-origin');
      return;
    }
  }

  const needsAuth = pageUrlQ?.includes('/account');
  if (needsAuth) {
    const sess = resolveSession(req, state);
    if (!sess || sess.status !== 'authenticated') {
      sendError(res, 401, 'app.err.auth.required', 'Authentication required', {
        details: { login_url: strNode(`${origin}/login`), flow_id: strNode('login') },
      });
      return;
    }
  }

  if (mode !== undefined && mode !== '' && !['longpoll', 'long-poll', 'sse'].includes(mode)) {
    sendError(res, 400, 'app.err.events.mode', `Bad events mode: ${mode}`, {
      path: '/query/mode',
    });
    return;
  }

  if (mode === 'longpoll' || mode === 'long-poll') {
    const wait = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 1000;
    const lastId = Number(req.header('Last-Event-ID') ?? req.query.last_id ?? 0);
    const pending = state.v11.events.filter((e) => e.id > lastId);
    if (pending.length > 0) {
      res
        .status(200)
        .type(MEDIA_PAGE)
        .setHeader(HEADER_APP_RESPONSE_MODE, 'event')
        .setHeader(HEADER_APP_VERSION, '1.1')
        .json({ app: '1.1', type: pending[0]!.type, ...pending[0]!.data });
      return;
    }
    setTimeout(() => {
      if (!res.headersSent) {
        res.status(204).setHeader(HEADER_APP_VERSION, '1.1').end();
      }
    }, wait);
    return;
  }

  const accept = (req.headers.accept ?? '').toLowerCase();
  if (
    accept &&
    !accept.includes('text/event-stream') &&
    !accept.includes('*/*') &&
    !accept.includes('vnd.agent-page')
  ) {
    sendError(res, 406, 'app.err.negotiate.not_acceptable', 'SSE requires text/event-stream');
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', MEDIA_EVENT_STREAM);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader(HEADER_APP_VERSION, '1.1');
  res.setHeader(HEADER_APP_RESPONSE_MODE, 'event');
  res.flushHeaders?.();

  const lastId = Number(req.header('Last-Event-ID') ?? 0);
  writeSse(res, 0, 'heartbeat', { type: 'heartbeat' });
  for (const ev of state.v11.events) {
    if (ev.id <= lastId) continue;
    writeSse(res, ev.id, ev.type, {
      type: ev.type,
      version: ev.version,
      page_url: ev.pageUrl,
      ...ev.data,
    });
  }
  const client = { res, lastId, pageUrl: pageUrlQ };
  state.v11.sseClients.add(client);
  req.on('close', () => {
    state.v11.sseClients.delete(client);
  });
}
