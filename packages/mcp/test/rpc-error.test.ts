import { describe, expect, it } from 'vitest';
import { AgentPageMcpServer } from '../src/server.js';
import { createMockRuntime } from './mock-runtime.js';

describe('MCP JSON-RPC error mapping (§10.19 / §14.3)', () => {
  it('unknown tool -> -32601', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_nope', arguments: {} },
    });
    expect(res && 'error' in res).toBe(true);
    const err = (res as { error: { code: number; message: string } }).error;
    expect(err.code).toBe(-32601);
    expect(err.message).toBe('Method not found');
  });

  it('bad inputSchema -> -32602', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_discover',
        arguments: { not_url: true },
      },
    });
    expect(res && 'error' in res).toBe(true);
    const err = (res as { error: { code: number; message: string } }).error;
    expect(err.code).toBe(-32602);
    expect(err.message).toBe('Invalid params');
  });

  it('APP 404 -> tool result, not RPC error', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/flights' } },
    });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'app_act', arguments: { action: 'missing_page' } },
    });
    expect(res && 'result' in res).toBe(true);
    expect(res && 'error' in res).toBe(false);
    const result = (
      res as {
        result: {
          isError: boolean;
          structuredContent: {
            status: string;
            error?: { code: string; http_status?: number | null };
          };
        };
      }
    ).result;
    expect(result.isError).toBe(true);
    expect(result.structuredContent.status).toBe('error');
    expect(result.structuredContent.error?.http_status).toBe(404);
  });

  it('human_verification challenge kind fails inputSchema (-32602)', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'app_challenge',
        arguments: { kind: 'human_verification', value: 'x' },
      },
    });
    expect(res && 'error' in res).toBe(true);
    expect((res as { error: { code: number } }).error.code).toBe(-32602);
  });
});
