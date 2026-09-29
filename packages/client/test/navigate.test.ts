import { describe, it, expect } from 'vitest';
import {
  expandUrlTemplate,
  expandNavigate,
  resolveAppUrl,
  normalizeAppUrl,
  assertSameOrigin,
  NavigationStack,
  canNavigateWithoutPost,
  isLoopbackHost,
  requireNavigateLocation,
} from '../src/navigate.js';
import { AppError } from '../src/errors.js';
import type { ActionDef } from '../src/types.js';

describe('navigate (§8)', () => {
  it('resolves relative URLs and strips fragments', () => {
    expect(resolveAppUrl('/booking/fl-1#top', 'https://example.com/flights')).toBe(
      'https://example.com/booking/fl-1',
    );
  });

  it('normalizes scheme/host/ports/dot-segments/percent (§8.1)', () => {
    expect(normalizeAppUrl('HTTPS://Example.COM:443/a/./b/../c')).toBe('https://example.com/a/c');
    expect(normalizeAppUrl('https://example.com/a?')).toBe('https://example.com/a');
    // Query order significant
    expect(normalizeAppUrl('https://example.com/?b=2&a=1')).toBe('https://example.com/?b=2&a=1');
    expect(normalizeAppUrl('https://example.com/%7euser')).toBe('https://example.com/~user');
  });

  it('rejects userinfo and non-loopback http; allows 127/8 and ::1', () => {
    expect(() => resolveAppUrl('https://user:pass@example.com/', 'https://example.com/')).toThrow(
      AppError,
    );
    expect(() => resolveAppUrl('http://example.com/', 'https://example.com/')).toThrow(AppError);
    expect(resolveAppUrl('http://localhost:3000/x', 'http://localhost:3000/')).toContain(
      'localhost',
    );
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(resolveAppUrl('http://127.0.0.42/x', 'http://127.0.0.42/')).toContain('127.0.0.42');
  });

  it('expands path and query templates; encodes unicode (TV-40)', () => {
    const url = expandUrlTemplate(
      '/booking/{flight_id}?seat={seat}',
      { flight_id: 'fl-002', seat: '12A' },
      'https://example.com/',
    );
    expect(url).toBe('https://example.com/booking/fl-002?seat=12A');

    const uni = expandUrlTemplate('/city/{name}', { name: '東京' }, 'https://example.com/');
    expect(uni).toContain('%');
    expect(uni).not.toMatch(/東京/);
  });

  it('throws template_param when missing', () => {
    expect(() =>
      expandUrlTemplate('/booking/{flight_id}', {}, 'https://example.com/'),
    ).toThrowError(/template/);
  });

  it('enforces same-origin on expandNavigate (TV-43)', () => {
    const def: ActionDef = {
      description: 'go',
      kind: 'navigate',
      side_effect: 'safe',
      output: { navigates_to: 'https://evil.example/x' },
    };
    expect(() => expandNavigate(def, {}, 'https://example.com/')).toThrow(AppError);
    try {
      assertSameOrigin('https://evil.example/', 'https://example.com/');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('app.err.security.cross_origin');
    }
  });

  it('detects A→B→A→B→A cycle in last 8 (TV-41)', () => {
    const stack = new NavigationStack();
    stack.push('https://example.com/a');
    stack.push('https://example.com/b');
    stack.push('https://example.com/a');
    stack.push('https://example.com/b');
    expect(() => stack.push('https://example.com/a')).toThrowError(/cycle/);
  });

  it('ignores single-step self-loop refreshes for cycle', () => {
    const stack = new NavigationStack();
    stack.push('https://example.com/a');
    stack.push('https://example.com/a');
    stack.push('https://example.com/a');
    expect(stack.entries().length).toBe(3);
  });

  it('detects redirect loops at 6th hop (TV-42)', () => {
    const stack = new NavigationStack();
    stack.beginRedirectChain();
    for (let i = 0; i < 5; i++) {
      stack.trackRedirect(`https://example.com/r${i}`);
    }
    expect(() => stack.trackRedirect('https://example.com/r5')).toThrowError(/redirect/);
  });

  it('requireNavigateLocation fail-closed on mismatch (TV-39)', () => {
    expect(() =>
      requireNavigateLocation(
        'https://example.com/a',
        'https://example.com/b',
        'https://example.com/',
      ),
    ).toThrow(AppError);
    expect(
      requireNavigateLocation(
        'https://example.com/a',
        'https://example.com/a',
        'https://example.com/',
      ),
    ).toBe('https://example.com/a');
  });

  it('allows safe navigate-without-POST only when conditions met', () => {
    const ok: ActionDef = {
      description: 'next',
      kind: 'navigate',
      side_effect: 'safe',
      output: { navigates_to: '/x/{id}' },
    };
    expect(canNavigateWithoutPost(ok, { id: '1' })).toBe(true);
    expect(canNavigateWithoutPost({ ...ok, requires_confirmation: true }, { id: '1' })).toBe(false);
    expect(canNavigateWithoutPost({ ...ok, side_effect: 'destructive' }, { id: '1' })).toBe(false);
  });
});
