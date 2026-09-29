/**
 * JSON Patch generate + apply (RFC 6902 subset §7).
 */

import jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';
import type { DiffDocument, JsonPatchOp, PageManifest } from './types.js';
import { APP_VERSION } from './media-types.js';

const { compare, applyPatch } = jsonpatch;

const FORBIDDEN_PATH_PREFIXES = ['/app', '/page/id', '/page/url', '/page/etag', '/page/version'];
const ALLOWED_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

export interface DiffGenerateOptions {
  /** If true, reject ops targeting forbidden paths. Default true. */
  enforceAllowedPaths?: boolean;
}

export function isAllowedDiffPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  for (const forbidden of FORBIDDEN_PATH_PREFIXES) {
    if (path === forbidden || path.startsWith(`${forbidden}/`)) return false;
  }
  // Allowed prefixes — /page/version is carried via DiffDocument.result_version (§7.2 / C1)
  const allowed =
    path.startsWith('/state') ||
    path.startsWith('/actions') ||
    path.startsWith('/navigation') ||
    path.startsWith('/present') ||
    path === '/page/title' ||
    path.startsWith('/page/title/') ||
    path.startsWith('/error') ||
    path.startsWith('/meta') ||
    path.startsWith('/page/generated_at') ||
    path.startsWith('/page/language') ||
    path.startsWith('/page/description');
  return allowed;
}

