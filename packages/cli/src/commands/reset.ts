import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdReset(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  return runtime.reset({
    all: !!parsed.flags.all,
    session:
      typeof parsed.global.session === 'string'
        ? parsed.global.session
        : typeof parsed.flags.session === 'string'
          ? parsed.flags.session
          : undefined,
  });
}
