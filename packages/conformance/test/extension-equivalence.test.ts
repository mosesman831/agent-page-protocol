/**
 * Wire-format equivalence: the repo ships two independent implementations of
 * the APP wire format — the TypeScript workspace code (@agent-page/client +
 * @agent-page/server) and extension/protocol/*.js (the MV3 renderer). This
 * suite runs every conformance vector (TV-01..TV-140) against the conformance
 * server, captures every wire document the vectors exchange, and feeds the
 * same documents through BOTH implementations:
 *
 *   classification  parse.js classifyDocument  vs  client isPageManifest/isDiffDocument
 *   validation      validate.js validateManifest/validateAppDocument vs client shape checks
 *                   + server validateManifestState
 *   diff apply      diff.js applyDiffDocument    vs  client applyDiffDocument
 *   media types     parse.js parseMediaType      vs  client parseMediaType
 *
 * Asserts identical verdicts and deep-equal resulting manifests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startConformanceServer, ALL_VECTORS, type ConformanceServer } from '../src/index.js';
import { validateManifestState } from '../src/server/validate.js';
import {
  isPageManifest,
  isDiffDocument,
  applyDiffDocument as tsApplyDiff,
  parseMediaType as tsParseMediaType,
} from '@agent-page/client';
// @ts-expect-error extension/protocol is plain JS without type declarations
import {
  classifyDocument,
  parseMediaType as jsParseMediaType,
} from '../../../extension/protocol/parse.js';
// @ts-expect-error extension/protocol is plain JS without type declarations
import {
  validateAppDocument,
  validateManifest as jsValidateManifest,
} from '../../../extension/protocol/validate.js';
// @ts-expect-error extension/protocol is plain JS without type declarations
import { applyDiffDocument as jsApplyDiff } from '../../../extension/protocol/diff.js';

type CapturedDoc = { vectorId: string; url: string; mediaType: string; body: unknown };
interface PageManifestLike {
  page: { id: string; url: string; version: string };
  state: Record<string, unknown>;
}

const captured: CapturedDoc[] = [];
const manifestByUrl = new Map<string, unknown>();
const diffPairs: { vectorId: string; manifest: unknown; diff: unknown }[] = [];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** TS-side counterpart of classifyDocument's manifest|diff|error|unknown kind. */
function tsKind(doc: unknown): string {
  if (!isRecord(doc)) return 'unknown';
  // Mirror parse.js: an `app` version the client doesn't support classifies as
  // unknown before any shape check (e.g. the '9.9' version.unsupported stamp).
  if (doc.app !== '1.0' && doc.app !== '1.1') return 'unknown';
  const err = doc.error;
  if (isRecord(err) && 'code' in err && !('page' in doc)) {
    if (!('state' in doc) && String(err.code).startsWith('app.err.')) return 'error';
  }
  if (isDiffDocument(doc)) return 'diff';
  if (isPageManifest(doc)) return 'manifest';
  if (isRecord(err) && 'code' in err && !('page' in doc)) return 'error';
  return 'unknown';
}

