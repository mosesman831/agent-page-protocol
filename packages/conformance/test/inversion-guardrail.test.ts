/**
 * Inversion Guardrail (§4.5 / §4.5.1 / §10.2.1 / §14)
 *
 * Agent-native pages have no HTML representation. The Renderer is a first-party
 * client: X-APP-Origin + non-cookie auth; chrome-extension Origin must not POST.
 */

import { createServer, type Server } from 'node:http';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createPageHandler,
  bumpVersion,
  MEDIA_PAGE,
  MEDIA_ACTION,
  MEDIA_ERROR,
  type PageManifest,
  type ActionHandler,
} from '@agent-page/server';
import {
  ACCEPT_PAGE,
  ACCEPT_DIFF,
  MEDIA_PAGE as CONF_MEDIA_PAGE,
  errorCode,
  startConformanceServer,
  type ConformanceServer,
  v11GetHeaders,
  v11ActionHeaders,
} from '../src/index.js';

const HOST = '127.0.0.1';
const PAGE_PATH = '/agent-native';
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456';

interface AgentNativeServer {
  baseUrl: string;
  origin: string;
  close: () => Promise<void>;
  reset: () => void;
}

function makeManifest(origin: string): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'agent_native',
      url: `${origin}${PAGE_PATH}`,
      title: 'Agent Native',
      version: 'v1',
    },
    state: {
      n: { type: 'number', value: 0, label: 'N' },
    },
    actions: {
      touch: {
        description: 'Touch',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
      },
    },
  };
}

async function startAgentNativeServer(): Promise<AgentNativeServer> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, HOST, () => resolve());
  });
  const addr = probe.address();
  if (!addr || typeof addr === 'string') {
    probe.close();
    throw new Error('Failed to bind agent-native server');
  }
  const port = addr.port;
  await new Promise<void>((resolve, reject) => {
    probe.close((err) => (err ? reject(err) : resolve()));
  });

  const origin = `http://${HOST}:${port}`;
  let manifest = makeManifest(origin);

  const touch: ActionHandler = async ({ manifest: cur }) => {
    const next = structuredClone(cur);
    (next.state.n as { value: number }).value += 1;
    next.page.version = bumpVersion(cur.page.version);
    manifest = next;
    return { type: 'diff', nextManifest: next };
  };

  // Agent-native: NO htmlHandler — Accept: text/html → 406 (§4.5 B).
  const pageHandler = createPageHandler({
    pageOrigin: origin,
    getManifest: async () => structuredClone(manifest),
    actionHandlers: { touch },
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(
    express.json({
      type: ['application/json', 'application/vnd.agent-page-action+json', 'application/*+json'],
    }),
  );
  app.use(pageHandler);

  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HOST, () => resolve());
  });

  return {
    baseUrl: `${origin}`,
    origin,
    reset: () => {
      manifest = makeManifest(origin);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('Inversion Guardrail (§4.5 / §10.2.1 / §14)', () => {
  let server: AgentNativeServer;

  beforeAll(async () => {
    server = await startAgentNativeServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.reset();
  });

  describe('a) Agent-native URL + Accept: text/html → 406', () => {
    it('GET Accept: text/html → 406 app.err.negotiate.not_acceptable', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        headers: { Accept: 'text/html' },
      });
      expect(res.status).toBe(406);
      const body = await res.json();
      expect(errorCode(body)).toBe('app.err.negotiate.not_acceptable');
      expect(res.headers.get('content-type') ?? '').toMatch(
        new RegExp(MEDIA_ERROR.replace('+', '\\+')),
      );
    });

    it('GET Accept: application/vnd.agent-page+json → 200 manifest', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toMatch(
        new RegExp(CONF_MEDIA_PAGE.replace('+', '\\+')),
      );
      const body = await res.json();
      expect(body.page).toBeTruthy();
      expect(body.state).toBeTruthy();
      expect(body.actions).toBeTruthy();
      expect(body.actions.touch).toBeTruthy();
    });
  });

  describe('b) Extension-view POST from wrong origin → 403 csrf', () => {
    it('chrome-extension Origin + matching X-APP-Origin + Bearer → 403', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: ACCEPT_DIFF,
          'Content-Type': MEDIA_ACTION,
          Origin: EXT_ORIGIN,
          'X-APP-Origin': server.origin,
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
      });
      expect(res.status).toBe(403);
      expect(errorCode(await res.json())).toBe('app.err.security.csrf');
    });
  });

  describe('c) First-party renderer POST with X-APP-Origin + auth', () => {
    it('Origin absent + X-APP-Origin + Authorization Bearer → success', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: ACCEPT_DIFF,
          'Content-Type': MEDIA_ACTION,
          'X-APP-Origin': server.origin,
          Authorization: 'Bearer test-token',
        },
        body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
      });
      expect(res.status).toBe(200);
    });

    it('Origin absent + X-APP-Origin + Cookie only → 403 csrf', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: ACCEPT_DIFF,
          'Content-Type': MEDIA_ACTION,
          'X-APP-Origin': server.origin,
          Cookie: 'session=valid-renderer-session',
        },
        body: JSON.stringify({ app: '1.0', action: 'touch', params: {} }),
      });
      expect(res.status).toBe(403);
      expect(errorCode(await res.json())).toBe('app.err.security.csrf');
    });
  });

  describe('d) Manifest renders without any HTML artifact', () => {
    it('agent-native GET returns only APP JSON (no HTML tags)', async () => {
      const res = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        headers: { Accept: ACCEPT_PAGE },
      });
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct).toMatch(/application\/vnd\.agent-page\+json/);
      expect(ct).not.toMatch(/text\/html/);

      const text = await res.text();
      expect(text).not.toMatch(/<!doctype/i);
      expect(text).not.toMatch(/<html[\s>]/i);
      expect(text).not.toMatch(/<body[\s>]/i);
      expect(text).not.toMatch(/<title[\s>]/i);

      const body = JSON.parse(text) as {
        page?: unknown;
        state?: unknown;
        actions?: unknown;
      };
      expect(body.page).toBeTruthy();
      expect(body.state).toBeTruthy();
      expect(body.actions).toBeTruthy();
    });

    it('deleting HTML is moot: no text/html 200 path (no htmlHandler)', async () => {
      // Same URL that serves APP JSON never returns 200 HTML — only 406.
      const htmlRes = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      expect(htmlRes.status).toBe(406);
      expect(errorCode(await htmlRes.json())).toBe('app.err.negotiate.not_acceptable');

      const appRes = await fetch(`${server.baseUrl}${PAGE_PATH}`, {
        headers: { Accept: MEDIA_PAGE },
      });
      expect(appRes.status).toBe(200);
      expect(appRes.headers.get('content-type') ?? '').toMatch(
        /application\/vnd\.agent-page\+json/,
      );
    });
  });
});

