/**
 * Accept negotiation per SPEC §3.7 (v=1.0 media params, X-APP-Accept-Versions).
 */

import {
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ERROR,
  MEDIA_ACTION,
  APP_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  compareProtocolVersions,
  isSupportedProtocolVersion,
  isAppSuccessMediaType,
  parseMediaType,
} from './media-types.js';
import type { AppProtocolVersion } from './types.js';

export interface MediaRange {
  type: string; // e.g. application/vnd.agent-page+json or application/*
  q: number;
  /** Optional APP protocol version from media param `v`. */
  v?: string;
  raw: string;
}

export interface NegotiationResult {
  acceptable: boolean;
  preferDiff: boolean;
  preferFull: boolean;
  acceptError: boolean;
  acceptHtml: boolean;
  /** True when Accept was malformed. */
  badAccept?: boolean;
  /**
   * True when media v= names an unsupported version AND no mutual version exists.
   * Maps to 400 app.err.version.version_mismatch (K3 MF-3).
   */
  versionMismatch?: boolean;
  /**
   * True when Accept-Versions has no mutual version (and v= is not the sole cause).
   * Maps to 406 app.err.version.unsupported (K3 MF-3).
   */
  versionUnsupported?: boolean;
  /** Selected protocol version when negotiation succeeds. */
  selectedVersion?: AppProtocolVersion;
  /** Highest version the client offered (K3 MF-2). */
  highestOffered?: string | null;
  selected?: typeof MEDIA_PAGE | typeof MEDIA_DIFF | 'text/html' | null;
}

export interface VersionSelection {
  selected: AppProtocolVersion;
  offered: string[];
  highestOffered: string | null;
  none: boolean;
}

/**
 * Select protocol version per SPEC §2.2. Accept-Versions is evaluated BEFORE media v=.
 */
export function selectProtocolVersion(options: {
  acceptVersions?: string | null;
  xAppVersion?: string | null;
  supported?: readonly string[];
}): VersionSelection {
  const supported = options.supported ?? SUPPORTED_PROTOCOL_VERSIONS;
  const parsed = parseAcceptVersions(options.acceptVersions);
  let offered: string[];
  if (parsed && parsed.length > 0) {
    offered = parsed;
  } else if (options.xAppVersion && options.xAppVersion.trim() !== '') {
    offered = [options.xAppVersion.trim()];
  } else {
    offered = [APP_VERSION];
  }
  const mutual = offered.filter((v) => supported.includes(v));
  const highestOffered = offered.reduce<string | null>((best, v) => {
    if (!best) return v;
    return compareProtocolVersions(v, best) > 0 ? v : best;
  }, null);
  if (mutual.length === 0) {
    return { selected: APP_VERSION, offered, highestOffered, none: true };
  }
  const selectedRaw = mutual.reduce((best, v) => (compareProtocolVersions(v, best) > 0 ? v : best));
  const selected: AppProtocolVersion = isSupportedProtocolVersion(selectedRaw)
    ? selectedRaw
    : APP_VERSION;
  return { selected, offered, highestOffered, none: false };
}

function parseQ(params: string[]): number {
  for (const p of params) {
    const m = /^\s*q\s*=\s*([0-9]*\.?[0-9]+)\s*$/i.exec(p);
    if (m) {
      const q = Number(m[1]);
      if (!Number.isFinite(q) || q < 0 || q > 1) return NaN;
      // RFC 9110: ≤ 3 fractional digits
      const frac = (m[1]!.split('.')[1] ?? '').length;
      if (frac > 3) return NaN;
      return q;
    }
  }
  return 1;
}

function parseV(params: string[]): string | undefined {
  for (const p of params) {
    const m = /^\s*v\s*=\s*"?([^";]+)"?\s*$/i.exec(p);
    if (m) return m[1]!.trim();
  }
  return undefined;
}

export function parseAcceptHeader(accept: string | undefined | null): MediaRange[] | null {
  if (accept === undefined || accept === null || accept.trim() === '') {
    // No Accept → treat as */*
    return [{ type: '*/*', q: 1, raw: '*/*' }];
  }
  const parts = accept.split(',');
  const ranges: MediaRange[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const segments = trimmed.split(';');
    const type = segments[0]?.trim().toLowerCase();
    if (!type) return null;
    const params = segments.slice(1);
    const q = parseQ(params);
    if (Number.isNaN(q)) return null;
    if (q === 0) continue;
    const v = parseV(params);
    ranges.push({ type, q, v, raw: trimmed });
  }
  ranges.sort((a, b) => b.q - a.q);
  return ranges;
}

function matches(rangeType: string, concrete: string): boolean {
  if (rangeType === '*/*') return true;
  if (rangeType.endsWith('/*')) {
    const prefix = rangeType.slice(0, -1); // "application/"
    return concrete.startsWith(prefix);
  }
  return rangeType === concrete;
}

