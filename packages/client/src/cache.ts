/**
 * ManifestCache — URL → {manifest, etag, version, fetchedAt} (SPEC §15.2).
 */

import { extractOrigin, normalizeAppUrl } from './navigate.js';
import type { PageManifest } from './types.js';

export interface CacheEntry {
  manifest: PageManifest;
  etag?: string;
  version: string;
  fetchedAt: number;
  /** Freshness TTL in ms. 0 = always revalidate. */
  ttlMs: number;
  /** True when Cache-Control implies private / user-specific. */
  private: boolean;
  cacheControl?: string;
  /** Session epoch partition for private entries (§13.3). */
  sessionEpoch?: number;
  origin?: string;
}

export interface ManifestCacheOptions {
  /** Default TTL for public pages when Cache-Control absent (§15.2: 60s). */
  defaultPublicTtlMs?: number;
  /** Well-known default TTL (§15.2: 300s). */
  wellKnownTtlMs?: number;
  now?: () => number;
}

function parseMaxAge(cacheControl: string | undefined | null): number | null {
  if (!cacheControl) return null;
  const m = /(?:^|,\s*)max-age=(\d+)/i.exec(cacheControl);
  if (!m) return null;
  return Number(m[1]) * 1000;
}

function isPrivateDirective(cacheControl: string | undefined | null): boolean {
  if (!cacheControl) return false;
  return /(?:^|,\s*)private\b/i.test(cacheControl) || /(?:^|,\s*)no-store\b/i.test(cacheControl);
}

function readSessionEpoch(manifest: PageManifest): number | undefined {
  const v = manifest.meta?.session_epoch;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function originOf(url: string): string | undefined {
  try {
    return extractOrigin(url);
  } catch {
    return undefined;
  }
}

export class ManifestCache {
  private readonly map = new Map<string, CacheEntry>();
  private readonly defaultPublicTtlMs: number;
  private readonly wellKnownTtlMs: number;
  private readonly now: () => number;
  private readonly epochByOrigin = new Map<string, number>();

  constructor(options: ManifestCacheOptions = {}) {
    this.defaultPublicTtlMs = options.defaultPublicTtlMs ?? 60_000;
    this.wellKnownTtlMs = options.wellKnownTtlMs ?? 300_000;
    this.now = options.now ?? (() => Date.now());
  }

  setSessionEpoch(origin: string, epoch: number): void {
    const prev = this.epochByOrigin.get(origin);
    this.epochByOrigin.set(origin, epoch);
    if (prev !== undefined && prev !== epoch) {
      this.invalidatePrivate(origin);
    }
  }

  getSessionEpoch(origin: string): number {
    return this.epochByOrigin.get(origin) ?? 0;
  }

  private storageKey(url: string, isPrivate: boolean): string {
    const norm = this.normalizeUrl(url);
    if (!isPrivate) return norm;
    const origin = originOf(norm);
    const epoch = origin ? (this.epochByOrigin.get(origin) ?? 0) : 0;
    return `${norm}#session_epoch=${epoch}`;
  }

  normalizeUrl(url: string): string {
    try {
      return normalizeAppUrl(url);
    } catch {
      try {
        const u = new URL(url);
        u.hash = '';
        return u.href;
      } catch {
        return url;
      }
    }
  }

  get(url: string): CacheEntry | undefined {
    const priv = this.map.get(this.storageKey(url, true));
    if (priv) return priv;
    return this.map.get(this.normalizeUrl(url));
  }

  stillFresh(entry: CacheEntry, at = this.now()): boolean {
    if (entry.ttlMs <= 0) return false;
    return at - entry.fetchedAt < entry.ttlMs;
  }

  set(
    url: string,
    manifest: PageManifest,
    options: {
      etag?: string;
      cacheControl?: string;
      private?: boolean;
      ttlMs?: number;
      fetchedAt?: number;
      sessionEpoch?: number;
    } = {},
  ): CacheEntry {
    const norm = this.normalizeUrl(url);
    const cacheControl = options.cacheControl;
    const isPrivate = options.private ?? isPrivateDirective(cacheControl);
    const origin = originOf(norm);
    const epochFromManifest = readSessionEpoch(manifest);
    const epoch =
      options.sessionEpoch ??
      epochFromManifest ??
      (origin ? this.epochByOrigin.get(origin) : undefined);
    if (origin && epoch !== undefined) this.epochByOrigin.set(origin, epoch);
    let ttlMs = options.ttlMs;
    if (ttlMs === undefined) {
      if (isPrivate) {
        ttlMs = 0;
      } else {
        const maxAge = parseMaxAge(cacheControl);
        if (maxAge !== null) ttlMs = maxAge;
        else if (norm.includes('/.well-known/')) ttlMs = this.wellKnownTtlMs;
        else ttlMs = this.defaultPublicTtlMs;
      }
    }
    const key = isPrivate ? this.storageKey(url, true) : norm;
    const entry: CacheEntry = {
      manifest,
      etag: options.etag ?? manifest.page.etag,
      version: manifest.page.version,
      fetchedAt: options.fetchedAt ?? this.now(),
      ttlMs,
      private: isPrivate,
      cacheControl,
      sessionEpoch: epoch,
      origin,
    };
    this.map.set(key, entry);
    return entry;
  }

  /** Update fetchedAt without changing body (304 touch). */
  touch(url: string): CacheEntry | undefined {
    const entry = this.get(url);
    if (!entry) return undefined;
    entry.fetchedAt = this.now();
    this.map.set(this.storageKey(url, entry.private), entry);
    return entry;
  }

  invalidate(url: string): void {
    this.map.delete(this.normalizeUrl(url));
  }

  /** Invalidate all private entries (auth change / logout). Optional origin scope. */
  invalidatePrivate(origin?: string): void {
    for (const [k, v] of this.map) {
      if (!v.private) continue;
      if (origin && v.origin && v.origin !== origin) continue;
      if (origin && !v.origin && originOf(k.split('#session_epoch=')[0] ?? k) !== origin) continue;
      this.map.delete(k);
    }
  }

  /** Purge private cache for an origin after logout (§4.5 / TV-69). */
  purgeOnLogout(origin: string): void {
    this.invalidatePrivate(origin);
    const next = (this.epochByOrigin.get(origin) ?? 0) + 1;
    this.epochByOrigin.set(origin, next);
  }

  clear(): void {
    this.map.clear();
  }

  size(): number {
    return this.map.size;
  }

  /** Hydrate from disk-friendly plain entries (public only — caller must filter). */
  loadEntries(entries: Array<{ url: string; entry: CacheEntry }>): void {
    for (const { url, entry } of entries) {
      if (entry.private) continue;
      this.map.set(this.normalizeUrl(url), entry);
    }
  }

  dumpPublicEntries(): Array<{ url: string; entry: CacheEntry }> {
    const out: Array<{ url: string; entry: CacheEntry }> = [];
    for (const [url, entry] of this.map) {
      if (!entry.private && this.stillFresh(entry)) {
        out.push({ url, entry: structuredClone(entry) });
      }
    }
    return out;
  }
}
