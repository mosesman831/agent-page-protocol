import { describe, expect, it } from 'vitest';
import { AgentPageMcpServer, FIXED_TOOL_NAMES, INPUT_SCHEMAS } from '../src/server.js';
import { createMockRuntime } from './mock-runtime.js';

describe('tools/list (§14.3)', () => {
  it('returns exactly the 10 normative tool names', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    expect(res).toBeTruthy();
    expect(res && 'result' in res).toBe(true);
    const tools = (
      res as { result: { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> } }
    ).result.tools;
    expect(tools.map((t) => t.name)).toEqual([...FIXED_TOOL_NAMES]);
    expect(tools).toHaveLength(10);
  });

  it('marks every fixed tool inputSchema additionalProperties false', async () => {
    for (const name of FIXED_TOOL_NAMES) {
      const schema = INPUT_SCHEMAS[name];
      expect(schema.additionalProperties).toBe(false);
    }
  });

  it('initialize advertises tools listChanged and no prompts', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        clientInfo: { name: 'test', version: '0' },
      },
    });
    const result = (res as { result: Record<string, unknown> }).result;
    expect(result.serverInfo).toEqual({ name: 'agent-page', version: '0.5.0' });
    const caps = result.capabilities as {
      tools: { listChanged: boolean };
      resources: { subscribe: boolean; listChanged: boolean };
      prompts?: unknown;
    };
    expect(caps.tools.listChanged).toBe(true);
    expect(caps.resources.subscribe).toBe(true);
    expect(caps.prompts).toBeUndefined();
  });
});
