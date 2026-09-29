import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdState(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  return runtime.state({
    path: typeof parsed.flags.path === 'string' ? parsed.flags.path : undefined,
    full: !!parsed.flags.full || !!parsed.global.full,
  });
}
