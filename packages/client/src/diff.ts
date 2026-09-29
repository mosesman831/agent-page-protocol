/**
 * Diff application — RFC 6902 subset, atomic apply (SPEC v0.4-Ultimate §7).
 */

import jsonpatch from 'fast-json-patch';
import type { Operation } from 'fast-json-patch';

const applyPatch = jsonpatch.applyPatch;
import { AppError } from './errors.js';
import {
  checkActions,
  checkRootMembers,
  checkStateKeys,
  checkStateNodes,
  normalizePagination,
} from './hydrate.js';
import { normalizeAppUrl } from './navigate.js';
import type {
  DiffDocument,
  JsonPatchOp,
  NavigationEffect,
  PageManifest,
  StateNode,
} from './types.js';

/** Forbidden identity/concurrency paths (§7.2). */
const FORBIDDEN_EXACT = new Set(['/app', '/page/id', '/page/url', '/page/etag', '/page/version']);

const FORBIDDEN_PREFIXES = ['/app/', '/page/id/', '/page/url/', '/page/etag/', '/page/version/'];

const ALLOWED_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

const ALLOWED_ROOT_PREFIXES = ['/state', '/actions', '/navigation', '/present', '/error', '/meta'];

const ALLOWED_PAGE_FIELDS = new Set([
  '/page/title',
  '/page/description',
  '/page/language',
  '/page/generated_at',
]);

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerTokens(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) return [];
  return path.slice(1).split('/').map(decodePointerToken);
}

/**
 * Table cell-level patches forbidden — whole-node only (TV-35).
 * Paths like `/state/results/value/3/2` are invalid when target is a table.
 */
export function isTableCellPath(manifest: PageManifest, path: string): boolean {
  const tokens = pointerTokens(path);
  if (tokens[0] !== 'state' || tokens.length < 4) return false;
  const key = tokens[1]!;
  const node = manifest.state?.[key] as StateNode | undefined;
  if (!node || node.type !== 'table') return false;
  // Anything under /state/<key>/value/<…> is cell/row addressing
  return tokens[2] === 'value' && tokens.length >= 4;
}

export function isAllowedDiffPath(path: string, manifest?: PageManifest): boolean {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  if (FORBIDDEN_EXACT.has(path)) return false;
  for (const p of FORBIDDEN_PREFIXES) {
    if (path.startsWith(p)) return false;
  }
  if (ALLOWED_PAGE_FIELDS.has(path)) return true;
  for (const field of ALLOWED_PAGE_FIELDS) {
    if (path.startsWith(`${field}/`)) return true;
  }
  const allowed = ALLOWED_ROOT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!allowed) return false;
  if (manifest && isTableCellPath(manifest, path)) return false;
  return true;
}

export function validateDiffOps(
  ops: JsonPatchOp[],
  manifest?: PageManifest,
): { ok: true } | { ok: false; code: string; message: string; path?: string } {
  for (const op of ops) {
    if (!ALLOWED_OPS.has(op.op)) {
      return {
        ok: false,
        code: 'app.err.diff.unsupported_op',
        message: `Unsupported patch op: ${op.op}`,
      };
    }
    if (!isAllowedDiffPath(op.path, manifest)) {
      return {
        ok: false,
        code: 'app.err.diff.invalid_path',
        message: `Diff path not allowed: ${op.path}`,
        path: op.path,
      };
    }
    if ((op.op === 'move' || op.op === 'copy') && 'from' in op) {
      if (!isAllowedDiffPath(op.from, manifest)) {
        return {
          ok: false,
          code: 'app.err.diff.invalid_path',
          message: `Diff from path not allowed: ${op.from}`,
          path: op.from,
        };
      }
      // move: from MUST NOT be a proper prefix of path (§7.1)
      if (op.op === 'move' && op.path.startsWith(`${op.from}/`)) {
        return {
          ok: false,
          code: 'app.err.diff.apply_failed',
          message: `move from must not be a prefix of path: ${op.from} → ${op.path}`,
          path: op.path,
        };
      }
    }
  }
  return { ok: true };
}

function isAppVersion(value: unknown): value is '1.0' | '1.1' {
  return value === '1.0' || value === '1.1';
}

export function isDiffDocument(value: unknown): value is DiffDocument {
  if (!value || typeof value !== 'object') return false;
  const d = value as DiffDocument;
  return (
    isAppVersion(d.app) &&
    !!d.base &&
    typeof d.base.page_id === 'string' &&
    typeof d.base.page_url === 'string' &&
    typeof d.base.version === 'string' &&
    typeof d.result_version === 'string' &&
    Array.isArray(d.diff)
  );
}

export function isPageManifest(value: unknown): value is PageManifest {
  if (!value || typeof value !== 'object') return false;
  const m = value as PageManifest;
  return (
    isAppVersion(m.app) &&
    !!m.page &&
    typeof m.page.id === 'string' &&
    typeof m.page.url === 'string' &&
    typeof m.page.version === 'string' &&
    !!m.state &&
    typeof m.state === 'object' &&
    !Array.isArray(m.state)
  );
}

