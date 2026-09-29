import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  AppHttpClient,
  HEADER_APP_IDEMPOTENCY_KEY,
  MEDIA_PAGE,
} from '@agent-page/client';
import {
  HEADER_APP_CHALLENGE,
  HoldStore,
  SessionStore,
  applyChallengeFailure,
  buildContinuationRawBody,
  checkChallengeUnattended,
  continuationMutatedOnlyOtp,
  extractChallenge,
  persistChallengeHold,
  submitChallengeContinuation,
} from '../src/index.js';

const original = JSON.stringify({
  app: '1.0',
  action: 'submit_credentials',
  params: { email: 'a@b.c', password: 'pw' },
  client: { kind: 'agent', name: 'agent-page-cli', version: '0.5.0' },
});

describe('challenge §6.4 / SPEC §18.2', () => {
  function setup() {
    const store = new SessionStore(mkdtempSync(join(tmpdir(), 'ap-ch-')));
    store.ensureHome();
    const session = store.createSession({ origin: 'https://example.com' });
    return { store, holds: new HoldStore(store), session };
  }

  it('extracts 428 challenge_required details', () => {
    const err = new AppError('app.err.auth.challenge_required', {
      details: {
        challenge: {
          type: 'object',
          value: {
            id: { type: 'string', value: 'chg_01J8Z2' },
            kind: { type: 'string', value: 'otp' },
            param: { type: 'string', value: 'otp' },
            ttl_ms: { type: 'number', value: 120000 },
            attempts_remaining: { type: 'number', value: 3 },
          },
        },
      },
    });
    const ch = extractChallenge(err);
    expect(ch?.id).toBe('chg_01J8Z2');
    expect(ch?.param).toBe('otp');
  });

  it('persist challenge hold; continuation mutates only otp param and reuses key', async () => {
    const { holds, session } = setup();
    persistChallengeHold(holds, {
      sessionId: session.id,
      action: 'submit_credentials',
      page_url: 'https://example.com/login',
      page_version: 'lg-1',
      post_url: 'https://example.com/login',
      rawBody: original,
      idempotency_key: 'idem_same',
      challengeDetails: { id: 'chg_01J8Z2', kind: 'otp', param: 'otp', attempts_remaining: 3 },
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    });

    const continued = buildContinuationRawBody(original, 'otp', '123456');
    expect(continuationMutatedOnlyOtp(original, continued, 'otp')).toBe(true);
    expect(JSON.parse(continued).params.email).toBe('a@b.c');
    expect(JSON.parse(continued).params.password).toBe('pw');
    expect(JSON.parse(continued).params.otp).toBe('123456');
    expect(JSON.parse(continued).action).toBe('submit_credentials');

    const seen: { body?: string; challenge?: string | null; key?: string | null } = {};
    const http = new AppHttpClient({
      fetch: async (_input, init) => {
        const h = new Headers(init?.headers);
        seen.body = String(init?.body ?? '');
        seen.challenge = h.get(HEADER_APP_CHALLENGE);
        seen.key = h.get(HEADER_APP_IDEMPOTENCY_KEY);
        return new Response(
          JSON.stringify({
            app: '1.0',
            page: { id: 'home', url: 'https://example.com/', version: 'v1' },
            state: {},
          }),
          { status: 200, headers: { 'content-type': MEDIA_PAGE } },
        );
      },
    });
    const { rawBody } = await submitChallengeContinuation(http, holds, session.id, {
      kind: 'otp',
      value: '123456',
    });
    expect(rawBody).toBe(continued);
    expect(seen.body).toBe(continued);
    expect(seen.challenge).toBe('chg_01J8Z2');
    expect(seen.key).toBe('idem_same');
  });

  it('failed OTP keeps hold', () => {
    const { holds, session } = setup();
    persistChallengeHold(holds, {
      sessionId: session.id,
      action: 'submit_credentials',
      page_url: 'https://example.com/login',
      page_version: 'lg-1',
      post_url: 'https://example.com/login',
      rawBody: original,
      challengeDetails: { id: 'chg_01', kind: 'otp', param: 'otp', attempts_remaining: 2 },
    });
    const kept = applyChallengeFailure(holds, session.id, 'app.err.auth.challenge_failed');
    expect(kept).toBeTruthy();
    expect(kept?.attempts_remaining).toBe(1);
    expect(holds.load(session.id)?.challenge).toBe('chg_01');
  });

  it('unattended after ttl', () => {
    const { holds, session } = setup();
    const file = persistChallengeHold(holds, {
      sessionId: session.id,
      action: 'submit_credentials',
      page_url: 'https://example.com/login',
      page_version: 'lg-1',
      post_url: 'https://example.com/login',
      rawBody: original,
      challengeDetails: { id: 'chg_01', kind: 'otp', param: 'otp', ttl_ms: 1 },
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => checkChallengeUnattended(file)).toThrow(AppError);
    try {
      checkChallengeUnattended(file);
    } catch (e) {
      expect((e as AppError).code).toBe('app.err.auth.challenge_unattended');
    }
  });

  it('Mode A confirmation is a separate gate from challenge continuation', () => {
    const { holds, session } = setup();
    persistChallengeHold(holds, {
      sessionId: session.id,
      action: 'pay',
      page_url: 'https://example.com/pay',
      page_version: 'v1',
      post_url: 'https://example.com/pay',
      rawBody: original,
      challengeDetails: { id: 'chg_mfa', kind: 'otp', param: 'otp' },
    });
    const file = holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'pay',
      page_url: 'https://example.com/pay',
      page_version: 'v1',
      post_url: 'https://example.com/pay',
      rawBody: original,
      challenge: 'conf_mode_a',
    });
    expect(file.gates.map((g) => g.kind)).toEqual(['challenge', 'confirmation']);
    expect(file.challenge).toBe('conf_mode_a');
    const continued = buildContinuationRawBody(original, 'otp', '000000');
    expect(continued).not.toBe(decodeRawBodyStringFor(file));
  });
});

function decodeRawBodyStringFor(file: { raw_body_b64: string }): string {
  return Buffer.from(file.raw_body_b64, 'base64').toString('utf8');
}