function qFor(ranges: MediaRange[], concrete: string): number {
  let best = 0;
  for (const r of ranges) {
    if (matches(r.type, concrete) && r.q > best) best = r.q;
  }
  return best;
}

/**
 * Parse X-APP-Accept-Versions: space/comma-separated list like "1.0" or "1.0, 1.1".
 */
export function parseAcceptVersions(header: string | undefined | null): string[] | null {
  if (header === undefined || header === null || header.trim() === '') return null;
  return header
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Normative negotiation algorithm (§3.7).
 */
export function negotiate(
  acceptHeader: string | undefined | null,
  options: {
    method: 'GET' | 'POST' | string;
    canProduceDiff?: boolean;
    wantsDiff?: boolean;
    /** X-APP-Accept-Versions header value. */
    acceptVersions?: string | null;
    /** X-APP-Version request header (used only if Accept-Versions is absent). */
    xAppVersion?: string | null;
    /**
     * Legacy single-version hint. Ignored when `supportedVersions` is set.
     * Default supported set is 1.0 and 1.1.
     */
    protocolVersion?: string;
    /** Versions this server implements. Default SUPPORTED_PROTOCOL_VERSIONS. */
    supportedVersions?: readonly string[];
  },
): NegotiationResult {
  const supported =
    options.supportedVersions ??
    (options.protocolVersion && !options.supportedVersions
      ? SUPPORTED_PROTOCOL_VERSIONS
      : SUPPORTED_PROTOCOL_VERSIONS);
  const ranges = parseAcceptHeader(acceptHeader);
  if (ranges === null) {
    return {
      acceptable: false,
      preferDiff: false,
      preferFull: false,
      acceptError: false,
      acceptHtml: false,
      badAccept: true,
      selected: null,
    };
  }

  // K3 MF-3: evaluate X-APP-Accept-Versions BEFORE any media v= mismatch.
  const selection = selectProtocolVersion({
    acceptVersions: options.acceptVersions,
    xAppVersion: options.xAppVersion,
    supported,
  });

  const vParams = ranges
    .filter((r) => r.v !== undefined && isAppMediaRange(r.type))
    .map((r) => r.v as string);
  const vNamesUnsupported = vParams.some((v) => !supported.includes(v));

  if (selection.none) {
    return {
      acceptable: false,
      preferDiff: false,
      preferFull: false,
      acceptError: false,
      acceptHtml: false,
      versionMismatch: vNamesUnsupported,
      versionUnsupported: !vNamesUnsupported,
      highestOffered: selection.highestOffered,
      selected: null,
    };
  }

  // Mutual version exists: IGNORE v= params that name a higher unsupported version.

  const qPage = qFor(ranges, MEDIA_PAGE);
  const qDiff = qFor(ranges, MEDIA_DIFF);
  const qError = qFor(ranges, MEDIA_ERROR);
  const qHtml = qFor(ranges, 'text/html');

  const anyAppSuccess = qPage > 0 || qDiff > 0;
  const result: NegotiationResult = {
    acceptable: false,
    preferDiff: qDiff > qPage,
    preferFull: qPage > 0,
    acceptError: qError > 0,
    acceptHtml: qHtml > 0,
    selectedVersion: selection.selected,
    highestOffered: selection.highestOffered,
    selected: null,
  };

  if (anyAppSuccess) {
    result.acceptable = true;
    if (options.method.toUpperCase() === 'GET') {
      result.selected = MEDIA_PAGE;
      return result;
    }
    // POST action
    const wantsDiff = options.wantsDiff ?? false;
    const canDiff = options.canProduceDiff ?? true;
    if (wantsDiff && qDiff > 0 && canDiff) {
      result.selected = MEDIA_DIFF;
      return result;
    }
    if (qPage > 0) {
      result.selected = MEDIA_PAGE;
      return result;
    }
    if (qDiff > 0 && !canDiff) {
      result.acceptable = false;
      result.selected = null;
      return result;
    }
    if (qDiff > 0) {
      result.selected = MEDIA_DIFF;
      return result;
    }
  }

  if (qHtml > 0) {
    result.acceptable = true;
    result.selected = 'text/html';
    return result;
  }

  return result;
}

function isAppMediaRange(type: string): boolean {
  return (
    type === MEDIA_PAGE ||
    type === MEDIA_DIFF ||
    type === MEDIA_ERROR ||
    type === MEDIA_ACTION ||
    type.startsWith('application/vnd.agent-page')
  );
}

export function contentTypeMatches(header: string | undefined | null, expected: string): boolean {
  return parseMediaType(header) === expected;
}

export function acceptsApp(acceptHeader: string | undefined | null): boolean {
  const ranges = parseAcceptHeader(acceptHeader);
  if (!ranges) return false;
  return ranges.some((r) => {
    if (r.type === '*/*' || r.type === 'application/*') return true;
    const concrete = r.type.includes('/') ? r.type : '';
    return isAppSuccessMediaType(concrete) || concrete === MEDIA_ERROR;
  });
}
