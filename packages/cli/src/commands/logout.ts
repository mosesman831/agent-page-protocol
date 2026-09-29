import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdLogout(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const origin = parsed.positional[0];
  return runtime.logout(origin, !!parsed.flags.all);
}
