/**
 * In-memory resume token store (SPEC-v0.5-extreme §13).
 * Tokens never persist to disk in this SDK.
 */

import { extractOrigin } from './navigate.js';

const TOKEN_RE = /^[A-Za-z0-9._~-]{16,256}$/;
const DEFAULT_TTL_S = 86_400;
const MAX_TTL_S = 2_592_000;

export interface ResumeTokenRecord {
  token: string;
  ttlSeconds: number;
  expiresAt: number;
  origin: string;
}

/**
 * Parse `Set-APP-Resume: <token>; ttl=<seconds>`. Empty token or ttl=0 clears.
 */
export function parseSetAppResume(
  header: string | null | undefined,
): { token: string; ttlSeconds: number } | null {
  if (header == null) return null;
  const trimmed = header.trim();
  if (!trimmed) return { token: '', ttlSeconds: 0 };

  const parts = trimmed
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean);
  const token = parts[0] ?? '';
  let ttlSeconds = DEFAULT_TTL_S;
  for (const part of parts.slice(1)) {
    const m = /^ttl\s*=\s*(\d+)$/i.exec(part);
    if (m) ttlSeconds = Number(m[1]);
  }
  if (!token || ttlSeconds <= 0) return { token: '', ttlSeconds: 0 };
  if (!TOKEN_RE.test(token)) return null;
  return { token, ttlSeconds: Math.min(ttlSeconds, MAX_TTL_S) };
}

export class ResumeStore {
  private readonly map = new Map<string, ResumeTokenRecord>();
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  get(originOrUrl: string): string | undefined {
    let origin: string;
    try {
      origin = extractOrigin(originOrUrl);
    } catch {
      origin = originOrUrl;
    }
    const rec = this.map.get(origin);
    if (!rec) return undefined;
    if (rec.expiresAt <= this.now()) {
      this.map.delete(origin);
      return undefined;
    }
    return rec.token;
  }

  set(originOrUrl: string, token: string, ttlSeconds = DEFAULT_TTL_S): void {
    let origin: string;
    try {
      origin = extractOrigin(originOrUrl);
    } catch {
      origin = originOrUrl;
    }
    if (!token || ttlSeconds <= 0) {
      this.map.delete(origin);
      return;
    }
    if (!TOKEN_RE.test(token)) return;
    const ttl = Math.min(ttlSeconds, MAX_TTL_S);
    this.map.set(origin, {
      token,
      ttlSeconds: ttl,
      expiresAt: this.now() + ttl * 1000,
      origin,
    });
  }

  clear(originOrUrl?: string): void {
    if (!originOrUrl) {
      this.map.clear();
      return;
    }
    let origin: string;
    try {
      origin = extractOrigin(originOrUrl);
    } catch {
      origin = originOrUrl;
    }
    this.map.delete(origin);
  }

  applyHeader(originOrUrl: string, header: string | null | undefined): void {
    const parsed = parseSetAppResume(header);
    if (!parsed) return;
    if (!parsed.token) this.clear(originOrUrl);
    else this.set(originOrUrl, parsed.token, parsed.ttlSeconds);
  }
}
