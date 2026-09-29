/**
 * SPEC-AUTH §7 client duty cycle — client_credentials + refresh_token grants
 * discovered via the well-known manifest. Plug into AppHttp:
 * `new AppHttp({ getAuthHeaders: auth.getAuthHeaders, onAuthRefresh: auth.onAuthRefresh })`.
 * The 401 → refresh → retry-once loop lives in AppHttp; this module only
 * acquires/rotates tokens. 403 insufficient_scope is never retried by design.
 */

export type FetchLike = typeof fetch;

export interface ClientCredentialsAuthOptions {
  fetch?: FetchLike;
  /** Page origin (scheme://host[:port]); well-known is `${origin}/.well-known/agent-page`. */
  origin: string;
  clientId: string;
  clientSecret: string;
  /** Optional scope narrowing (must be within the client's allow-list). */
  scope?: string;
}

export interface ClientCredentialsAuth {
  getAuthHeaders: () => Promise<Record<string, string>>;
  /** Called by AppHttp on 401. Returns true iff a new token was acquired. */
  onAuthRefresh: () => Promise<boolean>;
  accessToken: () => string | null;
}

interface TokenState {
  accessToken: string;
  refreshToken?: string;
}

export function createClientCredentialsAuth(
  options: ClientCredentialsAuthOptions,
): ClientCredentialsAuth {
  const f = options.fetch ?? fetch;
  let endpoints: { tokenEndpoint: string } | null | undefined;
  let token: TokenState | null = null;
  let inflight: Promise<boolean> | null = null;

  async function ensureEndpoints(): Promise<{ tokenEndpoint: string } | null> {
    if (endpoints !== undefined) return endpoints;
    try {
      const res = await f(`${options.origin}/.well-known/agent-page`, {
        headers: { Accept: 'application/vnd.agent-page+json' },
      });
      if (!res.ok) {
        endpoints = null;
        return null;
      }
      const doc = (await res.json()) as {
        state?: { endpoints?: { token_endpoint?: string } };
      };
      const raw = doc.state?.endpoints?.token_endpoint;
      endpoints = raw ? { tokenEndpoint: new URL(raw, options.origin).href } : null;
    } catch {
      endpoints = null;
    }
    return endpoints;
  }

  async function grant(body: string): Promise<TokenState | 'invalid_grant' | null> {
    if (!endpoints) return null;
    const res = await f(endpoints.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const parsed = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    } | null;
    if (!res.ok || !parsed?.access_token) {
      return parsed?.error === 'invalid_grant' ? 'invalid_grant' : null;
    }
    return { accessToken: parsed.access_token, refreshToken: parsed.refresh_token };
  }

  async function refresh(): Promise<boolean> {
    if (!(await ensureEndpoints())) return false;
    if (token?.refreshToken) {
      const r = await grant(
        `grant_type=refresh_token&refresh_token=${encodeURIComponent(token.refreshToken)}`,
      );
      if (r && r !== 'invalid_grant') {
        token = { accessToken: r.accessToken, refreshToken: r.refreshToken };
        return true;
      }
      if (r !== 'invalid_grant') return false;
      // refresh token dead → re-authenticate
    }
    const creds =
      `grant_type=client_credentials&client_id=${encodeURIComponent(options.clientId)}` +
      `&client_secret=${encodeURIComponent(options.clientSecret)}` +
      (options.scope ? `&scope=${encodeURIComponent(options.scope)}` : '');
    const r = await grant(creds);
    if (r && r !== 'invalid_grant') {
      token = { accessToken: r.accessToken, refreshToken: r.refreshToken };
      return true;
    }
    return false;
  }

  return {
    async getAuthHeaders(): Promise<Record<string, string>> {
      return token ? { Authorization: `Bearer ${token.accessToken}` } : {};
    },
    onAuthRefresh() {
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    accessToken: () => token?.accessToken ?? null,
  };
}
