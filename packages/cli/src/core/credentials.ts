import { readFileSync, existsSync } from 'node:fs';

export interface CredentialResolverOptions {
  bearerEnv?: string;
  apiKeyEnv?: string;
  cookieJar?: string;
  cookieEnv?: string;
}

/** Resolve auth headers from env / optional cookie jar. Never persist values. */
export class CredentialResolver {
  private readonly bearerEnv: string;
  private readonly apiKeyEnv: string;
  private readonly cookieEnv: string;
  private readonly cookieJar?: string;
  private droppedOrigins = new Set<string>();

  constructor(opts: CredentialResolverOptions = {}) {
    this.bearerEnv = opts.bearerEnv ?? 'AGENT_PAGE_BEARER';
    this.apiKeyEnv = opts.apiKeyEnv ?? 'AGENT_PAGE_API_KEY';
    this.cookieEnv = opts.cookieEnv ?? 'AGENT_PAGE_COOKIE';
    this.cookieJar = opts.cookieJar;
  }

  getAuthHeaders(origin?: string): Record<string, string> {
    if (origin && this.droppedOrigins.has(origin)) {
      return {};
    }
    const headers: Record<string, string> = {};
    const bearer = process.env[this.bearerEnv];
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const apiKey = process.env[this.apiKeyEnv];
    if (apiKey) headers['X-API-Key'] = apiKey;
    const cookie = this.readCookie(origin);
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  drop(origin?: string): void {
    if (origin) this.droppedOrigins.add(origin);
    else this.droppedOrigins.add('*');
  }

  dropAll(): void {
    this.droppedOrigins.add('*');
  }

  private readCookie(origin?: string): string | undefined {
    const fromEnv = process.env[this.cookieEnv];
    if (fromEnv) return fromEnv;
    if (!this.cookieJar || !existsSync(this.cookieJar)) return undefined;
    try {
      const raw = readFileSync(this.cookieJar, 'utf8');
      // Simple jar: either raw Cookie header or JSON { [origin]: cookie }
      if (raw.trim().startsWith('{')) {
        const map = JSON.parse(raw) as Record<string, string>;
        if (origin && map[origin]) return map[origin];
        return undefined;
      }
      return raw.trim() || undefined;
    } catch {
      return undefined;
    }
  }
}
