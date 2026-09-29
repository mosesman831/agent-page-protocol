/**
 * app:// MCP resources (§10.16). Hold resources never include raw_body_b64.
 */

import type { ToolEnvelope, ToolRuntime } from './runtime.js';
import { envelopeToCallToolResult } from './map-error.js';

export interface McpResource {
  uri: string;
  name: string;
  mimeType: string;
  description?: string;
}

export interface ResourceContents {
  uri: string;
  mimeType: string;
  text: string;
}

const HOLD_FORBIDDEN_KEYS = new Set(['raw_body_b64', 'raw_body', 'body_sha256']);

/** Strip private hold fields before exposing via resources. */
export function publicHold(hold: Record<string, unknown> | null): Record<string, unknown> {
  if (!hold) {
    return { hold: null };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(hold)) {
    if (HOLD_FORBIDDEN_KEYS.has(k)) continue;
    out[k] = v;
  }
  // Nested gates may also carry secrets in some stores; strip known keys recursively one level.
  if (Array.isArray(out.gates)) {
    out.gates = (out.gates as Array<Record<string, unknown>>).map((g) => {
      const copy = { ...g };
      delete copy.hold_token;
      return copy;
    });
  }
  return out;
}

export function assertNoRawBody(obj: unknown): void {
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    for (const item of obj) assertNoRawBody(item);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === 'raw_body_b64') {
      throw new Error('raw_body_b64 leaked into resource');
    }
    assertNoRawBody(v);
  }
}

function sessionSummaryFields(s: {
  id: string;
  origin: string;
  title?: string | null;
  current?: { page_id: string; url: string; version: string } | null;
  current_url?: string | null;
}): { id: string; origin: string; label: string } {
  const url = s.current?.url ?? s.current_url ?? s.origin;
  return { id: s.id, origin: s.origin, label: url };
}

export async function listResources(
  runtime: ToolRuntime,
  wellKnownOrigins: Iterable<string> = [],
): Promise<McpResource[]> {
  const resources: McpResource[] = [];
  for (const s of runtime.store.listSessions()) {
    const { id, label } = sessionSummaryFields(s);
    resources.push({
      uri: `app://session/${id}`,
      name: `session ${id}`,
      mimeType: 'application/json',
      description: label,
    });
    resources.push({
      uri: `app://session/${id}/manifest`,
      name: `manifest ${id}`,
      mimeType: 'application/vnd.agent-page+json',
      description: 'Planner-stripped secrets-redacted manifest',
    });
    resources.push({
      uri: `app://session/${id}/hold`,
      name: `hold ${id}`,
      mimeType: 'application/json',
      description: 'Public hold object or { hold: null }',
    });
  }
  for (const origin of wellKnownOrigins) {
    resources.push({
      uri: `app://well-known/${encodeURIComponent(origin)}`,
      name: `well-known ${origin}`,
      mimeType: 'application/json',
      description: 'Cached discovery object',
    });
  }
  return resources;
}

async function digestForSession(
  runtime: ToolRuntime,
  sessionId: string,
): Promise<ToolEnvelope | null> {
  const current = runtime.getCurrentSessionId();
  try {
    if (current !== sessionId) {
      const sw = await runtime.sessions({ op: 'switch', session: sessionId });
      if (sw.status === 'error') return null;
    }
    return await runtime.read({ full: true });
  } finally {
    if (current && current !== sessionId) {
      await runtime.sessions({ op: 'switch', session: current }).catch(() => undefined);
    }
  }
}

export async function readResource(
  runtime: ToolRuntime,
  uri: string,
): Promise<ResourceContents | null> {
  const sessionHold = /^app:\/\/session\/([^/]+)\/hold$/.exec(uri);
  if (sessionHold) {
    const id = decodeURIComponent(sessionHold[1]);
    const raw = runtime.holds.load(id);
    const body = publicHold(raw);
    assertNoRawBody(body);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(raw ? body : { hold: null }),
    };
  }

  const sessionManifest = /^app:\/\/session\/([^/]+)\/manifest$/.exec(uri);
  if (sessionManifest) {
    const id = decodeURIComponent(sessionManifest[1]);
    let manifest: Record<string, unknown> | null = null;
    try {
      const session = runtime.store.readSession(id);
      const url = session.current?.url ?? session.current_url;
      if (url && runtime.store.readPublicCache) {
        const cached = runtime.store.readPublicCache(url);
        if (cached?.manifest) manifest = cached.manifest;
      }
    } catch {
      return null;
    }
    if (!manifest) {
      const digestEnv = await digestForSession(runtime, id);
      if (digestEnv?.digest) {
        manifest = {
          app: '1.0',
          page: digestEnv.digest.page,
          state: digestEnv.digest.state,
          actions: digestEnv.digest.actions,
        };
      }
    }
    if (!manifest) return null;
    return {
      uri,
      mimeType: 'application/vnd.agent-page+json',
      text: JSON.stringify(manifest),
    };
  }

  const session = /^app:\/\/session\/([^/]+)$/.exec(uri);
  if (session) {
    const id = decodeURIComponent(session[1]);
    const digest = await digestForSession(runtime, id);
    if (!digest) return null;
    const result = envelopeToCallToolResult(digest);
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(result.structuredContent),
    };
  }

  const wellKnown = /^app:\/\/well-known\/(.+)$/.exec(uri);
  if (wellKnown) {
    const origin = decodeURIComponent(wellKnown[1]);
    const discovery = await runtime.discover({ url: origin });
    if (discovery.status === 'error' || !discovery.discovery) return null;
    return {
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(discovery.discovery),
    };
  }

  return null;
}
