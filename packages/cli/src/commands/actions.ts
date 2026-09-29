import type { ToolRuntime } from '../core/index.js';
import type { ToolEnvelope } from '../core/types.js';

export async function cmdActions(runtime: ToolRuntime): Promise<ToolEnvelope> {
  return runtime.actions();
}
