import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdNavigate(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const url = parsed.positional[0];
  if (!url) {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'navigate requires <url>',
        retryable: false,
      },
    };
  }
  return runtime.navigate(url);
}
