import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdAct(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const action = parsed.positional[0];
  if (!action) {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'act requires <action>',
        retryable: false,
      },
    };
  }

  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.flags)) {
    if (k.startsWith('file:') && typeof v === 'string') {
      files[k.slice(5)] = v;
    }
  }

  return runtime.act(action, {
    params: parsed.params,
    confirmation:
      typeof parsed.flags.confirmation === 'string' ? parsed.flags.confirmation : undefined,
    idempotencyKey:
      typeof parsed.flags['idempotency-key'] === 'string'
        ? parsed.flags['idempotency-key']
        : undefined,
    noWait: !!parsed.flags['no-wait'],
    noFollow: !!parsed.flags['no-follow'],
    noConflictRetry: !!parsed.flags['no-conflict-retry'],
    files: Object.keys(files).length ? files : undefined,
  });
}