describe('wire-format equivalence: packages/ TS vs extension/protocol JS', () => {
  let server: ConformanceServer;

  beforeAll(async () => {
    server = await startConformanceServer();
    let current = '';
    const capFetch: typeof fetch = async (input, init) => {
      const res = await fetch(input, init);
      const clone = res.clone();
      const mediaType = clone.headers.get('content-type') ?? '';
      const url = typeof input === 'string' ? input : String(input);
      if (mediaType.includes('json')) {
        try {
          const body: unknown = await clone.json();
          captured.push({ vectorId: current, url, mediaType, body });
          if (isPageManifest(body)) manifestByUrl.set(url, body);
          if (isDiffDocument(body)) {
            diffPairs.push({
              vectorId: current,
              manifest: manifestByUrl.get(url) ?? null,
              diff: body,
            });
          }
        } catch {
          /* non-JSON handled by media type filter; ignore clone failures */
        }
      }
      return res;
    };
    for (const v of ALL_VECTORS) {
      current = v.meta.id;
      server.state.reset(server.port);
      try {
        await v.run({ baseUrl: server.baseUrl, origin: server.origin, fetch: capFetch });
      } catch {
        // a throwing vector still exercised the wire surface it reached
      }
    }
  }, 120_000);

  afterAll(async () => {
    await server.close();
  });

  it('captured a non-trivial corpus of real wire documents', () => {
    expect(captured.length).toBeGreaterThan(100);
    expect(captured.filter((c) => isPageManifest(c.body)).length).toBeGreaterThan(40);
    expect(diffPairs.length).toBeGreaterThan(5);
  });

  it('media-type parsing agrees on every captured Content-Type', () => {
    const mediaTypes = [...new Set(captured.map((c) => c.mediaType))];
    expect(mediaTypes.length).toBeGreaterThan(0);
    for (const mt of mediaTypes) {
      expect(jsParseMediaType(mt)).toBe(tsParseMediaType(mt));
    }
  });

  it('document classification agrees on every captured body', () => {
    for (const { vectorId, url, body } of captured) {
      const js = classifyDocument(body).kind as string;
      const ts = tsKind(body);
      expect(js, `${vectorId} ${url}: JS=${js} TS=${ts}`).toBe(ts);
    }
  });

  it('manifest validation agrees on every captured manifest', () => {
    const manifests = captured.filter((c) => isPageManifest(c.body));
    expect(manifests.length).toBeGreaterThan(50);
    for (const { vectorId, url, body } of manifests) {
      const js = jsValidateManifest(body);
      const tsState = validateManifestState((body as PageManifestLike).state);
      const tsOk = tsState === null;
      expect(
        Boolean(js.ok),
        `${vectorId} ${url}: JS=${JSON.stringify(js)} TS=${JSON.stringify(tsState)}`,
      ).toBe(tsOk);
    }
  });

  it('diff application agrees on every captured diff against its manifest', () => {
    const usable = diffPairs.filter((p) => p.manifest !== null);
    expect(usable.length).toBeGreaterThan(0);
    for (const { vectorId, manifest, diff } of usable) {
      const js = jsApplyDiff(manifest, diff);
      const ts = tsApplyDiff(manifest as never, diff as never);
      expect(
        js.ok,
        `${vectorId}: JS=${JSON.stringify(js.ok ? 'ok' : js)} TS=${JSON.stringify(ts.ok ? 'ok' : ts)}`,
      ).toBe(ts.ok);
      if (js.ok && ts.ok) {
        expect(js.manifest, `${vectorId}: resulting manifest differs`).toEqual(ts.manifest);
        expect(js.changedPaths).toEqual(ts.changedPaths);
        expect(js.navigation_effect ?? null).toEqual(ts.navigation_effect ?? null);
      }
    }
  });

  it('validateAppDocument verdicts agree with TS kind classification', () => {
    for (const { vectorId, url, body } of captured) {
      const v = validateAppDocument(body) as { kind: string; ok: boolean };
      expect(v.kind, `${vectorId} ${url}`).toBe(tsKind(body));
      // well-formed wire docs must validate; malformed kinds must not
      if (v.kind === 'unknown') expect(v.ok).toBe(false);
    }
  });

  it('synthetic edge documents classify identically', () => {
    const v11Manifest = {
      app: '1.1',
      page: { id: 'p', url: 'https://x.test/p', version: '1' },
      state: {},
      actions: {},
    };
    const cases: unknown[] = [
      v11Manifest,
      { app: '1.0', error: { code: 'app.err.test', message: 'x' } },
      { app: '1.0' },
      null,
      [],
      42,
      'x',
      { page: {}, state: {} }, // no app key
    ];
    for (const doc of cases) {
      expect(classifyDocument(doc).kind, JSON.stringify(doc)).toBe(tsKind(doc));
    }
    // and 1.1 documents must pass the JS-side manifest validator too
    expect(jsValidateManifest(v11Manifest).ok).toBe(true);
  });
});
