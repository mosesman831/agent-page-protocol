/**
 * Fixed tool list (§10.3) and dispatch to ToolRuntime (§11.2 method shapes).
 */

import {
  FIXED_TOOL_NAMES,
  INPUT_SCHEMAS,
  TOOL_DESCRIPTIONS,
  TOOL_ENVELOPE_OUTPUT_SCHEMA,
  type FixedToolName,
  type JsonSchema,
} from './schemas.js';
import { envelopeToCallToolResult, errorEnvelope, type CallToolResult } from './map-error.js';
import type { ToolEnvelope, ToolRuntime } from './runtime.js';
import { validateInput } from './validate.js';
import {
  notifyHold,
  notifyResourcesListChanged,
  notifyResourcesUpdated,
  notifyToolsListChanged,
  type NotifyFn,
} from './notifications.js';
import {
  buildDynamicTools,
  isDynamicActTool,
  parseDynamicActTool,
  type DynamicToolDef,
} from './dynamic-tools.js';

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export function listFixedTools(): McpToolDef[] {
  return FIXED_TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: INPUT_SCHEMAS[name],
    outputSchema: TOOL_ENVELOPE_OUTPUT_SCHEMA,
  }));
}

async function maybeSwitchSession(
  runtime: ToolRuntime,
  session: unknown,
): Promise<ToolEnvelope | null> {
  if (typeof session !== 'string' || !session) return null;
  if (runtime.getCurrentSessionId() === session) return null;
  return runtime.sessions({ op: 'switch', session });
}

const SESSIONFUL: ReadonlySet<FixedToolName> = new Set([
  'app_open',
  'app_read',
  'app_act',
  'app_confirm',
  'app_challenge',
  'app_watch',
  'app_logout',
]);

/**
 * Every runtime method takes the validated MCP arguments object unchanged —
 * tool-core reads the same field names the input schemas declare.
 */
async function dispatchFixed(
  runtime: ToolRuntime,
  name: FixedToolName,
  args: Record<string, unknown>,
): Promise<ToolEnvelope> {
  if (SESSIONFUL.has(name)) {
    const switched = await maybeSwitchSession(runtime, args.session);
    if (switched && switched.status === 'error') return switched;
  }
  switch (name) {
    case 'app_discover':
      return runtime.discover(args);
    case 'app_open':
      return runtime.open(args);
    case 'app_read':
      return runtime.read(args);
    case 'app_act':
      return runtime.act(args);
    case 'app_confirm':
      return runtime.confirm(args);
    case 'app_challenge':
      return runtime.challenge(args);
    case 'app_watch':
      return runtime.watch(args);
    case 'app_sessions':
      return runtime.sessions(args);
    case 'app_logout':
      return runtime.logout(args);
    case 'app_reset':
      return runtime.reset(args);
    default: {
      const _exhaustive: never = name;
      return errorEnvelope('app.err.tool.internal', `Unhandled tool ${_exhaustive}`);
    }
  }
}

export interface ToolHost {
  runtime: ToolRuntime;
  dynamicTools: boolean;
  notify: NotifyFn;
  projected: DynamicToolDef[];
  /** Origins cached after successful app_discover (§10.16). */
  wellKnownOrigins: Set<string>;
  refreshProjected(): Promise<void>;
}

async function pageActionsFromRuntime(
  runtime: ToolRuntime,
): Promise<{ pageId: string; actions: Array<Record<string, unknown>> } | null> {
  const sid = runtime.getCurrentSessionId();
  if (!sid) return null;
  try {
    const env = await runtime.read({ actions_only: true });
    const actions = (env.digest?.actions ?? []) as Array<Record<string, unknown>>;
    const pageId =
      (env.page?.id as string | undefined) ??
      (env.digest?.page?.id as string | undefined) ??
      'page';
    return { pageId, actions };
  } catch {
    return null;
  }
}

export function createToolHost(
  runtime: ToolRuntime,
  opts: { dynamicTools?: boolean; notify?: NotifyFn } = {},
): ToolHost {
  const host: ToolHost = {
    runtime,
    dynamicTools: opts.dynamicTools === true,
    notify: opts.notify ?? (() => {}),
    projected: [],
    wellKnownOrigins: new Set(),
    async refreshProjected() {
      if (!host.dynamicTools) {
        host.projected = [];
        return;
      }
      const page = await pageActionsFromRuntime(runtime);
      if (!page) {
        host.projected = [];
        return;
      }
      host.projected = buildDynamicTools(
        page.pageId,
        page.actions.map((a) => ({
          id: String(a.id ?? ''),
          description: typeof a.description === 'string' ? a.description : undefined,
          kind: typeof a.kind === 'string' ? a.kind : undefined,
          side_effect: typeof a.side_effect === 'string' ? a.side_effect : undefined,
          requires_confirmation: a.requires_confirmation === true,
          idempotent: a.idempotent === true,
          auth: typeof a.auth === 'string' ? a.auth : undefined,
          input: (a.input as Record<string, unknown> | undefined) ?? {},
        })),
      );
    },
  };
  return host;
}