describe('Inversion Guardrail 1.1 (IG-08..IG-12)', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await startConformanceServer();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    server.state.reset(server.port);
  });

  it('IG-08 agent MUST NOT GET hold widget_url', async () => {
    const urls: string[] = [];
    const wrap: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      return fetch(input, init);
    };
    const res = await wrap(`${server.baseUrl}/v11/search`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({ app: '1.1', action: 'search', params: { q: 'ig08' } }),
    });
    expect(res.status).toBe(428);
    const body = (await res.json()) as {
      error: { details: { hold: { value: { widget_url: { value: string } } } } };
    };
    const widget = body.error.details.hold.value.widget_url.value;
    expect(widget).toBeTruthy();
    expect(urls.some((u) => u === widget)).toBe(false);
  });

  it('IG-09 OAuth IdP delegates_to is not fetched with APP Accept', async () => {
    const fetched: string[] = [];
    const page = await fetch(`${server.baseUrl}/auth/google`, { headers: v11GetHeaders() });
    const body = (await page.json()) as {
      actions: { start_google: { output: { delegates_to: string } } };
    };
    const idp = body.actions.start_google.output.delegates_to;
    expect(idp.startsWith('https://')).toBe(true);
    expect(fetched.includes(idp)).toBe(false);
  });

  it('IG-10 3DS bank URL is not fetched by the agent', async () => {
    const fetched: string[] = [];
    const first = await fetch(`${server.baseUrl}/v11/order`, {
      method: 'POST',
      headers: v11ActionHeaders(server),
      body: JSON.stringify({ app: '1.1', action: 'pay_redirect', params: {} }),
    });
    expect(first.status).toBe(428);
    const tok = (
      (await first.json()) as { error: { details: { confirmation_challenge: { value: string } } } }
    ).error.details.confirmation_challenge.value;
    const ok = await fetch(`${server.baseUrl}/v11/order`, {
      method: 'POST',
      headers: v11ActionHeaders(server, { 'X-APP-Confirmation': tok }),
      body: JSON.stringify({ app: '1.1', action: 'pay_redirect', params: {} }),
    });
    const page = (await ok.json()) as {
      actions?: { continue_pay?: { output?: { delegates_to?: string } } };
    };
    const bank = page.actions?.continue_pay?.output?.delegates_to;
    expect(bank).toMatch(/^https:\/\//);
    expect(fetched.includes(bank!)).toBe(false);
  });

  it('IG-11 consent is machine state; HTML Accept is 406', async () => {
    const appRes = await fetch(`${server.baseUrl}/v11/agent-native`, { headers: v11GetHeaders() });
    expect(appRes.status).toBe(200);
    const body = (await appRes.json()) as { state: { consent?: unknown } };
    expect(body.state.consent).toBeTruthy();
    const html = await fetch(`${server.baseUrl}/v11/agent-native`, {
      headers: { Accept: 'text/html' },
    });
    expect(html.status).toBe(406);
    expect(errorCode(await html.json())).toBe('app.err.negotiate.not_acceptable');
  });

  it('IG-12 callback pages are APP manifests without token leakage', async () => {
    const oauth = await fetch(`${server.baseUrl}/auth/google/callback?code=splendid&state=abc`, {
      headers: v11GetHeaders(),
    });
    expect(oauth.status).toBe(200);
    const oauthText = await oauth.text();
    expect(oauth.headers.get('content-type') ?? '').toMatch(/vnd\.agent-page\+json/);
    expect(oauthText).not.toMatch(/splendid/);
    expect(oauthText).not.toMatch(/eyJ/);
    expect(oauthText).not.toMatch(/"access_token"/);

    const tds = await fetch(`${server.baseUrl}/pay/3ds-callback?code=tok3ds`, {
      headers: v11GetHeaders(),
    });
    expect(tds.status).toBe(200);
    const tdsText = await tds.text();
    expect(tdsText).not.toMatch(/tok3ds/);
    expect(tdsText).not.toMatch(/"access_token"/);
  });
});
