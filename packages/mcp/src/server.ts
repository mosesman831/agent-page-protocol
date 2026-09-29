/**
 * MCP server: initialize capabilities, tools, resources, stdio loop (§10).
 */

import { Readable, Writable } from 'node:stream';
import type { ToolRuntime } from './runtime.js';
import { callTool, createToolHost, listToolsForHost, type ToolHost } from './tools.js';
import { listResources, readResource } from './resources.js';
import {
  encodeMessage,
  isNotification,
  MessageParser,
  rpcError,
  rpcSuccess,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './jsonrpc.js';

export const SERVER_INFO = {
  name: 'agent-page',
  version: '0.5.0',
} as const;

export const INSTRUCTIONS =
  'Agent Page Protocol tools. Use app_discover / app_open / app_act. Never curl APP URLs. Confirmations return status=hold; call app_confirm. Do not invent confirmation tokens.';

export const PROTOCOL_VERSION = '2025-03-26';

export interface ServerOptions {
  runtime: ToolRuntime;
  dynamicTools?: boolean;
  /** Optional write sink for outbound messages (tests). */
  write?: (msg: unknown) => void;
}

export class AgentPageMcpServer {
  readonly host: ToolHost;
  private subscriptions = new Set<string>();
  private readonly writeFn: (msg: unknown) => void;

  constructor(opts: ServerOptions) {
    this.writeFn = opts.write ?? (() => {});
    this.host = createToolHost(opts.runtime, {
      dynamicTools: opts.dynamicTools === true,
      notify: (method, params) => {
        this.sendNotification(method, params);
      },
    });
  }

  sendNotification(method: string, params?: Record<string, unknown>): void {
    this.writeFn({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  async handleMessage(msg: unknown): Promise<JsonRpcResponse | null> {
    if (!msg || typeof msg !== 'object') {
      return rpcError(null, -32700, 'Parse error');
    }

    const req = msg as JsonRpcRequest;
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return rpcError(req.id ?? null, -32600, 'Invalid Request');
    }

    if (isNotification(req)) {
      await this.handleNotification(req);
      return null;
    }

    const id = req.id ?? null;
    try {
      const result = await this.handleRequest(req.method, req.params);
      return rpcSuccess(id, result);
    } catch (err) {
      if (err instanceof RpcThrown) {
        return rpcError(id, err.code, err.message, err.data);
      }
      const message = err instanceof Error ? err.message : String(err);
      return rpcError(id, -32603, 'Internal error', { message });
    }
  }

  private async handleNotification(_req: JsonRpcRequest): Promise<void> {
    // notifications/initialized and other client notifications: no-op
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'initialize':
        return this.onInitialize(params);
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: listToolsForHost(this.host) };
      case 'tools/call':
        return this.onToolsCall(params);
      case 'resources/list':
        return {
          resources: await listResources(this.host.runtime, this.host.wellKnownOrigins),
        };
      case 'resources/read':
        return this.onResourcesRead(params);
      case 'resources/subscribe':
        return this.onResourcesSubscribe(params);
      case 'resources/unsubscribe':
        return this.onResourcesUnsubscribe(params);
      case 'logging/setLevel':
        return {};
      case 'completion/complete':
        return { completion: { values: [], total: 0, hasMore: false } };
      default:
        throw new RpcThrown(-32601, 'Method not found');
    }
  }

  private onInitialize(params: unknown): Record<string, unknown> {
    const p = (params ?? {}) as { protocolVersion?: string; capabilities?: { tools?: unknown } };
    const clientVersion = p.protocolVersion ?? PROTOCOL_VERSION;
    // Accept older clients that still speak tools.
    if (p.capabilities && p.capabilities.tools === undefined && clientVersion === '0') {
      throw new RpcThrown(-32600, 'Client cannot do tools');
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: true },
        resources: { subscribe: true, listChanged: true },
        completions: {},
        logging: {},
      },
      serverInfo: { ...SERVER_INFO },
      instructions: INSTRUCTIONS,
    };
  }

  private async onToolsCall(params: unknown): Promise<unknown> {
    const p = (params ?? {}) as { name?: string; arguments?: unknown };
    if (typeof p.name !== 'string' || !p.name) {
      throw new RpcThrown(-32602, 'Invalid params', { reason: 'name required' });
    }
    const outcome = await callTool(this.host, p.name, p.arguments ?? {});
    if (outcome.kind === 'rpc_error') {
      throw new RpcThrown(outcome.code, outcome.message, outcome.data);
    }
    return outcome.result;
  }

  private async onResourcesRead(params: unknown): Promise<unknown> {
    const p = (params ?? {}) as { uri?: string };
    if (typeof p.uri !== 'string') {
      throw new RpcThrown(-32602, 'Invalid params', { reason: 'uri required' });
    }
    const contents = await readResource(this.host.runtime, p.uri);
    if (!contents) {
      throw new RpcThrown(-32002, 'Resource not found', { uri: p.uri });
    }
    return { contents: [contents] };
  }

  private onResourcesSubscribe(params: unknown): Record<string, never> {
    const p = (params ?? {}) as { uri?: string };
    if (typeof p.uri !== 'string') {
      throw new RpcThrown(-32602, 'Invalid params', { reason: 'uri required' });
    }
    this.subscriptions.add(p.uri);
    return {};
  }

  private onResourcesUnsubscribe(params: unknown): Record<string, never> {
    const p = (params ?? {}) as { uri?: string };
    if (typeof p.uri === 'string') {
      this.subscriptions.delete(p.uri);
    }
    return {};
  }
}

class RpcThrown extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcThrown';
  }
}

export interface StdioServerOptions {
  runtime: ToolRuntime;
  dynamicTools?: boolean;
  stdin?: Readable;
  stdout?: Writable;
}

/**
 * Run the MCP server on stdio with Content-Length framing.
 * Returns a promise that resolves when stdin ends.
 */
export async function runStdioServer(opts: StdioServerOptions): Promise<void> {
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  const parser = new MessageParser();

  const writeOut = (chunk: Buffer | string): void => {
    (stdout as NodeJS.WritableStream).write(chunk);
  };
  const server = new AgentPageMcpServer({
    runtime: opts.runtime,
    dynamicTools: opts.dynamicTools,
    write: (msg) => {
      writeOut(encodeMessage(msg));
    },
  });

  const handle = async (raw: unknown) => {
    const response = await server.handleMessage(raw);
    if (response) {
      writeOut(encodeMessage(response));
    }
  };

  return new Promise((resolve, reject) => {
    stdin.on('data', (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = parser.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      } catch {
        writeOut(encodeMessage(rpcError(null, -32700, 'Parse error')));
        return;
      }
      for (const msg of messages) {
        void handle(msg).catch((err) => {
          writeOut(
            encodeMessage(
              rpcError(null, -32603, 'Internal error', {
                message: err instanceof Error ? err.message : String(err),
              }),
            ),
          );
        });
      }
    });
    stdin.on('end', () => resolve());
    stdin.on('error', (err) => reject(err));
  });
}

export { createToolHost, listToolsForHost, callTool } from './tools.js';
export { listFixedTools } from './tools.js';
export { FIXED_TOOL_NAMES, INPUT_SCHEMAS } from './schemas.js';
export { envelopeToCallToolResult } from './map-error.js';
export { publicHold, assertNoRawBody } from './resources.js';
export { dynamicToolName } from './dynamic-tools.js';
export type { ToolRuntime, ToolEnvelope, CreateRuntimeOptions } from './runtime.js';