export function listToolsForHost(host: ToolHost): McpToolDef[] {
  const fixed = listFixedTools();
  if (!host.dynamicTools || host.projected.length === 0) {
    return fixed;
  }
  return [
    ...fixed,
    ...host.projected.map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
      outputSchema: TOOL_ENVELOPE_OUTPUT_SCHEMA,
    })),
  ];
}

function afterSideEffects(host: ToolHost, name: string, envelope: ToolEnvelope): void {
  const session = typeof envelope.session === 'string' ? envelope.session : null;

  if (name === 'app_discover' && envelope.ok && envelope.discovery) {
    const origin = envelope.discovery.origin;
    if (typeof origin === 'string') {
      host.wellKnownOrigins.add(origin);
      notifyResourcesListChanged(host.notify);
    }
  }

  if (envelope.status === 'hold' && envelope.hold && session) {
    notifyHold(host.notify, session, envelope.hold as Record<string, unknown>);
  }

  if (
    name === 'app_open' ||
    name === 'app_sessions' ||
    name === 'app_reset' ||
    name === 'app_logout'
  ) {
    notifyResourcesListChanged(host.notify);
  }

  if (
    session &&
    (name === 'app_open' ||
      name === 'app_act' ||
      name === 'app_confirm' ||
      name === 'app_challenge' ||
      isDynamicActTool(name))
  ) {
    notifyResourcesUpdated(host.notify, `app://session/${session}`);
    notifyResourcesUpdated(host.notify, `app://session/${session}/manifest`);
    notifyResourcesUpdated(host.notify, `app://session/${session}/hold`);
  }
}

export type CallToolOutcome =
  | { kind: 'result'; result: CallToolResult }
  | { kind: 'rpc_error'; code: number; message: string; data?: unknown };

export async function callTool(
  host: ToolHost,
  name: string,
  args: unknown,
): Promise<CallToolOutcome> {
  try {
    if (isDynamicActTool(name)) {
      if (!host.dynamicTools) {
        return { kind: 'rpc_error', code: -32601, message: 'Method not found' };
      }
      const parsed = parseDynamicActTool(name);
      if (!parsed) {
        return { kind: 'rpc_error', code: -32601, message: 'Method not found' };
      }
      const schema = host.projected.find((p) => p.name === name)?.inputSchema ?? {
        type: 'object',
        additionalProperties: false,
        properties: {
          session: { type: 'string' },
          wait: { type: 'boolean', default: true },
          follow: { type: 'boolean', default: true },
          params: { type: 'object', additionalProperties: true },
        },
      };
      const validated = validateInput(schema, args);
      if (!validated.ok) {
        return {
          kind: 'rpc_error',
          code: -32602,
          message: 'Invalid params',
          data: { failures: validated.failures },
        };
      }
      const switched = await maybeSwitchSession(host.runtime, validated.value.session);
      if (switched && switched.status === 'error') {
        return { kind: 'result', result: envelopeToCallToolResult(switched) };
      }
      const envelope = await host.runtime.act({
        ...validated.value,
        action: parsed.actionId,
      });
      afterSideEffects(host, name, envelope);
      const before = host.projected.map((p) => p.name).join(',');
      await host.refreshProjected();
      const after = host.projected.map((p) => p.name).join(',');
      if (before !== after) {
        notifyToolsListChanged(host.notify);
      }
      return { kind: 'result', result: envelopeToCallToolResult(envelope) };
    }

    if (!(FIXED_TOOL_NAMES as readonly string[]).includes(name)) {
      return { kind: 'rpc_error', code: -32601, message: 'Method not found' };
    }

    const fixedName = name as FixedToolName;
    const schema = INPUT_SCHEMAS[fixedName];
    const validated = validateInput(schema, args);
    if (!validated.ok) {
      return {
        kind: 'rpc_error',
        code: -32602,
        message: 'Invalid params',
        data: { failures: validated.failures },
      };
    }

    const beforeNames = host.projected.map((p) => p.name).join(',');
    const envelope = await dispatchFixed(host.runtime, fixedName, validated.value);
    afterSideEffects(host, fixedName, envelope);

    if (
      host.dynamicTools &&
      (fixedName === 'app_open' || fixedName === 'app_act' || fixedName === 'app_confirm')
    ) {
      await host.refreshProjected();
      const afterNames = host.projected.map((p) => p.name).join(',');
      if (beforeNames !== afterNames) {
        notifyToolsListChanged(host.notify);
      }
    }

    return { kind: 'result', result: envelopeToCallToolResult(envelope) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const envelope = errorEnvelope('app.err.tool.internal', message);
    return { kind: 'result', result: envelopeToCallToolResult(envelope) };
  }
}
