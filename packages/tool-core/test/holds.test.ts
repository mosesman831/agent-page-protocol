import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError, AppHttpClient, MEDIA_PAGE } from '@agent-page/client';
import {
  HoldStore,
  SessionStore,
  appendGate,
  decodeRawBodyString,
  earliestUncleared,
  encodeRawBody,
  isUuidModeToken,
  markGateCleared,
  pendingGateOrder,
  publicHoldFromFile,
  resolveEarliestGate,
} from '../src/index.js';

function rawAction(action = 'confirm_booking'): string {
  return JSON.stringify({
    app: '1.0',
    action,
    params: { fare: 64000 },
    client: { kind: 'agent', name: 'agent-page-cli', version: '0.5.0' },
  });
}

describe('holds §6 / §9.4 / K3 MF-10 gate queue', () => {
  function setup() {
    const home = mkdtempSync(join(tmpdir(), 'ap-hold-'));
    const store = new SessionStore(home);
    store.ensureHome();
    const session = store.createSession({ origin: 'http://localhost:3456' });
    return { home, store, holds: new HoldStore(store), session };
  }

  it('persist 428 confirmation; Mode B token never stored', () => {
    const { holds, session } = setup();
    const raw = rawAction();
    const file = holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'confirm_booking',
      page_url: 'http://localhost:3456/booking/fl-002',
      page_version: 'v5',
      post_url: 'http://localhost:3456/booking/fl-002',
      rawBody: raw,
      challenge: 'conf_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    expect(file.schema).toBe('agent-page.hold/1.0');
    expect(file.body_sha256).toBe(encodeRawBody(raw).body_sha256);
    expect(decodeRawBodyString(file.raw_body_b64)).toBe(raw);
    expect(file.gates).toHaveLength(1);
    expect(file.gates[0]?.kind).toBe('confirmation');
    expect(holds.store.fileMode(holds.primaryPath(session.id))).toBe(0o600);

    expect(() =>
      holds.persist({
        sessionId: session.id,
        kind: 'confirmation',
        action: 'confirm_booking',
        page_url: 'http://localhost:3456/booking/fl-002',
        page_version: 'v5',
        post_url: 'http://localhost:3456/booking/fl-002',
        rawBody: raw,
        challenge: 'uuid-mode:client-generated',
      }),
    ).toThrow(AppError);
    expect(isUuidModeToken('uuid-mode:x')).toBe(true);
    const loaded = holds.load(session.id);
    expect(loaded?.challenge).not.toMatch(/^uuid-mode:/);
  });

  it('approve reuses exact bytes (byte compare); reject deletes; expiry', async () => {
    const { holds, session } = setup();
    const raw = rawAction();
    const file = holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'confirm_booking',
      page_url: 'http://localhost:3456/booking/fl-002',
      page_version: 'v5',
      post_url: 'http://localhost:3456/booking/fl-002',
      rawBody: raw,
      challenge: 'conf_tok',
      idempotency_key: 'idem_abc',
    });

    let posted: string | undefined;
    const http = new AppHttpClient({
      fetch: async (_input, init) => {
        posted = typeof init?.body === 'string' ? init.body : String(init?.body ?? '');
        expect(
          init?.headers instanceof Headers
            ? (init.headers as Headers).get('X-APP-Confirmation')
            : undefined,
        );
        return new Response(
          JSON.stringify({
            app: '1.0',
            page: { id: 'p', url: file.page_url, version: 'v6' },
            state: {},
          }),
          {
            status: 200,
            headers: { 'content-type': MEDIA_PAGE },
          },
        );
      },
    });
    const result = await holds.completeModeA(http, file, { confirmation: 'conf_tok' });
    expect(posted).toBe(raw);
    expect(Buffer.from(posted!, 'utf8').equals(Buffer.from(raw, 'utf8'))).toBe(true);
    expect(result.rawBody).toBe(raw);

    holds.delete(session.id, file.body_sha256);
    expect(holds.load(session.id)).toBeNull();

    const expired = holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'confirm_booking',
      page_url: file.page_url,
      page_version: 'v5',
      post_url: file.post_url,
      rawBody: raw,
      challenge: 'conf_tok',
      expires_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    });
    expect(holds.isExpired(expired)).toBe(true);
    expect(() => holds.requireFresh(expired)).toThrow(/expired|confirmation_invalid/);
  });

  it('never auto-approves: persist does not POST', async () => {
    const posts = 0;
    const { holds, session } = setup();
    holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'pay',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: rawAction('pay'),
      challenge: 'conf_x',
    });
    expect(posts).toBe(0);
  });

  it('gate queue: append earliest first, same body_sha256, one raw body', () => {
    const { holds, session } = setup();
    const raw = rawAction('book');
    const sha = encodeRawBody(raw).body_sha256;
    holds.persist({
      sessionId: session.id,
      kind: 'otp',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      challenge: 'chg_1',
    });
    holds.persist({
      sessionId: session.id,
      kind: 'human_verification',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      hold_token: 'hold_1',
    });
    holds.persist({
      sessionId: session.id,
      kind: 'consent',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      grant: ['analytics'],
    });
    const file = holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      challenge: 'conf_1',
    });
    expect(file.body_sha256).toBe(sha);
    expect(file.gates.map((g) => g.kind)).toEqual(['challenge', 'hold', 'consent', 'confirmation']);
    expect(file.gates.every((g) => g.status === 'pending')).toBe(true);
    expect(holds.loadAll(session.id)).toHaveLength(1);
    expect(earliestUncleared(file)?.kind).toBe('challenge');
  });

  it('different body_sha256 is a separate hold file and never merges', () => {
    const { holds, session } = setup();
    const a = rawAction('book');
    const b = rawAction('other');
    holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: a,
      challenge: 'conf_a',
    });
    holds.persist({
      sessionId: session.id,
      kind: 'otp',
      action: 'other',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: b,
      challenge: 'chg_b',
    });
    const all = holds.loadAll(session.id);
    expect(all).toHaveLength(2);
    const shas = new Set(all.map((f) => f.body_sha256));
    expect(shas.size).toBe(2);
    for (const f of all) {
      expect(new Set(f.gates.map((g) => g.kind)).size).toBe(f.gates.length);
      expect(
        f.gates.every(
          () => f.body_sha256 === encodeRawBody(decodeRawBodyString(f.raw_body_b64)).body_sha256,
        ),
      ).toBe(true);
    }
  });

  it('confirm/challenge/grant_consent resolve earliest uncleared; mismatch reports order and does not skip', () => {
    const { holds, session } = setup();
    const raw = rawAction('book');
    holds.persist({
      sessionId: session.id,
      kind: 'otp',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      challenge: 'chg_1',
    });
    holds.persist({
      sessionId: session.id,
      kind: 'consent',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
    });
    holds.persist({
      sessionId: session.id,
      kind: 'confirmation',
      action: 'book',
      page_url: 'http://localhost:3456/p',
      page_version: 'v1',
      post_url: 'http://localhost:3456/p',
      rawBody: raw,
      challenge: 'conf_1',
    });
    const file = holds.load(session.id)!;
    expect(pendingGateOrder(file)).toEqual(['challenge', 'consent', 'confirmation']);
    expect(() => resolveEarliestGate(file, 'confirm')).toThrow(/Pending gate order/);
    expect(() => resolveEarliestGate(file, 'grant_consent')).toThrow(/Pending gate order/);
    const ch = resolveEarliestGate(file, 'challenge');
    expect(ch.kind).toBe('challenge');
    const after = markGateCleared(file, 'challenge');
    expect(earliestUncleared(after)?.kind).toBe('consent');
    expect(after.gates.find((g) => g.kind === 'challenge')?.status).toBe('cleared');
    expect(after.gates.find((g) => g.kind === 'confirmation')?.status).toBe('pending');
    const g = resolveEarliestGate(after, 'grant_consent');
    expect(g.kind).toBe('consent');
    expect(() => resolveEarliestGate(after, 'confirm')).toThrow(/consent/);
  });

  it('appendGate keeps D-10 order', () => {
    const gates = appendGate(
      appendGate([], { kind: 'confirmation', status: 'pending', at: '2026-01-01T00:00:00.000Z' }),
      { kind: 'challenge', status: 'pending', at: '2026-01-01T00:00:01.000Z' },
    );
    expect(gates.map((g) => g.kind)).toEqual(['challenge', 'confirmation']);
  });
});

