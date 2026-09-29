import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdDiscover(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const origin = parsed.positional[0];
  if (!origin) {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'discover requires <origin-or-url>',
        retryable: false,
      },
    };
  }
  return runtime.discover(origin);
}