export interface ApplyDiffSuccess {
  ok: true;
  manifest: PageManifest;
  navigation_effect: NavigationEffect | null;
  changedPaths: string[];
}

export interface ApplyDiffFailure {
  ok: false;
  code: string;
  message: string;
}

export type ApplyDiffResult = ApplyDiffSuccess | ApplyDiffFailure;

function urlsEqual(a: string, b: string): boolean {
  try {
    return normalizeAppUrl(a) === normalizeAppUrl(b);
  } catch {
    return a === b;
  }
}

/**
 * Apply Diff Document to base manifest (§7.3). Atomic — rolls back on any failure.
 * Empty diff MAY keep the same version (TV-36). Non-empty should bump (server duty).
 */
export function applyDiffDocument(manifest: PageManifest, diffDoc: DiffDocument): ApplyDiffResult {
  if (manifest.page.id !== diffDoc.base.page_id) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest page.id does not match diff base.page_id',
    };
  }

  if (!urlsEqual(manifest.page.url, diffDoc.base.page_url)) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest page.url does not match diff base.page_url',
    };
  }

  if (manifest.page.version !== diffDoc.base.version) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest version does not match diff base.version',
    };
  }

  // Empty-diff no-op: MAY keep same version (TV-36)
  if (diffDoc.diff.length === 0) {
    const next = structuredClone(manifest) as PageManifest;
    next.page.version = diffDoc.result_version;
    return {
      ok: true,
      manifest: next,
      navigation_effect: diffDoc.navigation_effect ?? null,
      changedPaths: [],
    };
  }

  const pathCheck = validateDiffOps(diffDoc.diff, manifest);
  if (!pathCheck.ok) {
    return { ok: false, code: pathCheck.code, message: pathCheck.message };
  }

  // Deep clone — original untouched on failure (TV-32, TV-33)
  const working = structuredClone(manifest) as PageManifest;
  try {
    // validateOperation=true → test failures & missing targets throw
    applyPatch(working as object, diffDoc.diff as Operation[], /*validate*/ true, /*mutate*/ true);

    // Re-check table cell paths against post-patch state for any mid-apply type changes
    for (const op of diffDoc.diff) {
      if (isTableCellPath(working, op.path)) {
        return {
          ok: false,
          code: 'app.err.diff.invalid_path',
          message: `Table cell-level patch forbidden: ${op.path}`,
        };
      }
    }

    if (
      !working.page?.id ||
      !working.page?.url ||
      !working.state ||
      typeof working.state !== 'object'
    ) {
      return {
        ok: false,
        code: 'app.err.manifest.invalid',
        message: 'Patched document is not a valid Page Manifest',
      };
    }

    // Post-apply validation (§7.3): the patched manifest must still be a
    // conformant manifest — a diff that produces unknown node types or
    // forbidden keys is rejected, not adopted. This client is strict
    // (§5.3): closed member sets apply unconditionally, as on receipt.
    try {
      checkRootMembers(working as unknown as Record<string, unknown>);
      checkStateKeys(working.state);
      for (const [k, node] of Object.entries(working.state)) {
        checkStateNodes(node, `/state/${k}`, true);
      }
      // Actions block — the same lenient contract the extension enforces on
      // receipt/post-apply (object map ≤128, key grammar, kind/side_effect
      // vocabulary).
      checkActions((working as { actions?: unknown }).actions);
      // Same normalization receivers apply on receipt: contradictory
      // pagination collapses to has_more:false with a warning (TV-04).
      normalizePagination(working);
    } catch (e) {
      if (e instanceof AppError) {
        return { ok: false, code: e.code, message: e.message };
      }
      return {
        ok: false,
        code: 'app.err.manifest.invalid',
        message: 'Patched document is not a valid Page Manifest',
      };
    }

    // Apply result_version only after ALL ops succeed (§7.3)
    working.page.version = diffDoc.result_version;

    return {
      ok: true,
      manifest: working,
      navigation_effect: diffDoc.navigation_effect ?? null,
      changedPaths: diffDoc.diff.map((o) => o.path),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Patch apply failed';
    const lower = msg.toLowerCase();
    if (
      lower.includes('test') ||
      lower.includes('not equal') ||
      (err as { name?: string })?.name === 'TEST_OPERATION_FAILED'
    ) {
      return { ok: false, code: 'app.err.diff.test_failed', message: msg };
    }
    return { ok: false, code: 'app.err.diff.apply_failed', message: msg };
  }
}

/** Throwing wrapper used by AgentClient.applyDiff. */
export function applyDiff(manifest: PageManifest, diffDoc: DiffDocument): PageManifest {
  const result = applyDiffDocument(manifest, diffDoc);
  if (!result.ok) {
    throw new AppError(result.code, { message: result.message });
  }
  return result.manifest;
}