export function validateDiffOps(
  ops: JsonPatchOp[],
): { ok: true } | { ok: false; code: string; message: string; path?: string } {
  for (const op of ops) {
    if (!ALLOWED_OPS.has(op.op)) {
      return {
        ok: false,
        code: 'app.err.diff.unsupported_op',
        message: `Unsupported patch op: ${op.op}`,
      };
    }
    if (!isAllowedDiffPath(op.path)) {
      return {
        ok: false,
        code: 'app.err.diff.invalid_path',
        message: `Diff path not allowed: ${op.path}`,
        path: op.path,
      };
    }
    if ((op.op === 'move' || op.op === 'copy') && 'from' in op) {
      if (!isAllowedDiffPath(op.from)) {
        return {
          ok: false,
          code: 'app.err.diff.invalid_path',
          message: `Diff from path not allowed: ${op.from}`,
          path: op.from,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Generate a JSON Patch from base → next (excluding page.version / page.etag churn
 * that is carried in DiffDocument metadata — we still allow version in patch if present).
 *
 * Array StateNode `.value` changes are coalesced into a single `replace` of the
 * array root (SPEC §19.3 #5 — "Diff replace array root") instead of per-index edits.
 */
export function generateDiff(
  base: PageManifest,
  next: PageManifest,
  options: DiffGenerateOptions = {},
): JsonPatchOp[] {
  // Compare full documents; filter forbidden paths afterwards
  const ops = compare(base as object, next as object) as JsonPatchOp[];
  const enforce = options.enforceAllowedPaths ?? true;

  const filtered: JsonPatchOp[] = [];
  for (const op of ops) {
    // Skip identity / concurrency fields — carried outside patch body per §7.2
    // (version → DiffDocument.result_version; etag is cache-only)
    if (op.path === '/page/etag' || op.path.startsWith('/page/etag/')) continue;
    if (op.path === '/page/version' || op.path.startsWith('/page/version/')) continue;
    if (op.path === '/page/id' || op.path === '/page/url') continue;
    if (op.path === '/app') continue;

    if (enforce && !isAllowedDiffPath(op.path)) {
      // Coalesce: if something forbidden changed that shouldn't, skip it
      // (servers should not emit identity changes via diff)
      continue;
    }
    filtered.push(op);
  }
  return coalesceArrayRootReplaces(filtered, base, next);
}

/**
 * When multiple patch ops target descendants of an array StateNode's `/value`,
 * emit one `replace` of that array root instead.
 */
function coalesceArrayRootReplaces(
  ops: JsonPatchOp[],
  base: PageManifest,
  next: PageManifest,
): JsonPatchOp[] {
  const arrayRoots = new Set<string>();
  for (const op of ops) {
    // Match .../value or .../value/N or .../value/N/...
    const m = /^(.*?\/value)(?:\/|$)/.exec(op.path);
    if (!m) continue;
    const valuePath = m[1]!;
    const baseArr = getAtPointer(base, valuePath);
    const nextArr = getAtPointer(next, valuePath);
    if (Array.isArray(baseArr) && Array.isArray(nextArr)) {
      arrayRoots.add(valuePath);
    }
  }

  if (arrayRoots.size === 0) return ops;

  const out: JsonPatchOp[] = [];
  for (const root of arrayRoots) {
    out.push({
      op: 'replace',
      path: root,
      value: getAtPointer(next, root),
    });
  }

  for (const op of ops) {
    let underRoot = false;
    for (const root of arrayRoots) {
      if (op.path === root || op.path.startsWith(`${root}/`)) {
        underRoot = true;
        break;
      }
    }
    if (!underRoot) out.push(op);
  }

  return out;
}

function getAtPointer(doc: unknown, pointer: string): unknown {
  if (!pointer || pointer === '/') return doc;
  const parts = pointer
    .split('/')
    .slice(1)
    .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur: unknown = doc;
  for (const part of parts) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Build a Diff Document from base and next manifests.
 */
export function buildDiffDocument(
  base: PageManifest,
  next: PageManifest,
  options: {
    navigation_effect?: DiffDocument['navigation_effect'];
    meta?: Record<string, unknown>;
    requestId?: string;
  } = {},
): DiffDocument {
  const diff = generateDiff(base, next);
  const doc: DiffDocument = {
    app: APP_VERSION,
    base: {
      page_id: base.page.id,
      page_url: base.page.url,
      version: base.page.version,
    },
    result_version: next.page.version,
    diff,
    navigation_effect: options.navigation_effect ?? null,
  };
  // C1/C2: Diffs carry only base.version / result_version — no base.etag / result_etag.
  if (options.meta || options.requestId) {
    doc.meta = {
      ...(options.meta ?? {}),
      ...(options.requestId ? { request_id: options.requestId } : {}),
    };
  }
  return doc;
}

export interface ApplyDiffResult {
  ok: true;
  manifest: PageManifest;
}

export interface ApplyDiffError {
  ok: false;
  code: string;
  message: string;
}

/**
 * Apply a Diff Document to a base manifest (client algorithm §7.6, also useful server-side).
 */
export function applyDiffDocument(
  manifest: PageManifest,
  diffDoc: DiffDocument,
): ApplyDiffResult | ApplyDiffError {
  if (manifest.page.version !== diffDoc.base.version) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest version does not match diff base.version',
    };
  }

  const pathCheck = validateDiffOps(diffDoc.diff);
  if (!pathCheck.ok) {
    return { ok: false, code: pathCheck.code, message: pathCheck.message };
  }

  const working = structuredClone(manifest) as PageManifest;
  try {
    const result = applyPatch(working as object, diffDoc.diff as Operation[], true, false);
    const patched = result.newDocument as PageManifest;
    patched.page.version = diffDoc.result_version;
    return { ok: true, manifest: patched };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Patch apply failed';
    if (msg.toLowerCase().includes('test')) {
      return { ok: false, code: 'app.err.diff.test_failed', message: msg };
    }
    return { ok: false, code: 'app.err.diff.apply_failed', message: msg };
  }
}

/** Rough byte size heuristic for §7.5 compaction. */
export function shouldPreferFullManifest(
  fullManifest: PageManifest,
  diffDoc: DiffDocument,
  threshold = 0.5,
  minFullBytes = 2048,
): boolean {
  const fullSize = Buffer.byteLength(JSON.stringify(fullManifest), 'utf8');
  if (fullSize < minFullBytes) return false;
  const diffSize = Buffer.byteLength(JSON.stringify(diffDoc), 'utf8');
  return diffSize > fullSize * threshold;
}
