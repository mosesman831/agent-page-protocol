/**
 * §13 flights smoke. Skip when SMOKE=0 or server unreachable.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRuntime, exitCodeFor } from '../src/core/index.js';

const SMOKE = process.env.SMOKE === '1';
const ORIGIN = process.env.PAGE_ORIGIN ?? 'http://localhost:3456';
const ROOT = join(import.meta.dirname, '..', '..', '..');

async function waitForServer(url: string, ms = 15000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/vnd.agent-page+json' },
      });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe.skipIf(!SMOKE)('flights.integration (§13)', () => {
  let home: string;
  let server: ChildProcess | null = null;
  let startedHere = false;
  let serverReady = false;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'ap-flights-'));
    process.env.AGENT_PAGE_ALLOW_INSECURE_HOME = '1';
    const ready = await waitForServer(`${ORIGIN}/.well-known/agent-page`, 2000);
    if (!ready) {
      server = spawn('npm', ['run', 'start', '-w', '@agent-page/example-flights'], {
        cwd: ROOT,
        stdio: 'ignore',
        env: { ...process.env, PORT: '3456' },
      });
      startedHere = true;
      serverReady = await waitForServer(`${ORIGIN}/.well-known/agent-page`, 20000);
      if (!serverReady && server) {
        server.kill('SIGTERM');
        server = null;
        startedHere = false;
      }
    } else {
      serverReady = true;
    }
  }, 30000);

  afterAll(async () => {
    if (startedHere && server) {
      server.kill('SIGTERM');
    }
    try {
      rmSync(home, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('discover → open → search → filter → hold → approve → reset', async () => {
    if (!serverReady) {
      // Soft-skip when example server cannot bind (CI without SMOKE=0)
      return;
    }
    const rt = createRuntime({ home, asyncWait: false });

    const disc = await rt.discover(ORIGIN);
    expect(disc.ok).toBe(true);
    expect(disc.discovery?.site_name).toBe('Acme Flights');
    expect(disc.session).toBeNull();

    const opened = await rt.open(`${ORIGIN}/flights`);
    expect(opened.page?.id).toBe('flight-search');
    expect(opened.digest?.actions?.[0]?.id).toBe('search');

    const searched = await rt.act('search', {
      params: {
        origin: 'LHR',
        destination: 'DXB',
        date: '2026-08-15',
        passengers: 1,
      },
    });
    expect(searched.status).toBe('navigated');
    expect(searched.page?.id).toBe('flight-results');

    const filtered = await rt.act('filter', { params: { max_price: 70000 } });
    expect(filtered.act?.mode).toBe('diff');
    expect((filtered.act?.state_delta?.total_results as { value?: number })?.value).toBe(1);

    const watched = await rt.watch({ once: true });
    expect(watched.watch?.transport).toBe('poll');

    const booked = await rt.act('select_flight', { params: { flight_id: 'fl-002' } });
    expect(booked.page?.id).toBe('booking-payment');

    const hold = await rt.act('confirm_booking', {
      params: {
        email: 'ada@example.com',
        passport: 'AB1234567',
        seat_pref: 'aisle',
      },
    });
    expect(hold.status).toBe('hold');
    expect(exitCodeFor(hold)).toBe(10);
    expect(hold.hold?.challenge).toMatch(/^conf_/);
    const holds = readdirSync(join(home, 'holds')).filter((f) => f.endsWith('.json'));
    expect(holds.length).toBe(1);
    const holdFile = JSON.parse(readFileSync(join(home, 'holds', holds[0]!), 'utf8')) as {
      raw_body_b64: string;
    };
    const body = Buffer.from(holdFile.raw_body_b64, 'base64').toString('utf8');
    expect(body).toContain('ada@example.com');

    const approved = await rt.confirm({ approve: true, noWait: true });
    expect(approved.ok).toBe(true);
    expect(['async_pending', 'async_succeeded']).toContain(approved.status);

    const replay = await rt.confirm({ approve: true });
    expect(replay.error?.code).toBe('app.err.tool.hold_mismatch');

    const listed = await rt.sessions('list');
    expect((listed.sessions?.length ?? 0) >= 1).toBe(true);

    await rt.logout(ORIGIN);
    await rt.reset({ all: true });
    const after = await rt.sessions('list');
    expect(after.sessions?.length ?? 0).toBe(0);
    expect(existsSync(join(home, 'sessions'))).toBe(true);
  }, 60000);
});
