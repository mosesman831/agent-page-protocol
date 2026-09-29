#!/usr/bin/env node
/**
 * agent-page-mcp stdio entry (CLIENT-TOOL-CONTRACT §10.1 / §11.4).
 *
 * Credentials enter via process env / --bearer-env only. Never via tool args.
 */

import { runStdioServer } from './server.js';
import type { CreateRuntimeOptions, ToolRuntime } from './runtime.js';

function parseArgs(argv: string[]): {
  dynamicTools: boolean;
  home?: string;
  bearerEnv?: string;
  listen?: string;
} {
  let dynamicTools = false;
  let home: string | undefined;
  let bearerEnv: string | undefined;
  let listen: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dynamic-tools') {
      dynamicTools = true;
    } else if (a === '--home' && argv[i + 1]) {
      home = argv[++i];
    } else if (a.startsWith('--home=')) {
      home = a.slice('--home='.length);
    } else if (a === '--bearer-env' && argv[i + 1]) {
      bearerEnv = argv[++i];
    } else if (a.startsWith('--bearer-env=')) {
      bearerEnv = a.slice('--bearer-env='.length);
    } else if (a === '--listen' && argv[i + 1]) {
      listen = argv[++i];
    } else if (a.startsWith('--listen=')) {
      listen = a.slice('--listen='.length);
    }
  }

  return { dynamicTools, home, bearerEnv, listen };
}

async function loadRuntime(opts: CreateRuntimeOptions): Promise<ToolRuntime> {
  const mod = (await import('@agent-page/tool-core')) as {
    createRuntime?: (o?: CreateRuntimeOptions) => ToolRuntime;
    default?: { createRuntime?: (o?: CreateRuntimeOptions) => ToolRuntime };
  };
  const create = mod.createRuntime ?? mod.default?.createRuntime;
  if (typeof create !== 'function') {
    throw new Error(
      '@agent-page/tool-core does not export createRuntime; install/build tool-core first',
    );
  }
  return create({
    ...opts,
    clientName: 'agent-page-mcp',
    clientVersion: '0.5.0',
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.listen) {
    console.error('streamable HTTP --listen is optional and not enabled in this build; use stdio');
    process.exit(2);
  }

  const home = args.home ?? process.env.AGENT_PAGE_HOME;
  const runtime = await loadRuntime({
    home,
    dynamicTools: args.dynamicTools,
    bearerEnv: args.bearerEnv,
  });

  await runStdioServer({
    runtime,
    dynamicTools: args.dynamicTools,
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
