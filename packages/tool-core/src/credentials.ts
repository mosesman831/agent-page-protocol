/**
 * Env-only credential resolver. Never persist secrets (CLIENT-TOOL-CONTRACT D-8 / §12.1).
 * Functions accept env *names*, never secret values (argv leak rule).
 */

import { readFileSync, existsSync } from 'node:fs';
import { redactHeaders } from '@agent-page/client';

export interface CredentialResolverOptions {
  /** Env var NAME for bearer token. Default AGENT_PAGE_BEARER. */
  bearerEnv?: string;
  /** Env var NAME for API key. Default AGENT_PAGE_API_KEY. */
  apiKeyEnv?: string;
  /** Env var NAME for Cookie header. Default AGENT_PAGE_COOKIE. */
  cookieEnv?: string;
  /** Optional cookie-jar filesystem path (0600). */
  cookieJar?: string;
}

export class CredentialResolver {
  readonly bearerEnv: string;
  readonly apiKeyEnv: string;
  readonly cookieEnv: string;
  readonly cookieJar: string | undefined;
  private memoryBearer?: string;
  private memoryApiKey?: string;
  private memoryCookie?: string;

  constructor(opts: CredentialResolverOptions = {}) {
    this.bearerEnv = opts.bearerEnv ?? 'AGENT_PAGE_BEARER';
    this.apiKeyEnv = opts.apiKeyEnv ?? 'AGENT_PAGE_API_KEY';
    this.cookieEnv = opts.cookieEnv ?? 'AGENT_PAGE_COOKIE';
    this.cookieJar = opts.cookieJar ?? process.env.AGENT_PAGE_COOKIE_JAR;
  }

  /** Names only; safe to log. */
  envNames(): { bearerEnv: string; apiKeyEnv: string; cookieEnv: string } {
    return {
      bearerEnv: this.bearerEnv,
      apiKeyEnv: this.apiKeyEnv,
      cookieEnv: this.cookieEnv,
    };
  }

  /**
   * Interactive TTY may hold a value in process memory only.
   * Never written to session JSON.
   */
  rememberInMemory(kind: 'bearer' | 'api_key' | 'cookie', value: string): void {
    if (kind === 'bearer') this.memoryBearer = value;
    else if (kind === 'api_key') this.memoryApiKey = value;
    else this.memoryCookie = value;
  }

  clearMemory(): void {
    this.memoryBearer = undefined;
    this.memoryApiKey = undefined;
    this.memoryCookie = undefined;
  }

  getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const bearer = this.memoryBearer ?? process.env[this.bearerEnv];
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const apiKey = this.memoryApiKey ?? process.env[this.apiKeyEnv];
    if (apiKey && !headers.Authorization) headers.Authorization = `Bearer ${apiKey}`;
    const cookie = this.memoryCookie ?? process.env[this.cookieEnv] ?? this.readCookieJar();
    if (cookie) headers.Cookie = cookie;
    return headers;
  }

  private readCookieJar(): string | undefined {
    const path = this.cookieJar;
    if (!path) return undefined;
    try {
      if (!existsSync(path)) return undefined;
      return readFileSync(path, 'utf8').trim() || undefined;
    } catch {
      return undefined;
    }
  }

  /** Redact then emit to a log sink. */
  logHeaders(
    headers: Record<string, string | undefined> | Headers,
    sink: (line: string) => void,
  ): void {
    sink(JSON.stringify(redactHeaders(headers)));
  }
}

export function resolveCredentials(opts: CredentialResolverOptions = {}): CredentialResolver {
  return new CredentialResolver(opts);
}
