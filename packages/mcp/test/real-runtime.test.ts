/**
 * End-to-end dispatch test: the REAL @agent-page/tool-core runtime behind the
 * MCP tool host, with fetch stubbed to a minimal APP site. Guards the §11.2
 * arg-object contract — the mock-runtime tests cannot catch interface drift.
 *
 * Requires `npm run build` (tool-core dist) — same assumption as the
 * extension harness's conformance imports.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '@agent-page/tool-core';
import { AgentPageMcpServer } from '../src/server.js';

const BASE = 'http://127.0.0.1:8789';
const MEDIA_PAGE = 'application/vnd.agent-page+json';
const MEDIA_ERROR = 'application/vnd.agent-page-error+json';

const str = (value: string) => ({ type: 'string', value });

const wellKnown = {
  app: '1.1',
  page: { id: 'well-known', url: `${BASE}/.well-known/agent-page`, title: 'WK', version: 'wk1' },
  state: {
    site_name: str('Test Site'),
    protocol_version: str('1.1'),
    capabilities: { type: 'array', value: [str('checkout')] },
  },
  actions: {},
};

const payPage = {
  app: '1.1',
  page: { id: 'pay_page', url: `${BASE}/flights`, title: 'Pay', version: 'v1' },
  state: {},
  actions: {
    pay: {
      description: 'Pay now',
      kind: 'mutate',
      requires_confirmation: true,
      input: {},
      output: { navigates_to: `${BASE}/done` },
    },
  },
};

const donePage = {
  app: '1.1',
  page: { id: 'done_page', url: `${BASE}/done`, title: 'Done', version: 'v2' },
  state: { status: str('booked') },
  actions: {},
};

function jsonResponse(body: unknown, status = 200, type = MEDIA_PAGE): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': type },
  });
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname === '/.well-known/agent-page' && (!init || init.method !== 'POST')) {
    return jsonResponse(wellKnown);
  }
  if (init?.method === 'POST') {
    const headers = new Headers(init?.headers);
    const confirmation = headers.get('x-app-confirmation');
    if (confirmation !== 'tok_test') {
      return jsonResponse(
        {
          app: '1.1',
          error: {
            code: 'app.err.action.confirmation_required',
            message: 'Confirm payment',
            retryable: true,
            http_status: 428,
            details: { confirmation_challenge: str('tok_test') },
          },
        },
        428,
        MEDIA_ERROR,
      );
    }
    return jsonResponse(donePage);
  }
  if (url.pathname === '/flights') return jsonResponse(payPage);
  return jsonResponse({ error: 'not found' }, 404, 'text/plain');
}

async function callTool(server: AgentPageMcpServer, id: number, name: string, args: unknown) {
  const res = await server.handleMessage({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  });
  expect(res && 'result' in res).toBe(true);
  return (res as { result: { structuredContent?: { status?: string; [k: string]: unknown } } })
    .result.structuredContent;
}

describe('MCP dispatch against the real tool-core runtime', () => {
  it('drives discover → open → act(hold) → confirm end-to-end', async () => {
    const home = mkdtempSync(join(tmpdir(), 'agent-page-mcp-'));
    const runtime = createRuntime({
      home,
      fetch: fakeFetch as typeof fetch,
      clientName: 'mcp-test',
      clientVersion: '0',
    });
    const server = new AgentPageMcpServer({ runtime });

    const discovery = await callTool(server, 1, 'app_discover', { url: BASE });
    expect(discovery?.status).toBe('ok');

    const opened = await callTool(server, 2, 'app_open', { url: `${BASE}/flights` });
    expect(opened?.status).toBe('ok');
    expect((opened?.page as { id?: string })?.id).toBe('pay_page');

    const held = await callTool(server, 3, 'app_act', { action: 'pay' });
    expect(held?.status).toBe('hold');

    const confirmed = await callTool(server, 4, 'app_confirm', { decision: 'approve' });
    expect(confirmed?.status === 'ok' || confirmed?.status === 'navigated').toBe(true);
    expect((confirmed?.page as { id?: string })?.id).toBe('done_page');
  });
});
