import type { ParsedArgs } from '../args.js';
import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdConfirm(runtime: ToolRuntime, parsed: ParsedArgs): Promise<ToolEnvelope> {
  const approve = !!parsed.flags.approve;
  const reject = !!parsed.flags.reject;
  if (approve === reject) {
    return {
      app: '1.0',
      tool: '1.0',
      ok: false,
      status: 'error',
      error: {
        code: 'app.err.tool.usage',
        message: 'confirm requires exactly one of --approve / --reject',
        retryable: false,
      },
    };
  }
  return runtime.confirm({
    approve,
    reject,
    token: typeof parsed.flags.token === 'string' ? parsed.flags.token : undefined,
    noWait: !!parsed.flags['no-wait'],
  });
}
