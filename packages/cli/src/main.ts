import { parseArgv, UsageError, COMMANDS } from './args.js';
import { renderPretty, USAGE } from './pretty.js';
import { createRuntime, exitCodeFor, defaultHome, type ToolEnvelope } from './core/index.js';
import { cmdOpen } from './commands/open.js';
import { cmdAct } from './commands/act.js';
import { cmdConfirm } from './commands/confirm.js';
import { cmdChallenge } from './commands/challenge.js';
import { cmdWatch } from './commands/watch.js';
import { cmdSessions } from './commands/sessions.js';
import { cmdLogout } from './commands/logout.js';
import { cmdReset } from './commands/reset.js';
import { cmdState } from './commands/state.js';
import { cmdActions } from './commands/actions.js';
import { cmdNavigate } from './commands/navigate.js';
import { cmdDiscover } from './commands/discover.js';

export { parseArgv, inferParamValue, parseKeyValue } from './args.js';
export { renderPretty, USAGE } from './pretty.js';
export { createRuntime, exitCodeFor, HoldSignal } from './core/index.js';

function writeOutput(envelope: ToolEnvelope, pretty: boolean, noColor: boolean): void {
  if (pretty) {
    process.stdout.write(renderPretty(envelope, noColor) + '\n');
  } else {
    process.stdout.write(JSON.stringify(envelope) + '\n');
  }
}

function usageEnvelope(message: string): ToolEnvelope {
  return {
    app: '1.0',
    tool: '1.0',
    ok: false,
    status: 'error',
    error: {
      code: 'app.err.tool.usage',
      message,
      retryable: false,
    },
  };
}

function versionEnvelope(): ToolEnvelope {
  return {
    app: '1.0',
    tool: '1.0',
    ok: true,
    status: 'ok',
    meta: {
      warnings: [],
      negotiated_version: '1.0',
    },
    discovery: {
      origin: '',
      well_known_url: '',
      supported: false,
      site_name: null,
      protocol_version: '1.0',
      capabilities: [],
      entry_urls: {},
    },
  };
}

/**
 * CLI entry: parse argv, dispatch, write stdout, return exit code.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (e) {
    const msg = e instanceof UsageError ? e.message : 'Invalid arguments';
    writeOutput(usageEnvelope(msg), false, false);
    return 2;
  }

  const prettyEnv = process.env.AGENT_PAGE_OUTPUT === 'pretty';
  const pretty = parsed.global.pretty ?? (prettyEnv && !parsed.global.json);
  const noColor = !!parsed.global.noColor || process.env.NO_COLOR === '1';

  if (
    parsed.global.help ||
    parsed.command === 'help' ||
    (!parsed.command && !parsed.global.version)
  ) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (parsed.global.version || parsed.command === 'version') {
    if (pretty) {
      process.stdout.write(
        'agent-page 0.5.0 / tool-contract 1.0 / protocol 1.0 / client-sdk 0.4.0\n',
      );
    } else {
      writeOutput(versionEnvelope(), false, noColor);
    }
    return 0;
  }

  if (!parsed.command || !(COMMANDS as readonly string[]).includes(parsed.command)) {
    const env = usageEnvelope(
      parsed.command ? `Unknown command: ${parsed.command}` : 'Missing command',
    );
    writeOutput(env, !!pretty, noColor);
    return 2;
  }

  const home = parsed.global.home ?? defaultHome();
  const asyncWaitDefault = process.env.AGENT_PAGE_ASYNC_WAIT === '0' ? false : true;

  let runtime;
  try {
    runtime = createRuntime({
      home,
      session: parsed.global.session,
      topK: parsed.global.topK,
      timeoutMs: parsed.global.timeoutMs,
      policyStrict: parsed.global.policyStrict,
      full: parsed.global.full,
      raw: parsed.global.raw,
      clientName: parsed.global.clientName ?? 'agent-page-cli',
      clientVersion: '0.5.0',
      acceptVersions: parsed.global.acceptVersions,
      bearerEnv: parsed.global.bearerEnv,
      apiKeyEnv: parsed.global.apiKeyEnv,
      cookieJar: parsed.global.cookieJar,
      asyncWait: asyncWaitDefault,
      failOnSoft: parsed.global.failOnSoft,
    });
  } catch (e) {
    const code =
      e && typeof e === 'object' && 'code' in e
        ? String((e as { code: string }).code)
        : 'app.err.tool.internal';
    const env: ToolEnvelope = {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code,
        message: e instanceof Error ? e.message : 'Failed to start runtime',
        retryable: false,
      },
    };
    writeOutput(env, !!pretty, noColor);
    return exitCodeFor(env);
  }

  let envelope: ToolEnvelope;
  try {
    switch (parsed.command) {
      case 'open':
        envelope = await cmdOpen(runtime, parsed);
        break;
      case 'act':
        envelope = await cmdAct(runtime, parsed);
        break;
      case 'confirm':
        envelope = await cmdConfirm(runtime, parsed);
        break;
      case 'challenge':
        envelope = await cmdChallenge(runtime, parsed);
        break;
      case 'watch':
        envelope = await cmdWatch(runtime, parsed);
        break;
      case 'sessions':
        envelope = await cmdSessions(runtime, parsed);
        break;
      case 'logout':
        envelope = await cmdLogout(runtime, parsed);
        break;
      case 'reset':
        envelope = await cmdReset(runtime, parsed);
        break;
      case 'state':
        envelope = await cmdState(runtime, parsed);
        break;
      case 'actions':
        envelope = await cmdActions(runtime);
        break;
      case 'navigate':
        envelope = await cmdNavigate(runtime, parsed);
        break;
      case 'discover':
        envelope = await cmdDiscover(runtime, parsed);
        break;
      default:
        envelope = usageEnvelope(`Unhandled command: ${parsed.command}`);
    }
  } catch (e) {
    envelope = {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.internal',
        message: e instanceof Error ? e.message : 'Internal error',
        retryable: false,
      },
    };
  }

  // Soft async_failed -> non-zero only with --fail-on-soft
  let code = exitCodeFor(envelope);
  if (envelope.status === 'async_failed' && parsed.global.failOnSoft) {
    code = 1;
  }

  writeOutput(envelope, !!pretty, noColor);
  return code;
}
