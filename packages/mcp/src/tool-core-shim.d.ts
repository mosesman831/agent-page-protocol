/**
 * Ambient module until @agent-page/tool-core is linked in the workspace.
 * When tool-core lands, its real types take precedence via package resolution.
 */

declare module '@agent-page/tool-core' {
  import type { CreateRuntimeOptions, ToolRuntime } from './runtime.js';

  export function createRuntime(opts?: CreateRuntimeOptions): ToolRuntime;
  export type { CreateRuntimeOptions, ToolRuntime };
}
