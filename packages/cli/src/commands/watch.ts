import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdWatch(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  return runtime.watch({
    once: !!parsed.flags.once,
    intervalMs:
      typeof parsed.flags['interval-ms'] === 'string'
        ? Number(parsed.flags['interval-ms'])
        : undefined,
    maxEvents:
      typeof parsed.flags['max-events'] === 'string'
        ? Number(parsed.flags['max-events'])
        : undefined,
    timeoutMs:
      typeof parsed.flags['timeout-ms'] === 'string'
        ? Number(parsed.flags['timeout-ms'])
        : undefined,
    sse: !!parsed.flags.sse,
  });
}
