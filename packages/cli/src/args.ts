/**
 * Argv flag grammar + --param inference (CLIENT-TOOL-CONTRACT §7, §11.3).
 */

export interface GlobalFlags {
  json?: boolean;
  pretty?: boolean;
  session?: string;
  home?: string;
  timeoutMs?: number;
  topK?: number;
  full?: boolean;
  raw?: boolean;
  verbose?: boolean;
  quiet?: boolean;
  noColor?: boolean;
  strict?: boolean;
  policyStrict?: boolean;
  failOnSoft?: boolean;
  clientName?: string;
  acceptVersions?: string;
  bearerEnv?: string;
  apiKeyEnv?: string;
  cookieJar?: string;
  interactive?: boolean;
  help?: boolean;
  version?: boolean;
}

export interface ParsedArgs {
  global: GlobalFlags;
  command?: string;
  subcommand?: string;
  positional: string[];
  params: Record<string, unknown>;
  flags: Record<string, string | boolean>;
  /** Raw leftover for command-specific parsing */
  rest: string[];
}

const GLOBAL_LONG: Record<string, keyof GlobalFlags | 'bool'> = {
  json: 'json',
  pretty: 'pretty',
  session: 'session',
  home: 'home',
  'timeout-ms': 'timeoutMs',
  'top-k': 'topK',
  full: 'full',
  raw: 'raw',
  verbose: 'verbose',
  quiet: 'quiet',
  'no-color': 'noColor',
  strict: 'strict',
  'policy-strict': 'policyStrict',
  'fail-on-soft': 'failOnSoft',
  'client-name': 'clientName',
  'accept-versions': 'acceptVersions',
  'bearer-env': 'bearerEnv',
  'api-key-env': 'apiKeyEnv',
  'cookie-jar': 'cookieJar',
  interactive: 'interactive',
  help: 'help',
  version: 'version',
};

const GLOBAL_BOOL = new Set([
  'json',
  'pretty',
  'full',
  'raw',
  'verbose',
  'quiet',
  'no-color',
  'strict',
  'policy-strict',
  'fail-on-soft',
  'interactive',
  'help',
  'version',
]);

/** Infer JSON value from CLI string (§7.4). */
export function inferParamValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw === '') return '';
  if (/^-?[0-9]+(\.[0-9]+)?$/.test(raw)) {
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return raw;
}

export function parseKeyValue(spec: string): { key: string; value: unknown } {
  const eq = spec.indexOf('=');
  if (eq <= 0) {
    throw new UsageError(`Expected KEY=VALUE, got: ${spec}`);
  }
  const key = spec.slice(0, eq);
  const value = inferParamValue(spec.slice(eq + 1));
  return { key, value };
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

export function parseArgv(argv: string[]): ParsedArgs {
  const args = argv.slice();
  const global: GlobalFlags = {};
  const flags: Record<string, string | boolean> = {};
  const params: Record<string, unknown> = {};
  const positional: string[] = [];
  const rest: string[] = [];

  // Track last-wins for --json / --pretty
  const outputOrder: Array<'json' | 'pretty'> = [];

  let i = 0;
  let command: string | undefined;
  let subcommand: string | undefined;
  let pastCommand = false;

  while (i < args.length) {
    const a = args[i]!;

    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }

    if (a.startsWith('--')) {
      const body = a.slice(2);
      const eq = body.indexOf('=');
      const name = eq >= 0 ? body.slice(0, eq) : body;
      let value: string | boolean | undefined = eq >= 0 ? body.slice(eq + 1) : undefined;

      if (name === 'param') {
        const spec = value ?? args[++i];
        if (!spec) throw new UsageError('--param requires KEY=VALUE');
        const kv = parseKeyValue(spec);
        params[kv.key] = kv.value;
        i += 1;
        continue;
      }

      if (name === 'params-json') {
        const raw = value ?? args[++i];
        if (!raw) throw new UsageError('--params-json requires JSON object');
        let obj: unknown;
        try {
          obj = JSON.parse(raw);
        } catch {
          throw new UsageError('--params-json must be valid JSON');
        }
        if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
          throw new UsageError('--params-json must be an object');
        }
        Object.assign(params, obj as Record<string, unknown>);
        i += 1;
        continue;
      }

      if (name === 'file') {
        const spec = value ?? args[++i];
        if (!spec) throw new UsageError('--file requires KEY=PATH');
        const kv = parseKeyValue(spec);
        flags[`file:${kv.key}`] = String(kv.value);
        i += 1;
        continue;
      }

      if (name in GLOBAL_LONG || GLOBAL_BOOL.has(name)) {
        const isBool = GLOBAL_BOOL.has(name);
        if (isBool) {
          if (value === undefined) value = true;
          else if (value === 'false') value = false;
          else value = value !== '0';
        } else if (value === undefined) {
          value = args[++i];
          if (value === undefined) throw new UsageError(`--${name} requires a value`);
        }

        if (name === 'json') {
          outputOrder.push('json');
          global.json = !!value;
        } else if (name === 'pretty') {
          outputOrder.push('pretty');
          global.pretty = !!value;
        } else if (name === 'timeout-ms') {
          global.timeoutMs = Number(value);
        } else if (name === 'top-k') {
          global.topK = Number(value);
        } else {
          const key = GLOBAL_LONG[name];
          if (key && key !== 'bool') {
            (global as Record<string, unknown>)[key] = isBool ? !!value : value;
          }
        }
        i += 1;
        continue;
      }

      // Command flags
      if (isBoolFlagName(name)) {
        flags[name] = value === undefined ? true : value !== 'false' && value !== '0';
      } else {
        if (value === undefined) {
          value = args[++i];
          if (value === undefined) throw new UsageError(`--${name} requires a value`);
        }
        flags[name] = value;
      }
      i += 1;
      continue;
    }

    if (!pastCommand) {
      command = a;
      pastCommand = true;
      i += 1;
      // sessions / challenge take subcommand
      if (
        (command === 'sessions' || command === 'challenge') &&
        i < args.length &&
        !args[i]!.startsWith('-')
      ) {
        subcommand = args[i];
        i += 1;
      }
      continue;
    }

    // Positional KEY=VALUE for act
    if (a.includes('=') && command === 'act') {
      const kv = parseKeyValue(a);
      if (!(kv.key in params)) params[kv.key] = kv.value;
      i += 1;
      continue;
    }

    positional.push(a);
    i += 1;
  }

  // Last flag wins for output mode
  if (outputOrder.length) {
    const last = outputOrder[outputOrder.length - 1];
    if (last === 'pretty') {
      global.pretty = true;
      global.json = false;
    } else {
      global.json = true;
      global.pretty = false;
    }
  }

  return { global, command, subcommand, positional, params, flags, rest };
}

function isBoolFlagName(name: string): boolean {
  return (
    name === 'once' ||
    name === 'approve' ||
    name === 'reject' ||
    name === 'all' ||
    name === 'force' ||
    name === 'discover' ||
    name === 'no-wait' ||
    name === 'no-follow' ||
    name === 'no-conflict-retry' ||
    name === 'sse' ||
    name === 'ws'
  );
}

export const COMMANDS = [
  'open',
  'act',
  'watch',
  'sessions',
  'logout',
  'reset',
  'confirm',
  'challenge',
  'state',
  'actions',
  'navigate',
  'discover',
  'version',
  'help',
] as const;

export type CommandName = (typeof COMMANDS)[number];
