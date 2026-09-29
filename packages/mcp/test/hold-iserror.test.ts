import { describe, expect, it } from 'vitest';
import { AgentPageMcpServer } from '../src/server.js';
import { createMockRuntime } from './mock-runtime.js';

describe('hold isError mapping (§10.4 / §14.3)', () => {
  it('confirmation hold -> isError false and structuredContent.status === hold', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/booking' } },
    });

    const res = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_act',
        arguments: {
          action: 'confirm_booking',
          params: { email: 'ada@example.com', passport: 'AB1234567' },
        },
      },
    });

    expect(res && 'result' in res).toBe(true);
    const result = (
      res as {
        result: {
          isError: boolean;
          structuredContent: { status: string; hold?: { kind: string }; error?: unknown };
          content: Array<{ type: string; text: string }>;
        };
      }
    ).result;

    expect(result.isError).toBe(false);
    expect(result.structuredContent.status).toBe('hold');
    expect(result.structuredContent.hold?.kind).toBe('confirmation');
    expect(result.structuredContent.error).toBeUndefined();
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text) as { status: string };
    expect(parsed.status).toBe('hold');
  });
});
