import { describe, it, expect, beforeEach } from 'vitest';
import {
  MemorySessionStore,
  authenticateWithResume,
  createAuthenticatedSession,
  mintResume,
  spendRefreshToken,
  isResumeTokenFormat,
  RESUME_TOKEN_RE,
} from '../src/session.js';

describe('session resume rotate (MF-6a)', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore();
  });

  it('mints resume tokens matching 16-256 [A-Za-z0-9._~-]+', async () => {
    const { session } = await createAuthenticatedSession(store, { sessionId: 'sess_1' });
    const minted = await mintResume(store, { sessionId: session.id });
    expect(isResumeTokenFormat(minted.token)).toBe(true);
    expect(RESUME_TOKEN_RE.test(minted.token)).toBe(true);
    expect(minted.token.length).toBeGreaterThanOrEqual(16);
    expect(minted.header).toMatch(/ttl=86400/);
  });

  it('rotates resume on authenticated use when resume-alone, without invalidating the session', async () => {
    const created = await createAuthenticatedSession(store, {
      sessionId: 'sess_a',
      subjectRef: 'usr_1',
    });
    const first = await mintResume(store, { sessionId: created.session.id });

    const auth = await authenticateWithResume(store, {
      resumeToken: first.token,
      sessionResumeEnabled: true,
      resumeAlone: true,
    });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.rotatedResume).toBeTruthy();
    expect(auth.rotatedResume).not.toBe(first.token);
    expect(auth.session.id).toBe(created.session.id);
    expect(auth.session.status).toBe('authenticated');
    expect(auth.session.refreshFamilyId).toBe(created.session.refreshFamilyId);

    const replay = await authenticateWithResume(store, {
      resumeToken: first.token,
      sessionResumeEnabled: true,
      resumeAlone: true,
    });
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.error.envelope.error.code).toBe('app.err.auth.resume_invalid');
    expect(replay.error.httpStatus).toBe(401);

    const again = await authenticateWithResume(store, {
      resumeToken: auth.rotatedResume!,
      sessionResumeEnabled: true,
      resumeAlone: true,
    });
    expect(again.ok).toBe(true);
  });

  it('does not rotate when another authenticator is present', async () => {
    const created = await createAuthenticatedSession(store, { sessionId: 'sess_b' });
    const first = await mintResume(store, { sessionId: created.session.id });
    const auth = await authenticateWithResume(store, {
      resumeToken: first.token,
      sessionResumeEnabled: true,
      resumeAlone: false,
    });
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.rotatedResume).toBeUndefined();
  });

  it('revokes the refresh family on refresh reuse', async () => {
    const created = await createAuthenticatedSession(store, { sessionId: 'sess_c' });
    const first = created.refreshToken;
    const rotated = await spendRefreshToken(store, { refreshToken: first });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    const reuse = await spendRefreshToken(store, { refreshToken: first });
    expect(reuse.ok).toBe(false);
    if (reuse.ok) return;
    expect(reuse.error.envelope.error.code).toBe('app.err.auth.refresh_reuse');
    expect(reuse.error.httpStatus).toBe(401);

    const next = await spendRefreshToken(store, { refreshToken: rotated.refreshToken });
    expect(next.ok).toBe(false);
    if (next.ok) return;
    expect(next.error.envelope.error.code).toBe('app.err.auth.refresh_reuse');
  });
});
