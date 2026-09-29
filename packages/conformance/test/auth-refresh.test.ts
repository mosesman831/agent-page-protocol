import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startConformanceServer,
  type ConformanceServer,
  fetchWithAuthRefresh,
  ACCEPT_PAGE,
} from '../src/index.js';

describe('Auth refresh (§9.4 / §19.3 #11)', () => {
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

  it('401 → refresh once → retry succeeds', async () => {
    let token = 'access_expired';
    const result = await fetchWithAuthRefresh(
      server,
      `${server.baseUrl}/vectors/auth`,
      { method: 'GET', headers: { Accept: ACCEPT_PAGE } },
      {
        accessToken: token,
        refreshToken: 'refresh_ok',
        setAccessToken: (t) => {
          token = t;
        },
      },
    );
    expect(result.outcome).toBe('ok');
    expect(result.refreshed).toBe(true);
    expect(result.response.status).toBe(200);
    expect(token).toBe('access_after_refresh');
  });

  it('401 → failed refresh → surfaces 401 to user (no infinite retry)', async () => {
    const result = await fetchWithAuthRefresh(
      server,
      `${server.baseUrl}/vectors/auth`,
      { method: 'GET' },
      {
        accessToken: 'access_expired',
        refreshToken: 'refresh_fail',
        setAccessToken: () => {
          /* no-op */
        },
      },
    );
    expect(result.outcome).toBe('surface');
    expect(result.response.status).toBe(401);
  });

  it('valid token does not refresh', async () => {
    let refreshed = false;
    const result = await fetchWithAuthRefresh(
      server,
      `${server.baseUrl}/vectors/auth`,
      { method: 'GET' },
      {
        accessToken: 'access_valid',
        refreshToken: 'refresh_ok',
        setAccessToken: () => {
          refreshed = true;
        },
      },
    );
    expect(result.outcome).toBe('ok');
    expect(result.refreshed).toBe(false);
    expect(refreshed).toBe(false);
    expect(result.response.status).toBe(200);
  });
});
