/**
 * Demo identity sessions. Tokens are issued only via response headers,
 * never in JSON bodies.
 */

import { randomBytes } from 'node:crypto';
import type { StateNode } from '@agent-page/server';
import {
  CONSENT_VERSION,
  SESSION_STATUS_OPTIONS,
  boolNode,
  datetimeNode,
  enumNode,
  stringNode,
  type SessionStatus,
} from './protocol.js';

export const DEMO_PASSWORD = 'correct-horse';

export const DEMO_USERS = {
  'user@example.com': {
    email: 'user@example.com',
    password: DEMO_PASSWORD,
    mfa: false,
    subject: 'usr_demo',
  },
  'mfa@example.com': {
    email: 'mfa@example.com',
    password: DEMO_PASSWORD,
    mfa: true,
    subject: 'usr_mfa',
  },
} as const;

export const DEMO_OTP = '123456';

export type DemoUserEmail = keyof typeof DEMO_USERS;

export interface ChallengeSlot {
  id: string;
  kind: 'otp';
  channel: 'email';
  email: string;
  otp: string;
  expiresAt: string;
  ttlMs: number;
  attemptsRemaining: number;
  maxAttempts: number;
  param: string;
  spent: boolean;
}

export interface HoldSlot {
  id: string;
  kind: 'tos';
  action: string;
  verifyUrl: string;
  expiresAt: string;
  ttlMs: number;
  cleared: boolean;
}

export interface DemoSession {
  id: string;
  status: SessionStatus | 'pending_consent' | 'locked';
  email?: string;
  subjectRef?: string;
  accessToken?: string;
  refreshToken?: string;
  resumeToken?: string;
  expiresAt?: string;
  refreshAt?: string;
  epoch: number;
  consent: Record<string, boolean>;
  consentVersion: string;
  failedLogins: number;
  lockedUntil?: number;
  challenge?: ChallengeSlot;
  hold?: HoldSlot;
}

export interface HeaderIssuance {
  sessionId: string;
  accessToken?: string;
  refreshToken?: string;
  resumeToken?: string;
  expireCookie?: boolean;
  epoch: number;
}

const DEFAULT_CONSENT: Record<string, boolean> = {
  necessary: true,
  analytics: false,
  marketing: false,
};

function token(prefix: string): string {
  return `${prefix}${randomBytes(24).toString('base64url')}`;
}

function newId(prefix: string): string {
  return `${prefix}${randomBytes(16).toString('hex')}`;
}

export class SessionStore {
  private readonly byId = new Map<string, DemoSession>();
  private readonly byAccess = new Map<string, string>();
  private readonly byResume = new Map<string, string>();
  private readonly issuance = new Map<string, HeaderIssuance>();

  get(id: string | undefined): DemoSession | undefined {
    if (!id || id === 'anon') return undefined;
    return this.byId.get(id);
  }

  createAnonymous(): DemoSession {
    const session: DemoSession = {
      id: newId('ses_'),
      status: 'anonymous',
      epoch: 0,
      consent: { ...DEFAULT_CONSENT },
      consentVersion: CONSENT_VERSION,
      failedLogins: 0,
    };
    this.byId.set(session.id, session);
    return session;
  }

  getOrCreate(id: string | undefined): DemoSession {
    if (!id || id === 'anon') return this.createAnonymous();
    const existing = this.get(id);
    if (existing) return existing;
    const session: DemoSession = {
      id,
      status: 'anonymous',
      epoch: 0,
      consent: { necessary: true, analytics: false, marketing: false },
      consentVersion: CONSENT_VERSION,
      failedLogins: 0,
    };
    this.byId.set(session.id, session);
    return session;
  }

  byAccessToken(tokenValue: string | undefined): DemoSession | undefined {
    if (!tokenValue) return undefined;
    const id = this.byAccess.get(tokenValue);
    return id ? this.byId.get(id) : undefined;
  }

  byResumeToken(tokenValue: string | undefined): DemoSession | undefined {
    if (!tokenValue) return undefined;
    const id = this.byResume.get(tokenValue);
    return id ? this.byId.get(id) : undefined;
  }

  authenticate(session: DemoSession, email: DemoUserEmail): void {
    const user = DEMO_USERS[email];
    const now = Date.now();
    session.email = user.email;
    session.subjectRef = user.subject;
    session.status = 'authenticated';
    session.expiresAt = new Date(now + 60 * 60 * 1000).toISOString();
    session.refreshAt = new Date(now + 50 * 60 * 1000).toISOString();
    session.accessToken = token('at_');
    session.refreshToken = token('rt_');
    session.resumeToken = token('rsm_');
    session.challenge = undefined;
    session.failedLogins = 0;
    this.byAccess.set(session.accessToken, session.id);
    this.byResume.set(session.resumeToken, session.id);
    this.byId.set(session.id, session);
  }

  beginMfa(session: DemoSession, email: DemoUserEmail): ChallengeSlot {
    const user = DEMO_USERS[email];
    const ttlMs = 300000;
    const challenge: ChallengeSlot = {
      id: newId('chg_'),
      kind: 'otp',
      channel: 'email',
      email: user.email,
      otp: DEMO_OTP,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      ttlMs,
      attemptsRemaining: 3,
      maxAttempts: 5,
      param: 'otp',
      spent: false,
    };
    session.status = 'pending_mfa';
    session.email = user.email;
    session.subjectRef = user.subject;
    session.challenge = challenge;
    this.byId.set(session.id, session);
    return challenge;
  }

