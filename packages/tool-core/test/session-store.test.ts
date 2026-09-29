import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@agent-page/client';
import { SessionStore, generateSessionId } from '../src/index.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'ap-home-'));
}

describe('session-store §9', () => {
  const homes: string[] = [];
  afterEach(() => {
    homes.length = 0;
  });

  function store(): SessionStore {
    const home = tmpHome();
    homes.push(home);
    return new SessionStore(home);
  }

  it('create / lock / switch / close / gc', async () => {
    const s = store();
    const a = s.createSession({ origin: 'http://localhost:3456', title: 'A' });
    expect(a.id.startsWith('ses_')).toBe(true);
    expect(generateSessionId().startsWith('ses_')).toBe(true);
    expect(s.fileMode(s.sessionPath(a.id))).toBe(0o600);
    expect(s.fileMode(s.indexPath)).toBe(0o600);
    expect(s.fileMode(s.home)).toBe(0o700);

    const b = s.createSession({ origin: 'http://localhost:3456', title: 'B' });
    expect(s.readIndex().current).toBe(b.id);
    s.switchCurrent(a.id);
    expect(s.readIndex().current).toBe(a.id);

    const order: number[] = [];
    await s.withLock(a.id, async () => {
      order.push(1);
      await s.withLock(b.id, async () => {
        order.push(2);
      });
    });
    expect(order).toEqual([1, 2]);

    s.deleteSession(a.id);
    expect(() => s.readSession(a.id)).toThrow(AppError);
    expect(s.readIndex().sessions).not.toContain(a.id);

    const old = s.createSession({ origin: 'http://localhost:9' });
    const stale = {
      ...s.readSession(old.id),
      last_used_at: new Date(Date.now() - 48 * 3600_000).toISOString(),
    };
    writeFileSync(s.sessionPath(old.id), JSON.stringify(stale), { mode: 0o600 });
    chmodSync(s.sessionPath(old.id), 0o600);
    s.sessionTtlMs = 24 * 3600_000;
    const deleted = s.gc();
    expect(deleted).toContain(old.id);
  });

  it('corrupt file -> session_corrupt', () => {
    const s = store();
    const a = s.createSession({ origin: 'http://localhost:3456' });
    writeFileSync(s.sessionPath(a.id), '{not json', { mode: 0o600 });
    chmodSync(s.sessionPath(a.id), 0o600);
    try {
      s.readSession(a.id);
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('app.err.tool.session_corrupt');
    }
  });

  it('forbidden secret keys rejected', () => {
    const s = store();
    const a = s.createSession({ origin: 'http://localhost:3456' });
    const raw = JSON.parse(readFileSync(s.sessionPath(a.id), 'utf8')) as Record<string, unknown>;
    raw.bearer = 'secret-token-value';
    writeFileSync(s.sessionPath(a.id), JSON.stringify(raw), { mode: 0o600 });
    chmodSync(s.sessionPath(a.id), 0o600);
    try {
      s.readSession(a.id);
      expect.fail('expected throw');
    } catch (e) {
      expect((e as AppError).code).toBe('app.err.tool.session_corrupt');
    }
  });

  it('session files are mode 0600', () => {
    const s = store();
    const a = s.createSession({ origin: 'https://example.com' });
    expect(s.fileMode(s.sessionPath(a.id)) & 0o077).toBe(0);
    expect(s.fileMode(s.sessionPath(a.id))).toBe(0o600);
  });
});
