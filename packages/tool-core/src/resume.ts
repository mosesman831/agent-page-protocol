/**
 * Parse Set-APP-Resume; send X-APP-Resume; 0600 store under resume/.
 * Never put the token in session JSON (CLIENT-TOOL-CONTRACT D-3 / §9.3).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, SessionStore } from './session-store.js';
import { HEADER_APP_RESUME, HEADER_SET_APP_RESUME, type SessionFile } from './types.js';

const TOKEN_RE = /^[A-Za-z0-9._~-]{16,256}$/;
const DEFAULT_TTL_S = 86_400;
const MAX_TTL_S = 2_592_000;

export interface ResumeToken {
  token: string;
  ttl: number;
  expires_at: string;
}

export function parseSetAppResume(header: string | null | undefined): ResumeToken | null {
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  const token = parts[0] ?? '';
  if (!TOKEN_RE.test(token)) return null;
  let ttl = DEFAULT_TTL_S;
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    if (eq <= 0) continue;
    const k = p.slice(0, eq).trim().toLowerCase();
    const v = p.slice(eq + 1).trim();
    if (k === 'ttl') {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) ttl = Math.min(MAX_TTL_S, Math.floor(n));
    }
  }
  if (ttl === 0) {
    return { token: '', ttl: 0, expires_at: new Date(0).toISOString() };
  }
  return {
    token,
    ttl,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

export function resumeFilePath(store: SessionStore, origin: string): string {
  const hex = createHash('sha256').update(origin).digest('hex');
  return join(store.resumeDir, `${hex}.token`);
}

export function storeResumeToken(store: SessionStore, origin: string, parsed: ResumeToken): void {
  store.ensureHome();
  const path = resumeFilePath(store, origin);
  if (!parsed.token || parsed.ttl === 0) {
    try {
      rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
    return;
  }
  atomicWrite(path, parsed.token, 0o600);
}

export function loadResumeToken(store: SessionStore, origin: string): string | null {
  const path = resumeFilePath(store, origin);
  if (!existsSync(path)) return null;
  try {
    const token = readFileSync(path, 'utf8').trim();
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function resumeHeaders(token: string | null | undefined): Record<string, string> {
  if (!token) return {};
  return { [HEADER_APP_RESUME]: token };
}

export function applyResumePresence(
  session: SessionFile,
  present: boolean,
  expiresAt?: string | null,
): SessionFile {
  return {
    ...session,
    resume: {
      present,
      expires_at: present ? (expiresAt ?? session.resume?.expires_at ?? null) : null,
      header: 'X-APP-Resume',
    },
  };
}

/** Capture Set-APP-Resume from a response; never copy the value into session JSON. */
export function captureResumeFromHeaders(
  store: SessionStore,
  origin: string,
  headers: Headers,
  session?: SessionFile | null,
): SessionFile | null {
  const raw = headers.get(HEADER_SET_APP_RESUME) ?? headers.get('set-app-resume');
  const parsed = parseSetAppResume(raw);
  if (!parsed) return session ?? null;
  storeResumeToken(store, origin, parsed);
  if (!session) return null;
  return applyResumePresence(session, parsed.ttl > 0 && !!parsed.token, parsed.expires_at);
}
