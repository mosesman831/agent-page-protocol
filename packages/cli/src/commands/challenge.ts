import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdChallenge(
  runtime: ToolRuntime,
  parsed: ParsedArgs,
): Promise<ToolEnvelope> {
  const op = parsed.subcommand;
  if (op !== 'submit' && op !== 'abort') {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'challenge requires submit|abort',
        retryable: false,
      },
    };
  }
  return runtime.challenge({
    op,
    kind: typeof parsed.flags.kind === 'string' ? parsed.flags.kind : undefined,
    value: typeof parsed.flags.value === 'string' ? parsed.flags.value : undefined,
  });
}
