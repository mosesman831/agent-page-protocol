/**
 * Loopback host detection (C17).
 * Loopback = localhost + 127.0.0.0/8 + [::1]
 */

/** True if hostname is a loopback literal per APP v0.4 C17. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  if (host === 'localhost') return true;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  // IPv4-mapped IPv6 ::ffff:127.x.x.x
  const v4Mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(host);
  if (v4Mapped) return isLoopbackIpv4(v4Mapped[1]!);
  return isLoopbackIpv4(host);
}

function isLoopbackIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  // 127.0.0.0/8 — any 127.x.x.x
  return a === 127;
}

/** True if URL is http(s) on a loopback host (HTTP allowed only on loopback). */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return isLoopbackHost(u.hostname);
  } catch {
    return false;
  }
}

/** HTTPS required except loopback HTTP. */
export function isAllowedAppUrlScheme(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return isLoopbackHost(u.hostname);
    return false;
  } catch {
    return false;
  }
}
