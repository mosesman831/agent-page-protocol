/**
 * Auth refresh helper for TV-49 (§9.4).
 */
import { ACCEPT_PAGE } from '../helpers.js';

export async function fetchWithAuthRefresh(
  ctx: { baseUrl: string; fetch?: typeof globalThis.fetch },
  url: string,
  init: RequestInit,
  auth: {
    accessToken: string;
    refreshToken: string;
    setAccessToken: (t: string) => void;
  },
): Promise<
  | { outcome: 'ok'; response: Response; refreshed: boolean }
  | { outcome: 'surface'; response: Response; refreshed: boolean }
> {
  const fetchFn = ctx.fetch ?? globalThis.fetch;
  const withAuth = (token: string): RequestInit => ({
    ...init,
    headers: {
      ...(init.headers as Record<string, string>),
      Authorization: `Bearer ${token}`,
      Accept: ACCEPT_PAGE,
    },
  });

  let res = await fetchFn(url, withAuth(auth.accessToken));
  if (res.status !== 401) {
    return { outcome: 'ok', response: res, refreshed: false };
  }

  const refreshRes = await fetchFn(`${ctx.baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: auth.refreshToken }),
  });
  if (!refreshRes.ok) {
    return { outcome: 'surface', response: res, refreshed: false };
  }
  const tokens = (await refreshRes.json()) as { access_token: string };
  auth.setAccessToken(tokens.access_token);

  res = await fetchFn(url, withAuth(tokens.access_token));
  if (res.status === 401) {
    return { outcome: 'surface', response: res, refreshed: true };
  }
  return { outcome: 'ok', response: res, refreshed: true };
}
