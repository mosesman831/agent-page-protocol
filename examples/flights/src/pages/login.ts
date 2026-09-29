import {
  AppError,
  bumpVersion,
  type ActionDef,
  type ActionHandler,
  type PageManifest,
} from '@agent-page/server';
import { asManifest } from '../protocol.js';
import {
  DEMO_OTP,
  DEMO_PASSWORD,
  type SessionStore,
  buildChallengeStateNode,
  buildSessionStateNode,
  lookupUser,
  type DemoSession,
} from '../sessions.js';

export function parseLoginPath(pathname: string): boolean {
  return pathname === '/login' || pathname === '/logout';
}

function flowMeta(step: 'credentials' | 'mfa' | 'complete', index: number, origin: string) {
  return {
    id: 'login',
    kind: 'password',
    step,
    step_index: index,
    step_count: 2,
    can_abandon: true,
    abandon_url: `${origin}/flights`,
    resume_supported: true,
  };
}

export function buildLoginManifest(
  pageOrigin: string,
  session: DemoSession | undefined,
  options?: { version?: string; etag?: string; logoutPage?: boolean },
): PageManifest {
  const logoutPage = options?.logoutPage === true;
  const authenticated = session?.status === 'authenticated';
  const pendingMfa = session?.status === 'pending_mfa';
  const pageUrl = logoutPage ? `${pageOrigin}/logout` : `${pageOrigin}/login`;
  const pageId = logoutPage ? 'logout' : 'login';
  const step = pendingMfa ? 'mfa' : authenticated ? 'complete' : 'credentials';
  const stepIndex = pendingMfa ? 2 : authenticated ? 2 : 1;

  const actions: Record<string, ActionDef> = {};
  const manifest = asManifest({
    app: '1.1',
    page: {
      id: pageId,
      url: pageUrl,
      title: logoutPage ? 'Sign out' : authenticated ? 'Signed in' : 'Sign in',
      version: options?.version ?? 'lg-1',
      etag: options?.etag ?? 'W/"login-1"',
      language: 'en',
      description: logoutPage ? 'Sign out of Acme Flights' : 'Sign in with email and password',
    },
    state: {
      session: buildSessionStateNode(session),
    },
    actions,
    navigation: {
      breadcrumb: [
        { label: 'Search', url: `${pageOrigin}/flights`, page_id: 'flight-search', rel: 'up' },
        { label: logoutPage ? 'Sign out' : 'Sign in', url: pageUrl, page_id: pageId },
      ],
    },
    present: { layout: 'form' },
    meta: {
      flow: flowMeta(step, stepIndex, pageOrigin),
      cache: { public: false, max_age: 0 },
      session_epoch: session?.epoch ?? 0,
    },
  });

  if (pendingMfa && session?.challenge) {
    manifest.state.challenge = buildChallengeStateNode(session.challenge);
  }

  if (logoutPage || authenticated) {
    actions.logout = {
      description: 'Sign out of this site',
      kind: 'mutate',
      input: {
        all_devices: { type: 'boolean', required: false, default: false },
      },
      output: { state_diff: true, navigates_to: `${pageOrigin}/flights` },
      side_effect: 'identity',
      idempotent: true,
      timeout_ms: 10000,
      auth: 'session',
    };
  }

  if (!logoutPage && !authenticated) {
    actions.submit_credentials = {
      description: 'Sign in with email and password',
      kind: 'mutate',
      input: {
        email: {
          type: 'string',
          required: true,
          min_length: 3,
          max_length: 254,
          description: 'Account email',
        },
        password: {
          type: 'string',
          required: true,
          min_length: 1,
          max_length: 256,
          description: 'Account password',
        },
      },
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      timeout_ms: 15000,
      auth: 'none',
      requires_confirmation: false,
      policy: {
        pii_params: ['email'],
        secret_params: ['password'],
      },
    };
  }

  if (!logoutPage && pendingMfa) {
    actions.submit_otp = {
      description: 'Submit the verification code',
      kind: 'mutate',
      input: {
        otp: {
          type: 'string',
          required: true,
          min_length: 6,
          max_length: 6,
          pattern: '^[0-9]{6}$',
        },
      },
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      timeout_ms: 15000,
      auth: 'none',
      policy: { secret_params: ['otp'] },
    };
    actions.resend_otp = {
      description: 'Send a new verification code',
      kind: 'mutate',
      input: {},
      output: { state_diff: true },
      side_effect: 'identity',
      idempotent: false,
      timeout_ms: 15000,
      auth: 'none',
    };
    actions.abandon = {
      description: 'Cancel sign-in',
      kind: 'navigate',
      input: {},
      output: { navigates_to: `${pageOrigin}/flights` },
      side_effect: 'safe',
      idempotent: true,
      timeout_ms: 5000,
      auth: 'none',
    };
  }

  return manifest;
}

