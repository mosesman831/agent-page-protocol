/**
 * File transfer: multipart + presign PUT (SPEC-v0.5-extreme §11).
 * Cross-origin PUT MUST NOT send Cookie.
 */

import type { ActionDispatcher } from './actions.js';
import { findAction } from './actions.js';
import { AppError } from './errors.js';
import type { AppHttpClient, FetchLike } from './http.js';
import { ACCEPT_ACTION, MEDIA_ACTION } from './media-types.js';
import { isSameOrigin, resolveAppUrl } from './navigate.js';
import type { ActionDef, PageManifest, ParamDef } from './types.js';
import { unwrapStateNode } from './features.js';

export interface UploadBytes {
  name: string;
  mime: string;
  bytes: Uint8Array | ArrayBuffer | Blob;
  size?: number;
  param?: string;
}

export interface UploadReceipt {
  file_id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

function asUint8Array(bytes: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (bytes instanceof Uint8Array) return Promise.resolve(bytes);
  if (bytes instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(bytes));
  return bytes.arrayBuffer().then((b) => new Uint8Array(b));
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', view as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fileParamOf(
  actionDef: ActionDef,
  paramName?: string,
): { key: string; def: ParamDef } | null {
  const input = actionDef.input ?? {};
  if (paramName && input[paramName]) return { key: paramName, def: input[paramName]! };
  for (const [key, def] of Object.entries(input)) {
    if (def.type === 'file' || def.upload === true) return { key, def };
  }
  return null;
}

function transferOf(def: ParamDef): 'multipart' | 'presign' | 'either' {
  if (def.transfer === 'presign' || def.transfer === 'multipart' || def.transfer === 'either') {
    return def.transfer;
  }
  return def.upload ? 'multipart' : 'multipart';
}

function readUploadSlot(manifest: PageManifest): {
  file_id: string;
  put_url: string;
  method: string;
  header_content_type?: string;
} | null {
  const slot = manifest.state?.upload_slot;
  const raw = unwrapStateNode(slot) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;
  const file_id = typeof raw.file_id === 'string' ? raw.file_id : undefined;
  const put_url = typeof raw.put_url === 'string' ? raw.put_url : undefined;
  const method = typeof raw.method === 'string' ? raw.method : 'PUT';
  const header_content_type =
    typeof raw.header_content_type === 'string' ? raw.header_content_type : undefined;
  if (!file_id || !put_url) return null;
  return { file_id, put_url, method, header_content_type };
}

/**
 * Raw PUT/POST of file bytes. Cross-origin: no Cookie, no APP Authorization.
 * Not an APP action.
 */
export async function presignPut(
  fetchImpl: FetchLike,
  putUrl: string,
  body: Uint8Array,
  options: {
    pageUrl: string;
    contentType: string;
    method?: string;
    cookie?: string;
    authorization?: string;
  },
): Promise<Response> {
  const headers = new Headers();
  headers.set('Content-Type', options.contentType);
  const sameOrigin = isSameOrigin(putUrl, options.pageUrl);
  if (sameOrigin) {
    if (options.cookie) headers.set('Cookie', options.cookie);
    if (options.authorization) headers.set('Authorization', options.authorization);
  }
  const method = (options.method ?? 'PUT').toUpperCase();
  const res = await fetchImpl(putUrl, {
    method,
    headers,
    body: body as unknown as BodyInit,
    redirect: 'manual',
  });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      const next = new URL(loc, putUrl);
      if (next.host !== new URL(putUrl).host) {
        throw new AppError('app.err.security.cross_origin', {
          message: 'Presign PUT redirect to a different host is forbidden',
        });
      }
    }
  }
  return res;
}

export async function uploadFile(
  ctx: { http: AppHttpClient; dispatcher: ActionDispatcher },
  manifest: PageManifest,
  actionId: string,
  file: UploadBytes,
  options: { preferPresign?: boolean } = {},
): Promise<{ receipt?: UploadReceipt; manifest: PageManifest }> {
  const actionDef = findAction(manifest, actionId);
  const fileParam = fileParamOf(actionDef, file.param);
  const bytes = await asUint8Array(file.bytes);
  const size = file.size ?? bytes.byteLength;
  const sha256 = await sha256Hex(bytes);

  const transfer = fileParam
    ? transferOf(fileParam.def)
    : options.preferPresign
      ? 'presign'
      : 'multipart';
  const usePresign =
    transfer === 'presign' || (transfer === 'either' && options.preferPresign !== false);

  if (usePresign && (manifest.actions?.presign_upload || transfer === 'presign')) {
    if (!manifest.actions?.presign_upload) {
      throw new AppError('app.err.action.upload_unsupported', {
        message: 'presign_upload action is not advertised',
      });
    }
    const slotted = await ctx.dispatcher.invoke(manifest, 'presign_upload', {
      name: file.name,
      mime: file.mime,
      size,
    });
    const slot = readUploadSlot(slotted.manifest);
    if (!slot) {
      throw new AppError('app.err.manifest.invalid', {
        message: 'presign_upload did not return upload_slot',
      });
    }
    const putUrl = slot.put_url;
    const pageUrl = manifest.page.url;
    const contentType = slot.header_content_type ?? file.mime;
    const res = await presignPut(ctx.http.fetch, putUrl, bytes, {
      pageUrl,
      contentType,
      method: slot.method,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new AppError('app.err.action.upload_unsupported', {
        message: `Presign PUT failed with HTTP ${res.status}`,
        httpStatus: res.status,
      });
    }
    const receipt: UploadReceipt = {
      file_id: slot.file_id,
      name: file.name,
      mime: file.mime,
      size,
      sha256,
    };
    if (actionId !== 'presign_upload') {
      const paramKey = fileParam?.key ?? 'receipt';
      const invoked = await ctx.dispatcher.invoke(slotted.manifest, actionId, {
        [paramKey]: receipt,
      });
      return { receipt, manifest: invoked.manifest };
    }
    return { receipt, manifest: slotted.manifest };
  }

  const postUrl = resolveAppUrl(actionDef.action_url || manifest.page.url, manifest.page.url);
  const payload = JSON.stringify({
    app: manifest.app === '1.1' ? '1.1' : '1.0',
    action: actionId,
    params: {},
    client: { kind: 'agent', name: 'agent-page-client', version: '0.4.0' },
    context: {
      page_id: manifest.page.id,
      page_url: manifest.page.url,
      manifest_version: manifest.page.version,
    },
  });
  const form = new FormData();
  form.append('payload', new Blob([payload], { type: MEDIA_ACTION }), 'payload.json');
  const key = fileParam?.key ?? file.param ?? 'file';
  form.append(key, new Blob([bytes as unknown as BlobPart], { type: file.mime }), file.name);

  const { meta, body } = await ctx.http.request(postUrl, {
    method: 'POST',
    headers: { Accept: ACCEPT_ACTION },
    body: form,
    pageUrl: manifest.page.url,
    redirect: 'manual',
  });
  if (meta.status >= 400 && meta.status !== 202) {
    ctx.http.throwIfError(body, meta);
  }
  return { manifest: (body as PageManifest) ?? manifest };
}
