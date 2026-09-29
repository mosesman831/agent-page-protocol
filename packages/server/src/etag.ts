/**
 * ETag helpers for HTTP cache revalidation only (§11.2).
 * Must NOT be used for optimistic concurrency — that is page.version.
 */

import { createHash } from 'node:crypto';

/** Build a strong ETag from an opaque token (quoted). */
export function strongEtag(token: string): string {
  const cleaned = token.replace(/"/g, '');
  return `"${cleaned}"`;
}

/** Build a weak ETag. */
export function weakEtag(token: string): string {
  const cleaned = token.replace(/"/g, '');
  return `W/"${cleaned}"`;
}

/** Hash arbitrary content into a strong ETag. */
export function etagFromContent(content: string | Buffer | object): string {
  const buf =
    typeof content === 'string'
      ? Buffer.from(content, 'utf8')
      : Buffer.isBuffer(content)
        ? content
        : Buffer.from(JSON.stringify(content), 'utf8');
  const hash = createHash('sha256').update(buf).digest('base64url').slice(0, 22);
  return strongEtag(hash);
}

/**
 * Parse If-None-Match into a list of tags (without W/ prefix normalized for compare).
 */
export function parseIfNoneMatch(header: string | undefined | null): string[] {
  if (!header || header.trim() === '') return [];
  if (header.trim() === '*') return ['*'];
  return header
    .split(',')
    .map((p) => normalizeEtag(p.trim()))
    .filter(Boolean);
}

export function normalizeEtag(tag: string): string {
  const t = tag.trim();
  if (t.startsWith('W/')) {
    return t.slice(2).trim().replace(/^"|"$/g, '');
  }
  return t.replace(/^"|"$/g, '');
}

/**
 * Returns true if current ETag matches any in If-None-Match → 304.
 */
export function etagMatches(
  currentEtag: string | undefined | null,
  ifNoneMatch: string | undefined | null,
): boolean {
  if (!currentEtag) return false;
  const tags = parseIfNoneMatch(ifNoneMatch);
  if (tags.length === 0) return false;
  if (tags.includes('*')) return true;
  const current = normalizeEtag(currentEtag);
  return tags.some((t) => t === current);
}

/** Pick ETag from manifest.page.etag or derive from content. */
export function resolveManifestEtag(
  manifest: { page: { etag?: string } },
  deriveIfMissing = true,
): string | undefined {
  if (manifest.page.etag) return manifest.page.etag;
  if (deriveIfMissing) return etagFromContent(manifest);
  return undefined;
}
