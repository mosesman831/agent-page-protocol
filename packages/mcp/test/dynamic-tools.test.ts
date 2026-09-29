import { describe, expect, it } from 'vitest';
import { AgentPageMcpServer, dynamicToolName } from '../src/server.js';
import { createMockRuntime } from './mock-runtime.js';

describe('dynamic tools (§10.18 / §14.3)', () => {
  it('is off by default: tools/list is exactly 10 fixed names', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/flights' } },
    });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_act',
        arguments: {
          action: 'search',
          params: { origin: 'LHR', destination: 'DXB' },
        },
      },
    });
    const list = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    });
    const tools = (list as { result: { tools: Array<{ name: string }> } }).result.tools;
    expect(tools).toHaveLength(10);
    expect(tools.some((t) => t.name.startsWith('app_act__'))).toBe(false);
  });

  it('when on, app_act__flight_results__filter appears after open+search', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime, dynamicTools: true });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/flights' } },
    });
    await server.host.refreshProjected();

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_act',
        arguments: {
          action: 'search',
          params: { origin: 'LHR', destination: 'DXB' },
        },
      },
    });
    await server.host.refreshProjected();

    const list = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
      params: {},
    });
    const tools = (list as { result: { tools: Array<{ name: string }> } }).result.tools;
    const expected = dynamicToolName('flight_results', 'filter');
    expect(expected).toBe('app_act__flight_results__filter');
    expect(tools.some((t) => t.name === expected)).toBe(true);
    expect(tools.length).toBeGreaterThan(10);
  });
});
