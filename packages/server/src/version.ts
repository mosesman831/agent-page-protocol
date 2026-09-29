/**
 * page.version + X-APP-If-Match-Version helpers (§6.6, §7.4, C1).
 * `page.version` is the sole concurrency token — root page_version removed.
 */

export type VersionCheckFailureReason = 'missing' | 'mismatch';

export interface VersionCheckResult {
  ok: boolean;
  conflict: boolean;
  /** True when header was absent (allowed unless requiresMatch). */
  skipped: boolean;
  /** Set when ok=false: missing header under requiresMatch, or version mismatch. */
  reason?: VersionCheckFailureReason;
  clientVersion?: string;
  serverVersion: string;
}

/**
 * Check optimistic concurrency via X-APP-If-Match-Version vs page.version.
 * - Mismatch → 409 app.err.diff.conflict
 * - Missing when requiresMatch → 428 app.err.action.version_required
 */
export function checkIfMatchVersion(
  serverVersion: string,
  clientVersion: string | undefined | null,
  options: { requiresMatch?: boolean } = {},
): VersionCheckResult {
  if (!clientVersion || clientVersion.trim() === '') {
    if (options.requiresMatch) {
      return {
        ok: false,
        conflict: false,
        skipped: false,
        reason: 'missing',
        serverVersion,
      };
    }
    return {
      ok: true,
      conflict: false,
      skipped: true,
      serverVersion,
    };
  }
  const cv = clientVersion.trim();
  if (cv !== serverVersion) {
    return {
      ok: false,
      conflict: true,
      skipped: false,
      reason: 'mismatch',
      clientVersion: cv,
      serverVersion,
    };
  }
  return {
    ok: true,
    conflict: false,
    skipped: false,
    clientVersion: cv,
    serverVersion,
  };
}

/** Simple monotonic version bump: vN → v(N+1), or append timestamp. */
export function bumpVersion(current: string): string {
  const m = /^v(\d+)$/i.exec(current.trim());
  if (m) {
    return `v${Number(m[1]) + 1}`;
  }
  return `v${Date.now()}`;
}

/** Sole concurrency token is page.version (C1). */
export function getPageVersion(manifest: { page: { version: string } }): string {
  return manifest.page.version || '';
}
