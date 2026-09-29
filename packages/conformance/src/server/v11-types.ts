/**
 * 1.1 wire helpers local to the conformance harness (published @agent-page/server is 1.0).
 */

export const MEDIA_EVENT_STREAM = 'text/event-stream';
export const HEADER_APP_CHALLENGE = 'X-APP-Challenge';
export const HEADER_APP_HOLD_TOKEN = 'X-APP-Hold-Token';
export const HEADER_APP_RESUME = 'X-APP-Resume';
export const HEADER_SET_APP_RESUME = 'Set-APP-Resume';
export const HEADER_APP_ACCESS_TOKEN = 'X-APP-Access-Token';
export const HEADER_APP_REFRESH_TOKEN = 'X-APP-Refresh-Token';
export const HEADER_APP_ACCESS_TOKEN_TTL = 'X-APP-Access-Token-TTL';

export type WireVersion = '1.0' | '1.1';

export function parseAcceptVersions(header: string | undefined | null): string[] | null {
  if (header == null || header.trim() === '') return null;
  return header
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function selectProtocolVersion(options: {
  acceptVersions?: string | null;
  xAppVersion?: string | null;
  supported?: readonly string[];
}): { selected: WireVersion; offered: string[]; highestOffered: string | null; none: boolean } {
  const supported = options.supported ?? ['1.0', '1.1'];
  const parsed = parseAcceptVersions(options.acceptVersions);
  let offered: string[];
  if (parsed && parsed.length > 0) offered = parsed;
  else if (options.xAppVersion && options.xAppVersion.trim() !== '')
    offered = [options.xAppVersion.trim()];
  else offered = ['1.0'];
  const mutual = offered.filter((v) => supported.includes(v));
  const highestOffered = offered.reduce<string | null>((best, v) => {
    if (!best) return v;
    return compareVer(v, best) > 0 ? v : best;
  }, null);
  if (mutual.length === 0) {
    return { selected: '1.0', offered, highestOffered, none: true };
  }
  const selectedRaw = mutual.reduce((best, v) => (compareVer(v, best) > 0 ? v : best));
  const selected: WireVersion = selectedRaw === '1.1' ? '1.1' : '1.0';
  return { selected, offered, highestOffered, none: false };
}

function compareVer(a: string, b: string): number {
  const [am, ai] = a.split('.').map(Number);
  const [bm, bi] = b.split('.').map(Number);
  if ((am ?? 0) !== (bm ?? 0)) return (am ?? 0) - (bm ?? 0);
  return (ai ?? 0) - (bi ?? 0);
}

export function negotiateV11(
  acceptHeader: string | undefined | null,
  options: {
    acceptVersions?: string | null;
    xAppVersion?: string | null;
    supported: readonly string[];
  },
): {
  versionMismatch: boolean;
  versionUnsupported: boolean;
  highestOffered: string | null;
  selected: WireVersion | null;
} {
  const selection = selectProtocolVersion({
    acceptVersions: options.acceptVersions,
    xAppVersion: options.xAppVersion,
    supported: options.supported,
  });
  const vParams: string[] = [];
  for (const part of (acceptHeader ?? '').split(',')) {
    const m = /;\s*v\s*=\s*"?([^";]+)"?/i.exec(part);
    if (m?.[1]) vParams.push(m[1].trim());
  }
  const vNamesUnsupported = vParams.some((v) => !options.supported.includes(v));
  if (selection.none) {
    return {
      versionMismatch: vNamesUnsupported,
      versionUnsupported: !vNamesUnsupported,
      highestOffered: selection.highestOffered,
      selected: null,
    };
  }
  return {
    versionMismatch: false,
    versionUnsupported: false,
    highestOffered: selection.highestOffered,
    selected: selection.selected,
  };
}
