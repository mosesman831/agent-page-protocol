/**
 * 1.0 selection against a 1.1 server (SPEC §2.5 / §35).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  ACCEPT_PAGE,
  ACCEPT_PAGE_11,
  ALL_VECTORS,
  errorCode,
  MEDIA_PAGE,
} from '../src/index.js';

describe('1.0 projection / version selection', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await startConformanceServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.state.reset(server.port);
  });

  it('1.0 selection against 1.1 server projects geopoint to object', async () => {
    const res = await fetch(`${server.baseUrl}/v11/geo`, {
      headers: { Accept: ACCEPT_PAGE_11, 'X-APP-Accept-Versions': '1.0' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-app-version')).toBe('1.0');
    const body = (await res.json()) as {
      app: string;
      state: { loc: { type: string; value: { lat: { type: string }; lng: { type: string } } } };
    };
    expect(body.app).toBe('1.0');
    expect(body.state.loc.type).toBe('object');
    expect(body.state.loc.value.lat.type).toBe('number');
    expect(body.state.loc.value.lng.type).toBe('number');
  });

  it('TV-01 still passes under Accept-Versions 1.0', async () => {
    const tv01 = ALL_VECTORS.find((v) => v.meta.id === 'TV-01')!;
    const result = await tv01.run({
      baseUrl: server.baseUrl,
      origin: server.origin,
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set('X-APP-Accept-Versions', '1.0');
        if (!headers.has('Accept')) headers.set('Accept', ACCEPT_PAGE);
        return fetch(input, { ...init, headers });
      },
    });
    expect(result.passed, result.message).toBe(true);
  });

  it('MF-2/3: Accept v=1.1 + Accept-Versions 1.1,1.0 against 1.0-only fixture is not 400', async () => {
    const res = await fetch(`${server.baseUrl}/v10/page`, {
      headers: {
        Accept: `${MEDIA_PAGE};v=1.1`,
        'X-APP-Accept-Versions': '1.1, 1.0',
      },
    });
    expect(res.status).not.toBe(400);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { app: string };
    expect(body.app).toBe('1.0');
  });

  it('MF-2: version.unsupported envelope app is highest client offered (1.1)', async () => {
    const res = await fetch(`${server.baseUrl}/v10/page`, {
      headers: {
        Accept: MEDIA_PAGE,
        'X-APP-Accept-Versions': '1.1',
      },
    });
    expect(res.status === 406 || res.status === 400).toBe(true);
    const body = (await res.json()) as { app: string; error: { code: string } };
    expect(body.app).toBe('1.1');
    expect(errorCode(body)).toMatch(/app\.err\.version\.(unsupported|version_mismatch)/);
  });
});
