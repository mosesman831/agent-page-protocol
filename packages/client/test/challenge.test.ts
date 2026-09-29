import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import { assertChallengeBudget } from '../src/challenge.js';

describe('assertChallengeBudget — §6 nested-challenge budget', () => {
  it('allows up to 2 factor steps by default', () => {
    expect(() => assertChallengeBudget(1)).not.toThrow();
    expect(() => assertChallengeBudget(2)).not.toThrow();
  });

  it('aborts challenge_nested on the third step without a declaration', () => {
    try {
      assertChallengeBudget(3);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('app.err.auth.challenge_nested');
    }
  });

  it('honors meta.flow.step_count declaring a larger chain (3 steps)', () => {
    expect(() => assertChallengeBudget(3, 3)).not.toThrow();
  });

  it('still aborts beyond the declared chain', () => {
    expect(() => assertChallengeBudget(4, 3)).toThrowError(/challenge/);
  });

  it('clamps declared counts at MAX_FACTOR_STEPS (3)', () => {
    expect(() => assertChallengeBudget(3, 5)).not.toThrow();
    expect(() => assertChallengeBudget(4, 5)).toThrowError(/challenge/);
  });

  it('ignores invalid declarations (keeps the 2-step floor)', () => {
    for (const declared of [0, -1, 1.5, Number.NaN]) {
      expect(() => assertChallengeBudget(2, declared)).not.toThrow();
      expect(() => assertChallengeBudget(3, declared)).toThrowError(/challenge/);
    }
  });

  it('a declared count below the default does not tighten the budget', () => {
    expect(() => assertChallengeBudget(2, 1)).not.toThrow();
  });
});
