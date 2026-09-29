import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '@agent-page/client';
import {
  COMPLETE_HOLD_ACTION,
  HEADER_APP_HOLD_TOKEN,
  HoldStore,
  SessionStore,
  assertNotWidgetFetch,
  holdTokenHeaders,
  humanHoldCount,
  incrementHumanHoldBudget,
  persistHumanHold,
  refuseCompleteHold,
  refuseHumanVerificationChallengeSubmit,
  resetHumanHoldBudget,
} from '../src/index.js';

describe('human-hold §6.5 / TV-91', () => {
  function setup() {
    const store = new SessionStore(mkdtempSync(join(tmpdir(), 'ap-hh-')));
    store.ensureHome();
    const session = store.createSession({ origin: 'https://example.com' });
    return { store, holds: new HoldStore(store), session };
  }

  it('complete_hold never POSTed with X-APP-Client: agent/', () => {
    expect(COMPLETE_HOLD_ACTION).toBe('complete_hold');
    expect(() => refuseCompleteHold('complete_hold')).toThrow(AppError);
    try {
      refuseCompleteHold('complete_hold');
    } catch (e) {
      expect((e as AppError).code).toBe('app.err.hold.invalid');
    }
    expect(() => refuseHumanVerificationChallengeSubmit('human_verification')).toThrow(
      /hold.invalid|rejected/,
    );
  });

  it('budget 3 then budget_exceeded', () => {
    const { store } = setup();
    const origin = 'https://example.com';
    expect(incrementHumanHoldBudget(store, origin)).toBe(1);
    expect(incrementHumanHoldBudget(store, origin)).toBe(2);
    expect(incrementHumanHoldBudget(store, origin)).toBe(3);
    expect(humanHoldCount(store, origin)).toBe(3);
    try {
      incrementHumanHoldBudget(store, origin);
      expect.fail('expected budget_exceeded');
    } catch (e) {
      expect((e as AppError).code).toBe('app.err.hold.budget_exceeded');
    }
    resetHumanHoldBudget(store, origin);
    expect(humanHoldCount(store, origin)).toBe(0);
  });

  it('widget_url never fetched; resume uses X-APP-Hold-Token', () => {
    const { holds, session } = setup();
    const widget = 'https://example.com/captcha-widget';
    const file = persistHumanHold(holds, {
      sessionId: session.id,
      kind: 'human_verification',
      action: 'pay',
      page_url: 'https://example.com/pay',
      page_version: 'v1',
      post_url: 'https://example.com/pay',
      rawBody: JSON.stringify({ app: '1.0', action: 'pay', params: {} }),
      origin: 'https://example.com',
      widget_url: widget,
      verify_url: 'https://example.com/verify',
      hold_token: 'hold_01J8',
    });
    expect(file.widget_url).toBe(widget);
    expect(() => assertNotWidgetFetch(widget, file.widget_url)).toThrow(AppError);
    const headers = holdTokenHeaders(file);
    expect(headers[HEADER_APP_HOLD_TOKEN]).toBe('hold_01J8');

    const fetchImpl = vi.fn();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(headers)).not.toContain(widget);
  });
});
