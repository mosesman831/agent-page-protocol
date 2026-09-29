import { describe, it, expect, vi } from 'vitest';
import { AgentClient } from '../src/agent.js';
import { presignPut } from '../src/upload.js';
import { MEDIA_DIFF, MEDIA_PAGE } from '../src/media-types.js';
import type { DiffDocument, PageManifest } from '../src/types.js';

function jsonResponse(
  body: unknown,
  init: { status?: number; contentType?: string; headers?: Record<string, string> } = {},
) {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('content-type')) headers.set('content-type', init.contentType ?? MEDIA_PAGE);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

describe('upload presign PUT (§11.2 / §11.3)', () => {
  it('strips Cookie on cross-origin PUT', async () => {
    const pageUrl = 'https://example.com/account';
    const putUrl = 'https://uploads.example.com/p/fil_01J?X-Amz-Signature=abc';
    const seen: Array<{
      url: string;
      cookie: string | null;
      authorization: string | null;
      appVersion: string | null;
    }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push({
        url: String(input),
        cookie: headers.get('cookie'),
        authorization: headers.get('authorization'),
        appVersion: headers.get('x-app-version'),
      });
      return new Response(null, { status: 200 });
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const res = await presignPut(fetchImpl as typeof fetch, putUrl, bytes, {
      pageUrl,
      contentType: 'application/pdf',
      cookie: 'session=abc; app_csrf=tok',
      authorization: 'Bearer at_secret',
    });
    expect(res.status).toBe(200);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe(putUrl);
    expect(seen[0]!.cookie).toBeNull();
    expect(seen[0]!.authorization).toBeNull();
    expect(seen[0]!.appVersion).toBeNull();
  });

  it('uploadFile uses presign PUT without Cookie on cross-origin put_url', async () => {
    const pageUrl = 'https://example.com/kyc';
    const putUrl = 'https://uploads.example.com/p/fil_01J';
    const page: PageManifest = {
      app: '1.1',
      page: { id: 'kyc', url: pageUrl, version: 'v1' },
      state: {
        features: {
          type: 'object',
          value: { file_presign: { type: 'boolean', value: true } },
        },
      },
      actions: {
        presign_upload: {
          description: 'Allocate an upload slot',
          kind: 'query',
          side_effect: 'safe',
          idempotent: true,
          input: {
            name: { type: 'string', required: true },
            mime: { type: 'string', required: true },
            size: { type: 'number', required: true },
          },
          output: { state_diff: true },
        },
        attach_passport: {
          description: 'Attach passport',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            receipt: { type: 'file', transfer: 'presign' },
          },
        },
      },
    };
    const puts: Array<{ url: string; cookie: string | null; method: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const headers = new Headers(init?.headers);
      if (method === 'PUT') {
        puts.push({ url, cookie: headers.get('cookie'), method });
        return new Response(null, { status: 200 });
      }
      if (method === 'GET') return jsonResponse(page);
      const body = JSON.parse(String(init?.body)) as { action: string };
      if (body.action === 'presign_upload') {
        const slotted: PageManifest = {
          ...page,
          page: { ...page.page, version: 'v2' },
          state: {
            ...page.state,
            upload_slot: {
              type: 'object',
              value: {
                file_id: { type: 'string', value: 'fil_01J' },
                put_url: { type: 'string', value: putUrl, secret: true },
                method: { type: 'enum', value: 'PUT', options: ['PUT', 'POST'] },
                header_content_type: { type: 'string', value: 'application/pdf' },
              },
            },
          },
        };
        const diff: DiffDocument = {
          app: '1.1',
          base: { page_id: 'kyc', page_url: pageUrl, version: 'v1' },
          result_version: 'v2',
          diff: [
            {
              op: 'add',
              path: '/state/upload_slot',
              value: slotted.state.upload_slot,
            },
          ],
        };
        return jsonResponse(diff, { contentType: MEDIA_DIFF });
      }
      if (body.action === 'attach_passport') {
        return jsonResponse({ ...page, page: { ...page.page, version: 'v3' } });
      }
      throw new Error(`unexpected action ${body.action}`);
    });
    const client = new AgentClient({
      fetch: fetchImpl as typeof fetch,
      getAuthHeaders: () => ({ Cookie: 'session=secret', Authorization: 'Bearer at_x' }),
    });
    const m = await client.hydrate(pageUrl);
    await client.uploadFile(m, 'attach_passport', {
      name: 'passport.pdf',
      mime: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
    });
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe(putUrl);
    expect(puts[0]!.cookie).toBeNull();
  });
});
