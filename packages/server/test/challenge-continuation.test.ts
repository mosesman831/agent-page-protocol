/**
 * §18.2 inline challenge continuation through createPageHandler:
 * POST (idem key) → 428 challenge_required with an object-node
 * `details.challenge` (canonical spec shape: challenge.value.id.value) →
 * retry same key + X-APP-Challenge + otp param → dispatch succeeds.
 * A failed attempt must keep the challenge open for further retries.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import {
  createAppServer,
  MemoryIdempotencyStore,
  MemoryChallengeStore,
  issueOtpChallenge,
  challengeToObject,
  verifyOtp,
  spendChallenge,
  AppError,
  MEDIA_ACTION,
  MEDIA_PAGE,
  bumpVersion,
  type PageManifest,
} from '../src/index.js';

const str = (v: string) => ({ type: 'string' as const, value: v });

function makeManifest(): PageManifest {
  return {
    app: '1.0',
    page: { id: 'secure', url: 'http://localhost:3000/secure', title: 'Secure', version: 'v1' },
    state: { status: str('anonymous', 'Status') },
    actions: {
      login: {
        description: 'Sign in',
        kind: 'mutate',
        input: {
          user: { type: 'string', required: true },
          otp: { type: 'string' },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: false,
      },
    },
  };
}

function app() {
  let manifest = makeManifest();
  const challenges = new MemoryChallengeStore();
  return createAppServer({
    pageOrigin: 'http://localhost:3000',
    idempotencyStore: new MemoryIdempotencyStore(),
    getManifest: async () => manifest,
    actionHandlers: {
      login: async (ctx) => {
        const header = ctx.headers['x-app-challenge'];
        if (typeof header === 'string' && header) {
          const ok = await verifyOtp(challenges, { id: header, otp: String(ctx.params.otp ?? '') });
          if (!ok.ok) throw new AppError(ok.error.envelope.error.code);
          await spendChallenge(challenges, header);
          const next = structuredClone(ctx.manifest);
          next.page.version = bumpVersion(next.page.version);
          next.state.status = str('signed-in', 'Status');
          manifest = next;
          return { type: 'full', manifest: next };
        }
        const rec = await issueOtpChallenge(challenges, { otp: '246810' });
        const obj = challengeToObject(rec);
        throw new AppError('app.err.auth.challenge_required', {
          details: {
            challenge: {
              type: 'object',
              value: {
                id: str(obj.id),
                kind: str(obj.kind),
                param: str('otp'),
                attempts_remaining: { type: 'number', value: obj.attempts_remaining },
              },
            },
          },
        });
      },
    },
    path: '/secure',
  });
}

const post = (a: ReturnType<typeof app>, body: object, extra: Record<string, string> = {}) =>
  request(a)
    .post('/secure')
    .set('Content-Type', MEDIA_ACTION)
    .set('Accept', MEDIA_PAGE)
    .set('Origin', 'http://localhost:3000')
    .set('X-APP-Accept-Versions', '1.0, 1.1')
    .set(extra)
    .send(body);

describe('§18.2 inline challenge continuation', () => {
  it('accepts a retry that only adds the advertised otp param', async () => {
    const a = app();
    const first = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0001' },
    );
    expect(first.status).toBe(428);
    expect(first.body.error.code).toBe('app.err.auth.challenge_required');
    const chId = first.body.error.details.challenge.value.id.value as string;
    expect(chId).toMatch(/^chg_/);

    const cont = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev', otp: '246810' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0001', 'X-APP-Challenge': chId },
    );
    expect(cont.status).toBe(200);
    expect(cont.body.state.status.value).toBe('signed-in');
  });

  it('keeps the challenge open after a failed attempt (same id retries)', async () => {
    const a = app();
    const first = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0002' },
    );
    const chId = first.body.error.details.challenge.value.id.value as string;

    const bad = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev', otp: '000000' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0002', 'X-APP-Challenge': chId },
    );
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('app.err.auth.challenge_failed');

    const good = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev', otp: '246810' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0002', 'X-APP-Challenge': chId },
    );
    expect(good.status).toBe(200);
    expect(good.body.state.status.value).toBe('signed-in');
  });

  it('rejects a continuation under a different challenge id', async () => {
    const a = app();
    const first = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0003' },
    );
    const chId = first.body.error.details.challenge.value.id.value as string;
    const wrong = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev', otp: '246810' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0003', 'X-APP-Challenge': 'chg_wrong' },
    );
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.code).toBe('app.err.auth.challenge_invalid');
    void chId;
  });

  it('still rejects a plain conflict retry (no challenge header)', async () => {
    const a = app();
    await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0004' },
    );
    const retry = await post(
      a,
      { app: '1.1', action: 'login', params: { user: 'dev', otp: '246810' } },
      { 'X-APP-Idempotency-Key': 'k-cont-0004' },
    );
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('app.err.action.idempotency_conflict');
  });
});
