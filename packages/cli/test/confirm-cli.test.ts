import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MEDIA_ERROR, MEDIA_PAGE, type PageManifest } from '@agent-page/client';
import { createRuntime, exitCodeFor } from '../src/core/index.js';
import { main } from '../src/main.js';

function page(
  overrides: Partial<PageManifest['page']> & { id: string; url: string; version: string },
  state: PageManifest['state'] = {},
  actions: PageManifest['actions'] = {},
): PageManifest {
  return {
    app: '1.0',
    page: {
      title: overrides.id,
      etag: `"${overrides.version}"`,
      ...overrides,
    },
    state,
    actions,
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) {
    headers.set('content-type', init.contentType ?? MEDIA_PAGE);
  }
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
    headers,
  });
}

describe('confirm-cli', () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ap-cli-confirm-'));
    process.env.AGENT_PAGE_ALLOW_INSECURE_HOME = '1';
    process.env.AGENT_PAGE_HOME = home;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env.AGENT_PAGE_HOME;
  });

  it('428 -> hold exit 10 + hold file; approve posts identical body', async () => {
    const booking = page(
      {
        id: 'booking-payment',
        url: 'http://localhost:3456/booking/fl-002',
        version: 'v5',
      },
      {
        selected_price: {
          type: 'number',
          value: 64000,
          unit: 'GBP',
          scale: 2,
        },
      },
      {
        confirm_booking: {
          description: 'Pay',
          kind: 'mutate',
          side_effect: 'financial',
          requires_confirmation: true,
          idempotent: false,
          requires_etag_match: true,
          auth: 'session',
          confirm: { amount_path: 'selected_price', title: 'Confirm payment' },
          input: {
            email: { type: 'string', required: true },
            passport: { type: 'string', required: true },
          },
          output: { state_diff: true },
        },
      },
    );

    const challenge = 'conf_TESTCHALLENGE00000000000000000';
    const bodies: string[] = [];
    let posted = 0;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('well-known')) {
        return new Response(null, { status: 404 });
      }
      if (method === 'GET') {
        return jsonResponse(booking, { headers: { etag: '"v5"' } });
      }
      posted += 1;
      bodies.push(String(init?.body));
      const headers = new Headers(init?.headers);
      if (!headers.get('x-app-confirmation')) {
        return jsonResponse(
          {
            app: '1.0',
            error: {
              code: 'app.err.action.confirmation_required',
              message: 'Confirm',
              retryable: false,
              confirmation_challenge: challenge,
              details: {
                confirmation_challenge: { type: 'string', value: challenge },
              },
            },
          },
          { status: 428, contentType: MEDIA_ERROR },
        );
      }
      expect(headers.get('x-app-confirmation')).toBe(challenge);
      return jsonResponse(
        {
          ...booking,
          page: { ...booking.page, version: 'v6' },
          state: {
            ...booking.state,
            operation_status: {
              type: 'object',
              value: {
                state: { type: 'string', value: 'queued' },
                status_url: {
                  type: 'string',
                  value: 'http://localhost:3456/operations/op1',
                },
              },
            },
          },
        },
        { status: 202 },
      );
    });

    const rt = createRuntime({
      home,
      fetch: fetchImpl as typeof fetch,
      asyncWait: false,
    });

    await rt.open('http://localhost:3456/booking/fl-002');
    const holdEnv = await rt.act('confirm_booking', {
      params: { email: 'ada@example.com', passport: 'AB1234567' },
    });
    expect(holdEnv.status).toBe('hold');
    expect(holdEnv.hold?.kind).toBe('confirmation');
    expect(holdEnv.hold?.challenge).toBe(challenge);
    expect(exitCodeFor(holdEnv)).toBe(10);
    expect(JSON.stringify(holdEnv)).not.toContain('raw_body_b64');

    const holdFiles = readdirSync(join(home, 'holds')).filter((f) => f.endsWith('.json'));
    expect(holdFiles.length).toBe(1);
    const holdRaw = JSON.parse(readFileSync(join(home, 'holds', holdFiles[0]!), 'utf8')) as {
      raw_body_b64: string;
      body_sha256: string;
      challenge: string;
    };
    const decoded = Buffer.from(holdRaw.raw_body_b64, 'base64').toString('utf8');
    expect(decoded).toContain('ada@example.com');
    expect(bodies[0]).toBe(decoded);

    const approved = await rt.confirm({ approve: true, noWait: true });
    expect(approved.ok).toBe(true);
    expect(['async_pending', 'async_succeeded']).toContain(approved.status);
    expect(bodies[1]).toBe(bodies[0]);
    expect(existsSync(join(home, 'holds', holdFiles[0]!))).toBe(false);
    expect(posted).toBe(2);
  });

  it('rejects --confirmation uuid-mode: locally (exit 21)', async () => {
    const booking = page(
      {
        id: 'booking-payment',
        url: 'http://localhost:3456/booking/fl-002',
        version: 'v5',
      },
      {},
      {
        confirm_booking: {
          description: 'Pay',
          kind: 'mutate',
          side_effect: 'financial',
          requires_confirmation: true,
          input: { email: { type: 'string' } },
        },
      },
    );

    let posts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('well-known')) return new Response(null, { status: 404 });
      if (method === 'GET') return jsonResponse(booking);
      posts += 1;
      throw new Error('should not POST');
    });

    const rt = createRuntime({ home, fetch: fetchImpl as typeof fetch });
    await rt.open('http://localhost:3456/booking/fl-002');
    const env = await rt.act('confirm_booking', {
      params: { email: 'a@b.c' },
      confirmation: 'uuid-mode:00000000-0000-4000-8000-000000000000',
    });
    expect(env.error?.code).toBe('app.err.action.confirmation_invalid');
    expect(exitCodeFor(env)).toBe(21);
    expect(posts).toBe(0);
  });

  it('main maps missing session act to exit 24', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'ap-empty-'));
    process.env.AGENT_PAGE_HOME = empty;
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    (process.stdout as { write: typeof process.stdout.write }).write = ((
      chunk: string | Uint8Array,
    ) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['--home', empty, 'act', 'filter', '--param', 'max_price=1']);
      expect(code).toBe(24);
      const body = JSON.parse(chunks.join('')) as { error?: { code?: string } };
      expect(body.error?.code).toBe('app.err.tool.session_missing');
    } finally {
      process.stdout.write = orig;
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
