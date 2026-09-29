import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdSessions(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const op = parsed.subcommand ?? 'list';
  const id = parsed.positional[0];
  return runtime.sessions(op, id);
}
