import { describe, expect, it, vi } from 'vitest';
import { AgentClient, AppHttpClient, MEDIA_PAGE } from '@agent-page/client';
import {
  floorIntervalMs,
  pollAsyncOperationWithClient,
  watchOnce,
  WATCH_INTERVAL_FLOOR_MS,
} from '../src/index.js';

describe('watch poll §7.5', () => {
  it('interval floor 1000', () => {
    expect(floorIntervalMs(250)).toBe(WATCH_INTERVAL_FLOOR_MS);
    expect(floorIntervalMs(1000)).toBe(1000);
    expect(floorIntervalMs(5000)).toBe(5000);
    expect(floorIntervalMs(undefined)).toBe(5000);
  });

  it('304 -> not_modified; 200 -> changed', async () => {
    const http304 = new AppHttpClient({
      fetch: async () => new Response(null, { status: 304, headers: { etag: '"v4"' } }),
    });
    const once304 = await watchOnce(http304, 'http://localhost:3456/p', {
      etag: '"v4"',
      intervalMs: 250,
    });
    expect(once304.changed).toBe(false);
    expect(once304.status).toBe(304);
    expect(once304.interval_ms).toBe(1000);
    expect(once304.transport).toBe('poll');

    const page = {
      app: '1.0',
      page: { id: 'p', url: 'http://localhost:3456/p', version: 'v5', etag: '"v5"' },
      state: {},
    };
    const http200 = new AppHttpClient({
      fetch: async () =>
        new Response(JSON.stringify(page), {
          status: 200,
          headers: { 'content-type': MEDIA_PAGE, etag: '"v5"' },
        }),
    });
    const once200 = await watchOnce(http200, 'http://localhost:3456/p', { etag: '"v4"' });
    expect(once200.changed).toBe(true);
    expect(once200.status).toBe(200);
    expect(once200.manifest?.page.version).toBe('v5');
  });

  it('uses public ActionDispatcher.pollAsyncOperation', async () => {
    const accepted = {
      app: '1.0' as const,
      page: { id: 'op', url: 'http://localhost:3456/status/1', version: 'v1' },
      state: {
        operation_status: {
          type: 'object' as const,
          value: {
            state: { type: 'string' as const, value: 'running' },
            status_url: { type: 'string' as const, value: 'http://localhost:3456/status/1' },
          },
        },
      },
      meta: { poll_interval_ms: 500 },
    };
    const done = {
      ...accepted,
      state: {
        operation_status: {
          type: 'object' as const,
          value: {
            state: { type: 'string' as const, value: 'succeeded' },
            status_url: { type: 'string' as const, value: 'http://localhost:3456/status/1' },
          },
        },
      },
    };
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify(done), {
        status: 200,
        headers: { 'content-type': MEDIA_PAGE },
      });
    });
    const client = new AgentClient({ fetch: fetchImpl });
    const spy = vi.spyOn(client.actions, 'pollAsyncOperation');
    const result = await pollAsyncOperationWithClient(client, accepted, { asyncTimeoutMs: 5000 });
    expect(spy).toHaveBeenCalled();
    expect(result.state.operation_status).toBeTruthy();
  });
});
