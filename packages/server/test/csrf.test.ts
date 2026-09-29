import { describe, it, expect } from 'vitest';
import { checkCsrf, hasNonCookieAuth } from '../src/csrf.js';

const PAGE = 'https://example.com';

describe('CSRF Origin priority (§10.2)', () => {
  it('accepts matching Origin', () => {
    const r = checkCsrf({
      method: 'POST',
      origin: 'https://example.com',
      appOrigin: 'https://evil.com', // ignored when Origin present
      pageOrigin: PAGE,
    });
    expect(r.ok).toBe(true);
    expect(r.used).toBe('Origin');
  });

  it('rejects mismatched Origin even when X-APP-Origin is valid', () => {
    const r = checkCsrf({
      method: 'POST',
      origin: 'https://evil.com',
      appOrigin: 'https://example.com',
      pageOrigin: PAGE,
      hasValidAuth: true,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('app.err.security.csrf');
    expect(r.used).toBe('Origin');
  });

  it('uses X-APP-Origin only when Origin is absent', () => {
    const r = checkCsrf({
      method: 'POST',
      origin: null,
      appOrigin: 'https://example.com',
      pageOrigin: PAGE,
      hasValidAuth: true,
    });
    expect(r.ok).toBe(true);
    expect(r.used).toBe('X-APP-Origin');
  });

  it('rejects missing Origin and X-APP-Origin', () => {
    const r = checkCsrf({
      method: 'POST',
      pageOrigin: PAGE,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('app.err.security.csrf');
  });

  it('rejects X-APP-Origin without auth when required', () => {
    const r = checkCsrf({
      method: 'POST',
      appOrigin: 'https://example.com',
      pageOrigin: PAGE,
      hasValidAuth: false,
    });
    expect(r.ok).toBe(false);
  });

  it('Origin absent + X-APP-Origin match + Authorization → ok', () => {
    const headers = { authorization: 'Bearer test-token' };
    expect(hasNonCookieAuth(headers)).toBe(true);
    const r = checkCsrf({
      method: 'POST',
      origin: null,
      appOrigin: PAGE,
      pageOrigin: PAGE,
      hasValidAuth: hasNonCookieAuth(headers),
    });
    expect(r.ok).toBe(true);
    expect(r.used).toBe('X-APP-Origin');
  });

  it('Origin absent + X-APP-Origin match + X-API-Key → ok', () => {
    const headers = { 'x-api-key': 'key-123' };
    expect(hasNonCookieAuth(headers)).toBe(true);
    const r = checkCsrf({
      method: 'POST',
      origin: null,
      appOrigin: PAGE,
      pageOrigin: PAGE,
      hasValidAuth: hasNonCookieAuth(headers),
    });
    expect(r.ok).toBe(true);
    expect(r.used).toBe('X-APP-Origin');
  });

  it('Origin absent + X-APP-Origin match + Cookie only → reject', () => {
    const headers = { cookie: 'session=abc' };
    expect(hasNonCookieAuth(headers)).toBe(false);
    const r = checkCsrf({
      method: 'POST',
      origin: null,
      appOrigin: PAGE,
      pageOrigin: PAGE,
      hasValidAuth: hasNonCookieAuth(headers),
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('app.err.security.csrf');
    expect(r.used).toBe('X-APP-Origin');
  });

  it('chrome-extension:// Origin mismatch → reject even with X-APP-Origin + auth', () => {
    const r = checkCsrf({
      method: 'POST',
      origin: 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456',
      appOrigin: PAGE,
      pageOrigin: PAGE,
      hasValidAuth: true,
    });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('app.err.security.csrf');
    expect(r.used).toBe('Origin');
  });

  it('skips CSRF on GET by default', () => {
    const r = checkCsrf({
      method: 'GET',
      pageOrigin: PAGE,
    });
    expect(r.ok).toBe(true);
  });
});
