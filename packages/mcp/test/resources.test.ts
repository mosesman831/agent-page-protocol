import { describe, expect, it } from 'vitest';
import { AgentPageMcpServer, assertNoRawBody, publicHold } from '../src/server.js';
import { createMockRuntime } from './mock-runtime.js';

describe('resources (§10.16 / §14.3)', () => {
  it('app://session/{id}/hold never contains raw_body_b64', async () => {
    const { runtime, state } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });

    const openRes = await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/booking' } },
    });
    const session = (openRes as { result: { structuredContent: { session: string } } }).result
      .structuredContent.session;

    await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'app_act',
        arguments: { action: 'confirm_booking', params: { email: 'a@b.c' } },
      },
    });

    // Internal store still has raw bytes
    expect(state.holds.get(session)?.raw_body_b64).toBeTypeOf('string');

    const read = await server.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'resources/read',
      params: { uri: `app://session/${session}/hold` },
    });
    expect(read && 'result' in read).toBe(true);
    const contents = (read as { result: { contents: Array<{ text: string }> } }).result.contents;
    const body = JSON.parse(contents[0].text) as Record<string, unknown>;
    expect(body).not.toHaveProperty('raw_body_b64');
    expect(JSON.stringify(body)).not.toContain('raw_body_b64');
    assertNoRawBody(body);
  });

  it('publicHold strips raw_body_b64 and body_sha256', () => {
    const pub = publicHold({
      kind: 'confirmation',
      action: 'x',
      page_url: 'http://localhost/',
      raw_body_b64: 'abc',
      body_sha256: 'd'.repeat(64),
      challenge: 'chal',
    });
    expect(pub).not.toHaveProperty('raw_body_b64');
    expect(pub).not.toHaveProperty('body_sha256');
    expect(pub.challenge).toBe('chal');
  });

  it('resources/list includes session templates for live sessions', async () => {
    const { runtime } = createMockRuntime();
    const server = new AgentPageMcpServer({ runtime });
    await server.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'app_open', arguments: { url: 'http://localhost:3456/flights' } },
    });
    const list = await server.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'resources/list',
      params: {},
    });
    const resources = (list as { result: { resources: Array<{ uri: string }> } }).result.resources;
    const uris = resources.map((r) => r.uri);
    expect(uris.some((u) => u.startsWith('app://session/') && u.endsWith('/hold'))).toBe(true);
    expect(uris.some((u) => u.startsWith('app://session/') && u.endsWith('/manifest'))).toBe(true);
  });
});
