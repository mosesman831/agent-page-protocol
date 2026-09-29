import { AppError, bumpVersion, type ActionHandler, type PageManifest } from '@agent-page/server';
import { asManifest } from '../protocol.js';
import {
  DEMO_OTP,
  type DemoSession,
  type SessionStore,
  buildChallengeStateNode,
  buildSessionStateNode,
} from '../sessions.js';

export function parseMfaPath(pathname: string): boolean {
  return pathname === '/mfa';
}

export function buildMfaManifest(
  pageOrigin: string,
  session: DemoSession | undefined,
  options?: { version?: string },
): PageManifest | null {
  if (!session || session.status !== 'pending_mfa' || !session.challenge) {
    return null;
  }
  const pageUrl = `${pageOrigin}/mfa`;
  return asManifest({
    app: '1.1',
    page: {
      id: 'login-mfa',
      url: pageUrl,
      title: 'Enter verification code',
      version: options?.version ?? 'mfa-1',
      etag: 'W/"mfa-1"',
      language: 'en',
      description: 'Multi-factor step for Acme Flights',
    },
    state: {
      session: buildSessionStateNode(session),
      challenge: buildChallengeStateNode(session.challenge),
    },
    actions: {
      submit_otp: {
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
        output: { state_diff: true, navigates_to: `${pageOrigin}/login` },
        side_effect: 'identity',
        idempotent: false,
        timeout_ms: 15000,
        auth: 'none',
        policy: { secret_params: ['otp'] },
      },
      resend_otp: {
        description: 'Send a new verification code',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'identity',
        idempotent: false,
        timeout_ms: 15000,
        auth: 'none',
      },
      abandon: {
        description: 'Cancel sign-in',
        kind: 'navigate',
        input: {},
        output: { navigates_to: `${pageOrigin}/flights` },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 5000,
        auth: 'none',
      },
    },
    navigation: {
      breadcrumb: [
        { label: 'Sign in', url: `${pageOrigin}/login`, page_id: 'login', rel: 'up' },
        { label: 'Verify', url: pageUrl, page_id: 'login-mfa' },
      ],
    },
    present: { layout: 'form' },
    meta: {
      flow: {
        id: 'login',
        kind: 'password',
        step: 'mfa',
        step_index: 2,
        step_count: 2,
        can_abandon: true,
        abandon_url: `${pageOrigin}/flights`,
        resume_supported: true,
      },
      cache: { public: false, max_age: 0 },
    },
  });
}

export function createMfaHandlers(
  pageOrigin: string,
  store: SessionStore,
): Record<string, ActionHandler> {
  return {
    submit_otp: async ({ params, sessionId, requestId }) => {
      const session = store.getOrCreate(sessionId);
      const ch = session.challenge;
      if (!ch || session.status !== 'pending_mfa') {
        throw new AppError('app.err.auth.challenge_invalid');
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
    resend_otp: async ({ sessionId, manifest }) => {
      const session = store.getOrCreate(sessionId);
      if (session.status !== 'pending_mfa' || !session.email) {
        throw new AppError('app.err.auth.challenge_invalid');
      }
      store.beginMfa(session, session.email as 'mfa@example.com');
      const next = buildMfaManifest(pageOrigin, session, {
        version: bumpVersion(manifest.page.version),
      });
      if (!next) throw new AppError('app.err.auth.challenge_invalid');
      return { type: 'diff', nextManifest: next };
    },
    abandon: async ({ sessionId }) => {
      const session = store.get(sessionId);
      if (session) {
        session.status = 'anonymous';
        session.challenge = undefined;
      }
      return { type: 'navigate', url: `${pageOrigin}/flights`, mode: 'replace' };
    },
  };
}
