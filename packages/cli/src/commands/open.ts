import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdOpen(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const url = parsed.positional[0];
  if (!url) {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'open requires <url>',
        retryable: false,
      },
    };
  }
  const discoverFlag = parsed.flags.discover;
  const discover =
    discoverFlag === undefined ? undefined : discoverFlag !== false && discoverFlag !== 'false';
  return runtime.open(url, {
    discover,
    sessionId:
      typeof parsed.flags['session-id'] === 'string' ? parsed.flags['session-id'] : undefined,
    title: typeof parsed.flags.title === 'string' ? parsed.flags.title : undefined,
    force: !!parsed.flags.force,
  });
}
