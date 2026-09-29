import { describe, it, expect, beforeEach } from 'vitest';
import {
  HOLD_MAX_PER_WINDOW,
  MemoryHoldStore,
  completeHold,
  issueHold,
  spendHoldToken,
} from '../src/hold.js';

describe('human-verification hold (§7)', () => {
  let store: MemoryHoldStore;

  beforeEach(() => {
    store = new MemoryHoldStore();
  });

  it('rates 4th hold per credential-identity in 10 minutes', async () => {
    for (let i = 0; i < HOLD_MAX_PER_WINDOW; i++) {
      const r = await issueHold(store, {
        identityKey: 'usr_1',
        actionId: `act_${i}`,
        kind: 'captcha',
        verifyUrl: 'https://example.com/holds/x',
      });
      expect(r.ok).toBe(true);
    }
    const fourth = await issueHold(store, {
      identityKey: 'usr_1',
      actionId: 'act_3',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/x',
    });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) {
      expect(fourth.error.envelope.error.code).toBe('app.err.hold.rate');
      expect(fourth.error.httpStatus).toBe(429);
    }
  });

  it('rejects widget_url that is not https or loopback http', async () => {
    const bad = await issueHold(store, {
      identityKey: 'usr_1',
      actionId: 'act_w1',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/x',
      widgetUrl: 'http://widgets.evil.example/w',
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.error.envelope.error.code).toBe('app.err.hold.invalid_widget');
      expect(bad.error.httpStatus).toBe(500);
    }
    const loopback = await issueHold(store, {
      identityKey: 'usr_1',
      actionId: 'act_w2',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/x',
      widgetUrl: 'http://127.0.0.1:8080/w',
    });
    expect(loopback.ok).toBe(true);
    const https = await issueHold(store, {
      identityKey: 'usr_1',
      actionId: 'act_w3',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/x',
      widgetUrl: 'https://challenges.example-cdn.net/w',
    });
    expect(https.ok).toBe(true);
  });

  it('rejects nested hold on the same in-flight action', async () => {
    const first = await issueHold(store, {
      identityKey: 'usr_2',
      actionId: 'book',
      kind: 'liveness',
      verifyUrl: 'https://example.com/holds/a',
    });
    expect(first.ok).toBe(true);
    const nested = await issueHold(store, {
      identityKey: 'usr_2',
      actionId: 'book',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/b',
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) {
      expect(nested.error.envelope.error.code).toBe('app.err.hold.nested');
      expect(nested.error.httpStatus).toBe(409);
    }
  });

  it('rejects complete_hold from X-APP-Client agent/*', async () => {
    const issued = await issueHold(store, {
      identityKey: 'usr_3',
      actionId: 'pay',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/c',
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const agent = await completeHold(store, {
      holdId: issued.record.id,
      clientHeader: 'agent/planner',
    });
    expect(agent.ok).toBe(false);
    if (!agent.ok) {
      expect(agent.error.envelope.error.code).toBe('app.err.hold.invalid');
      expect(agent.error.httpStatus).toBe(403);
    }
  });

  it('issues a single-use hold token with 60s cap after clear', async () => {
    const issued = await issueHold(store, {
      identityKey: 'usr_4',
      actionId: 'upload',
      kind: 'captcha',
      verifyUrl: 'https://example.com/holds/d',
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(issued.record.agentSolvable).toBe(false);

    const cleared = await completeHold(store, {
      holdId: issued.record.id,
      clientHeader: 'renderer/ext',
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const ttl = (cleared.record.tokenExpiresAt ?? 0) - Date.now();
    expect(ttl).toBeLessThanOrEqual(60_000);
    expect(ttl).toBeGreaterThan(0);

    const first = await spendHoldToken(store, { token: cleared.token });
    expect(first.ok).toBe(true);
    const replay = await spendHoldToken(store, { token: cleared.token });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.envelope.error.code).toBe('app.err.hold.invalid');
  });

  it('forces agent_solvable false for captcha and liveness', async () => {
    const r = await issueHold(store, {
      identityKey: 'usr_5',
      actionId: 'x',
      kind: 'liveness',
      verifyUrl: 'https://example.com/holds/e',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.agentSolvable).toBe(false);
  });
});
