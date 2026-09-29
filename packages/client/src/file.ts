/**
 * File-node download (SPEC v0.4 §5.2 invariant 9): file URLs are same-origin
 * or same-host signed URLs; on 401/403 the client MUST revalidate the parent
 * manifest fresh rather than blind-retrying the URL; cross-origin redirects
 * MUST NOT be followed; `sha256` MUST be verified when declared.
 */

import { AppError, isErrorEnvelope } from './errors.js';
import type { AppHttpClient } from './http.js';
import type { FileValue, PageManifest } from './types.js';

export interface DownloadedFile {
  bytes: Uint8Array;
  name: string;
  mime: string;
  /** Manifest the bytes came from — refreshed if a 401/403 forced revalidation. */
  manifest: PageManifest;
}

export interface FileDeps {
  http: AppHttpClient;
  hydrate: (
    url: string,
    opts?: { force?: boolean; bypassCache?: boolean },
  ) => Promise<PageManifest>;
}

/** Bound on same-origin redirect hops; cross-origin is never followed. */
const MAX_REDIRECT_HOPS = 1;

function fileValueOf(manifest: PageManifest, nodeKey: string): FileValue {
  const node = manifest.state?.[nodeKey];
  if (!node || node.type !== 'file') {
    throw new AppError('app.err.state.invalid_node', {
      message: `state.${nodeKey} is not a file node`,
    });
  }
  return node.value as FileValue;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** GET a file URL, following only same-origin redirects (bounded). */
async function fetchFile(http: AppHttpClient, url: string, pageUrl: string): Promise<Response> {
  let current = url;
  for (let hop = 0; ; hop++) {
    const res = await http.getFile(current, { pageUrl });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      const target = location ? new URL(location, current) : null;
      if (!target || target.origin !== new URL(current).origin || hop >= MAX_REDIRECT_HOPS) {
        throw new AppError('app.err.state.invalid_file', {
          message: 'File URL redirect left the origin or exceeded the redirect bound',
        });
      }
      current = target.href;
      continue;
    }
    return res;
  }
}

async function throwForResponse(res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => null);
  if (isErrorEnvelope(body)) {
    throw new AppError(body.error.code, {
      message: body.error.message,
      httpStatus: res.status,
      details: body.error.details,
      request_id: body.error.request_id,
      retry_after_ms: body.error.retry_after_ms,
    });
  }
  throw new AppError('app.err.http_error', {
    message: `File fetch failed: HTTP ${res.status}`,
    httpStatus: res.status,
  });
}

export async function downloadFile(
  deps: FileDeps,
  manifest: PageManifest,
  nodeKey: string,
): Promise<DownloadedFile> {
  let current = manifest;
  let value = fileValueOf(current, nodeKey);
  let res = await fetchFile(deps.http, value.url, current.page.url);
  if (res.status === 401 || res.status === 403) {
    // Signed URL may have expired: revalidate the parent manifest fresh,
    // then retry once against the URL it now advertises.
    current = await deps.hydrate(current.page.url, { force: true, bypassCache: true });
    value = fileValueOf(current, nodeKey);
    res = await fetchFile(deps.http, value.url, current.page.url);
  }
  if (!res.ok) await throwForResponse(res);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (value.sha256) {
    const hex = await sha256Hex(bytes);
    if (hex !== value.sha256) {
      throw new AppError('app.err.state.invalid_file', {
        message: `File sha256 mismatch for state.${nodeKey}`,
      });
    }
  }
  return { bytes, name: value.name, mime: value.mime, manifest: current };
}
