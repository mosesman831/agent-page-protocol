import type { ToolConfig } from './types.js';
import { SessionStore } from './session-store.js';

export interface ResolvedConfig {
  home: string;
  output: 'json' | 'pretty';
  topK: number;
  timeoutMs: number;
  sessionTtlMs: number;
  asyncWait: boolean;
  policyStrict: boolean;
  strict: boolean;
  clientName: string;
  acceptVersions: string;
  bearerEnv?: string;
  apiKeyEnv?: string;
  cookieJar?: string;
  verbose: boolean;
  quiet: boolean;
  noColor: boolean;
  interactive: boolean;
  failOnSoft: boolean;
  full: boolean;
  raw: boolean;
  session?: string;
}

export function resolveConfig(
  store: SessionStore,
  flags: Partial<{
    home: string;
    json: boolean;
    pretty: boolean;
    session: string;
    timeoutMs: number;
    topK: number;
    full: boolean;
    raw: boolean;
    verbose: boolean;
    quiet: boolean;
    noColor: boolean;
    strict: boolean;
    policyStrict: boolean;
    failOnSoft: boolean;
    clientName: string;
    acceptVersions: string;
    bearerEnv: string;
    apiKeyEnv: string;
    cookieJar: string;
    interactive: boolean;
  }>,
): ResolvedConfig {
  const file: ToolConfig = (() => {
    try {
      return store.loadConfig();
    } catch {
      return {};
    }
  })();

  let output: 'json' | 'pretty' = 'json';
  if (process.env.AGENT_PAGE_OUTPUT === 'pretty') output = 'pretty';
  if (file.output === 'pretty') output = 'pretty';
  if (flags.pretty) output = 'pretty';
  if (flags.json) output = 'json';

  const asyncWaitEnv = process.env.AGENT_PAGE_ASYNC_WAIT;
  const asyncWait =
    asyncWaitEnv === '0' ? false : file.async_wait !== undefined ? file.async_wait : true;

  return {
    home: flags.home ?? store.home,
    output,
    topK: flags.topK ?? numEnv('AGENT_PAGE_TOP_K') ?? file.top_k ?? 8,
    timeoutMs: flags.timeoutMs ?? numEnv('AGENT_PAGE_TIMEOUT_MS') ?? file.timeout_ms ?? 120_000,
    sessionTtlMs: file.session_ttl_ms ?? 86_400_000,
    asyncWait,
    policyStrict: flags.policyStrict ?? file.policy_strict ?? false,
    strict: flags.strict ?? file.strict ?? false,
    clientName: flags.clientName ?? process.env.AGENT_PAGE_CLIENT_NAME ?? 'agent-page-cli',
    acceptVersions: flags.acceptVersions ?? process.env.AGENT_PAGE_ACCEPT_VERSIONS ?? '1.1, 1.0',
    bearerEnv: flags.bearerEnv,
    apiKeyEnv: flags.apiKeyEnv,
    cookieJar: flags.cookieJar ?? process.env.AGENT_PAGE_COOKIE_JAR,
    verbose: flags.verbose ?? process.env.AGENT_PAGE_VERBOSE === '1',
    quiet: flags.quiet ?? false,
    noColor: flags.noColor ?? process.env.NO_COLOR === '1',
    interactive: flags.interactive ?? false,
    failOnSoft: flags.failOnSoft ?? false,
    full: flags.full ?? false,
    raw: flags.raw ?? false,
    session: flags.session ?? process.env.AGENT_PAGE_SESSION,
  };
}

function numEnv(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