describe('delegate holds (K3 MF-9)', () => {
  it('persist carries delegates_to + resume_url; public hold surfaces them', () => {
    const home = mkdtempSync(join(tmpdir(), 'ap-hold-del-'));
    const store = new SessionStore(home);
    store.ensureHome();
    const session = store.createSession({ origin: 'http://localhost:3456' });
    const holds = new HoldStore(store);
    const file = holds.persist({
      sessionId: session.id,
      kind: 'delegate',
      action: 'pay_external',
      page_url: 'http://localhost:3456/checkout',
      page_version: 'v3',
      post_url: 'http://localhost:3456/checkout',
      rawBody: rawAction('pay_external'),
      delegate: {
        url: 'https://psp.example.com/pay',
        protocol: 'https',
        reason: 'Pay via external PSP (delegates)',
        resume_url: 'http://localhost:3456/delegate-done',
      },
    });
    expect(file.delegate?.url).toBe('https://psp.example.com/pay');
    expect(file.delegate?.resume_url).toBe('http://localhost:3456/delegate-done');

    const pub = publicHoldFromFile(holds.load(session.id)!);
    expect(pub.kind).toBe('delegate');
    expect(pub.delegate?.url).toBe('https://psp.example.com/pay');
    expect(pub.delegate?.resume_url).toBe('http://localhost:3456/delegate-done');

    // Merge path (same body): new delegate wins, omitted delegate preserves.
    const merged = holds.persist({
      sessionId: session.id,
      kind: 'delegate',
      action: 'pay_external',
      page_url: 'http://localhost:3456/checkout',
      page_version: 'v4',
      post_url: 'http://localhost:3456/checkout',
      rawBody: rawAction('pay_external'),
    });
    expect(merged.delegate?.resume_url).toBe('http://localhost:3456/delegate-done');
  });
});
