/**
 * Load config.json + env. $AGENT_PAGE_HOME default ~/.agent-page.
 * Reject secrets in config (CLIENT-TOOL-CONTRACT D-19 / §9.6).
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AppError } from '@agent-page/client';
import {
  DEFAULT_SESSION_TTL_MS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TOP_K,
  type ToolConfig,
} from './types.js';

const SECRET_CONFIG_KEYS = [
  'bearer',
  'token',
  'authorization',
  'password',
  'cookie',
  'api_key',
  'apiKey',
  'secret',
  'private_key',
];

export function defaultHome(): string {
  const env = process.env.AGENT_PAGE_HOME?.trim();
  return env && env.length > 0 ? env : join(homedir(), '.agent-page');
}

export function assertNoConfigSecrets(raw: Record<string, unknown>): void {
  for (const k of Object.keys(raw)) {
    if (SECRET_CONFIG_KEYS.includes(k)) {
      throw new AppError('app.err.tool.config_secret', {
        message: `Secret key not allowed in config.json: ${k}`,
      });
    }
  }
}

export function loadConfigFile(home?: string): ToolConfig {
  const root = home ?? defaultHome();
  const path = join(root, 'config.json');
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const raw = parsed as Record<string, unknown>;
  assertNoConfigSecrets(raw);
  return raw as ToolConfig;
}

export interface ResolvedToolConfig {
  home: string;
  output: 'json' | 'pretty';
  topK: number;
  timeoutMs: number;
  sessionTtlMs: number;
  asyncWait: boolean;
  policyStrict: boolean;
  strict: boolean;
  dynamicTools: boolean;
  acceptVersions: string;
  clientName: string;
  allowInsecureHome: boolean;
  verbose: boolean;
  file: ToolConfig;
}

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return undefined;
}

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Precedence: flag > env > config.json > built-in default.
 */
export function resolveConfig(
  flags: Partial<ResolvedToolConfig> = {},
  home?: string,
): ResolvedToolConfig {
  const resolvedHome = flags.home ?? home ?? defaultHome();
  const file = loadConfigFile(resolvedHome);
  const outputEnv = process.env.AGENT_PAGE_OUTPUT;
  const output: 'json' | 'pretty' =
    flags.output ??
    (outputEnv === 'pretty' || outputEnv === 'json' ? outputEnv : undefined) ??
    file.output ??
    'json';
  return {
    home: resolvedHome,
    output,
    topK: flags.topK ?? envInt('AGENT_PAGE_TOP_K') ?? file.top_k ?? DEFAULT_TOP_K,
    timeoutMs:
      flags.timeoutMs ?? envInt('AGENT_PAGE_TIMEOUT_MS') ?? file.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    sessionTtlMs: flags.sessionTtlMs ?? file.session_ttl_ms ?? DEFAULT_SESSION_TTL_MS,
    asyncWait: flags.asyncWait ?? envBool('AGENT_PAGE_ASYNC_WAIT') ?? file.async_wait ?? true,
    policyStrict: flags.policyStrict ?? file.policy_strict ?? false,
    strict: flags.strict ?? file.strict ?? false,
    dynamicTools: flags.dynamicTools ?? file.dynamic_tools ?? false,
    acceptVersions: process.env.AGENT_PAGE_ACCEPT_VERSIONS ?? '1.1, 1.0',
    clientName: process.env.AGENT_PAGE_CLIENT_NAME ?? flags.clientName ?? 'agent-page-cli',
    allowInsecureHome: process.env.AGENT_PAGE_ALLOW_INSECURE_HOME === '1',
    verbose: process.env.AGENT_PAGE_VERBOSE === '1',
    file,
  };
}