function sessionFromCtx(store: SessionStore, sessionId: string | undefined): DemoSession {
  return store.getOrCreate(sessionId);
}

export function createLoginHandlers(
  pageOrigin: string,
  store: SessionStore,
): Record<string, ActionHandler> {
  return {
    submit_credentials: async ({ params, sessionId, requestId, manifest }) => {
      const session = sessionFromCtx(store, sessionId);
      if (session.lockedUntil && Date.now() < session.lockedUntil) {
        throw new AppError('app.err.auth.locked', {
          message: 'Identity is locked',
          retry_after_ms: session.lockedUntil - Date.now(),
        });
      }

      const email = String(params.email ?? '');
      const password = String(params.password ?? '');
      const user = lookupUser(email);
      const ok = Boolean(user && password === DEMO_PASSWORD);
      if (!ok) {
        session.failedLogins += 1;
        if (session.failedLogins >= 5) {
          session.lockedUntil = Date.now() + 15 * 60 * 1000;
          session.status = 'locked';
          throw new AppError('app.err.auth.locked', {
            retry_after_ms: 15 * 60 * 1000,
          });
        }
        throw new AppError('app.err.auth.failed', {
          message: 'Sign in failed',
          details: {
            attempts_remaining: {
              type: 'number',
              value: Math.max(0, 5 - session.failedLogins),
            },
          },
        });
      }

      if (user!.mfa) {
        store.beginMfa(session, user!.email);
        store.stageIssuance(requestId, session);
        return { type: 'navigate', url: `${pageOrigin}/mfa`, mode: 'push' };
      }

      store.authenticate(session, user!.email);
      store.stageIssuance(requestId, session);
      const next = buildLoginManifest(pageOrigin, session, {
        version: bumpVersion(manifest.page.version),
        etag: 'W/"login-ok"',
      });
      return { type: 'diff', nextManifest: next };
    },

    submit_otp: async ({ params, sessionId, requestId }) => {
      const session = sessionFromCtx(store, sessionId);
      const ch = session.challenge;
      if (!ch || session.status !== 'pending_mfa') {
        throw new AppError('app.err.auth.challenge_invalid', {
          message: 'No active challenge',
        });
      }
      if (ch.spent || Date.parse(ch.expiresAt) < Date.now()) {
        throw new AppError('app.err.auth.challenge_expired');
      }
      const otp = String(params.otp ?? '');
      if (otp !== ch.otp && otp !== DEMO_OTP) {
        ch.attemptsRemaining -= 1;
        if (ch.attemptsRemaining <= 0) {
          session.status = 'locked';
          session.lockedUntil = Date.now() + 15 * 60 * 1000;
          throw new AppError('app.err.auth.locked', { retry_after_ms: 15 * 60 * 1000 });
        }
        throw new AppError('app.err.auth.challenge_failed', {
          details: {
            attempts_remaining: { type: 'number', value: ch.attemptsRemaining },
            challenge: buildChallengeStateNode(ch),
          },
        });
      }
      ch.spent = true;
      const email = (session.email ?? 'mfa@example.com') as 'mfa@example.com';
      store.authenticate(session, email);
      store.stageIssuance(requestId, session);
      return { type: 'navigate', url: `${pageOrigin}/login`, mode: 'replace' };
    },

    resend_otp: async ({ sessionId, requestId, manifest }) => {
      const session = sessionFromCtx(store, sessionId);
      if (session.status !== 'pending_mfa' || !session.email) {
        throw new AppError('app.err.auth.challenge_invalid');
      }
      store.beginMfa(session, session.email as 'mfa@example.com');
      store.stageIssuance(requestId, session);
      const next = buildLoginManifest(pageOrigin, session, {
        version: bumpVersion(manifest.page.version),
        etag: 'W/"login-mfa-resend"',
      });
      return { type: 'diff', nextManifest: next };
    },

    logout: async ({ params, sessionId, requestId }) => {
      const session = sessionFromCtx(store, sessionId);
      store.logout(session, params.all_devices === true);
      store.stageIssuance(requestId, session, true);
      return { type: 'navigate', url: `${pageOrigin}/flights`, mode: 'replace' };
    },

    abandon: async () => ({
      type: 'navigate',
      url: `${pageOrigin}/flights`,
      mode: 'replace',
    }),
  };
}