  logout(session: DemoSession, allDevices = false): void {
    void allDevices;
    if (session.accessToken) this.byAccess.delete(session.accessToken);
    if (session.resumeToken) this.byResume.delete(session.resumeToken);
    session.status = 'anonymous';
    session.email = undefined;
    session.subjectRef = undefined;
    session.accessToken = undefined;
    session.refreshToken = undefined;
    session.resumeToken = undefined;
    session.expiresAt = undefined;
    session.refreshAt = undefined;
    session.challenge = undefined;
    session.epoch += 1;
    this.byId.set(session.id, session);
  }

  stageIssuance(requestId: string, session: DemoSession, expireCookie = false): void {
    this.issuance.set(requestId, {
      sessionId: session.id,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      resumeToken: session.resumeToken,
      expireCookie,
      epoch: session.epoch,
    });
  }

  takeIssuance(requestId: string | undefined): HeaderIssuance | undefined {
    if (!requestId) return undefined;
    const v = this.issuance.get(requestId);
    if (v) this.issuance.delete(requestId);
    return v;
  }

  grantConsent(session: DemoSession, purposes: Array<{ id: string; granted: boolean }>): void {
    for (const p of purposes) {
      if (p.id === 'necessary') {
        session.consent.necessary = true;
        continue;
      }
      session.consent[p.id] = p.granted;
    }
    this.byId.set(session.id, session);
  }

  hasPurpose(session: DemoSession | undefined, purpose: string): boolean {
    if (purpose === 'necessary') return true;
    if (!session) return false;
    return session.consent[purpose] === true;
  }
}

export function parseSessionCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const m = /(?:^|;\s*)session=([^;]+)/.exec(cookieHeader);
  return m?.[1];
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const m = /^Bearer\s+(\S+)/i.exec(authorization);
  return m?.[1];
}

export function resolveSession(
  store: SessionStore,
  headers: Record<string, string | string[] | undefined>,
): DemoSession | undefined {
  const raw = (name: string): string | undefined => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const access = raw('x-app-access-token') ?? bearerToken(raw('authorization'));
  const byTok = store.byAccessToken(access);
  if (byTok) return byTok;
  const resume = raw('x-app-resume');
  const byResume = store.byResumeToken(resume);
  if (byResume) return byResume;
  const sid = parseSessionCookie(raw('cookie'));
  return store.get(sid);
}

export function cookieHeader(sessionId: string, expire = false): string {
  if (expire) {
    return 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  }
  return `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`;
}

export function buildSessionStateNode(session: DemoSession | undefined): StateNode {
  const status = session?.status ?? 'anonymous';
  const value: Record<string, StateNode> = {
    status: enumNode(status, SESSION_STATUS_OPTIONS, 'Status'),
  };
  if (session && (session.status === 'authenticated' || session.status === 'pending_mfa')) {
    if (session.expiresAt) value.expires_at = datetimeNode(session.expiresAt);
    if (session.refreshAt) value.refresh_at = datetimeNode(session.refreshAt);
    value.has_access_token = boolNode(Boolean(session.accessToken));
    value.has_resume_token = boolNode(Boolean(session.resumeToken));
    if (session.subjectRef) {
      value.subject_ref = stringNode(session.subjectRef, 'Subject', true);
    }
    if (session.email) {
      const [local, domain] = session.email.split('@');
      const masked = `${(local ?? '').slice(0, 1)}***@${domain ?? 'example.com'}`;
      value.email_masked = stringNode(masked, 'Email', true);
    }
    value.scopes = {
      type: 'array',
      value: [
        { type: 'string', value: 'flights:read' },
        { type: 'string', value: 'flights:book' },
      ],
    };
  }
  return { type: 'object', label: 'Session', value };
}

export function buildConsentStateNode(session: DemoSession | undefined): StateNode {
  const grants = session?.consent ?? DEFAULT_CONSENT;
  const purposes = [
    { id: 'necessary', required: true },
    { id: 'analytics', required: false },
    { id: 'marketing', required: false },
  ];
  return {
    type: 'object',
    label: 'Consent',
    value: {
      version: stringNode(session?.consentVersion ?? CONSENT_VERSION),
      required: boolNode(false),
      purposes: {
        type: 'array',
        value: purposes.map((p) => ({
          type: 'object' as const,
          value: {
            id: stringNode(p.id),
            granted: boolNode(p.id === 'necessary' ? true : grants[p.id] === true),
            required: boolNode(p.required),
          },
        })),
      },
    },
  };
}

export function buildChallengeStateNode(challenge: ChallengeSlot): StateNode {
  const maskLocal = challenge.email.split('@')[0] ?? '';
  const mask = `${maskLocal.slice(0, 1)}***@example.com`;
  return {
    type: 'object',
    label: 'Verification',
    value: {
      id: stringNode(challenge.id),
      kind: enumNode(challenge.kind, [
        'otp',
        'totp',
        'webauthn',
        'magic_link',
        'password',
        'backup_code',
        'push',
      ]),
      channel: enumNode(challenge.channel, [
        'sms',
        'email',
        'totp',
        'authenticator_push',
        'passkey',
        'backup_code',
        'voice',
      ]),
      expires_at: datetimeNode(challenge.expiresAt),
      ttl_ms: { type: 'number', value: challenge.ttlMs },
      attempts_remaining: { type: 'number', value: challenge.attemptsRemaining },
      max_attempts: { type: 'number', value: challenge.maxAttempts },
      mask: stringNode(mask),
      length: { type: 'number', value: 6 },
      pattern: stringNode('^[0-9]{6}$'),
      param: stringNode(challenge.param),
    },
  };
}

export function lookupUser(email: string): (typeof DEMO_USERS)[DemoUserEmail] | undefined {
  const key = email.trim().toLowerCase();
  if (key === 'user@example.com' || key === 'mfa@example.com') {
    return DEMO_USERS[key];
  }
  return undefined;
}
