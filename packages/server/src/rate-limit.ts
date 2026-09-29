/**
 * RFC 9333 RateLimit headers + legacy X-RateLimit-* trio (§10.6).
 */

export interface RateLimitInfo {
  /** Policy name for the modern RateLimit header (default "default"). */
  policy?: string;
  limit: number;
  remaining: number;
  /**
   * Seconds until the window resets (delta-seconds for modern `RateLimit` reset=).
   */
  resetDeltaSeconds: number;
  /**
   * Epoch seconds for legacy X-RateLimit-Reset. Defaults to now + resetDeltaSeconds.
   */
  resetEpochSeconds?: number;
}

export interface RateLimitHeaders {
  RateLimit: string;
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
}

/**
 * Build RFC 9333 `RateLimit` + legacy trio headers.
 * Modern: `RateLimit: default;limit=60;remaining=42;reset=28` (reset = delta-seconds)
 * Legacy: X-RateLimit-Reset = epoch seconds
 */
export function buildRateLimitHeaders(info: RateLimitInfo): RateLimitHeaders {
  const policy = info.policy ?? 'default';
  const resetDelta = Math.max(0, Math.floor(info.resetDeltaSeconds));
  const resetEpoch = info.resetEpochSeconds ?? Math.floor(Date.now() / 1000) + resetDelta;
  return {
    RateLimit: `${policy};limit=${info.limit};remaining=${info.remaining};reset=${resetDelta}`,
    'X-RateLimit-Limit': String(info.limit),
    'X-RateLimit-Remaining': String(info.remaining),
    'X-RateLimit-Reset': String(resetEpoch),
  };
}

/** Apply rate-limit headers onto a header-setter (Express Response-compatible). */
export function setRateLimitHeaders(
  setHeader: (name: string, value: string) => void,
  info: RateLimitInfo,
): void {
  const headers = buildRateLimitHeaders(info);
  for (const [name, value] of Object.entries(headers)) {
    setHeader(name, value);
  }
}

export interface BucketConsumeResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  limit: number;
  policy: string;
}

/** In-memory sliding window for hold / OTP buckets (SPEC §6.4, §7.6). */
export class MemoryRateBucket {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly policy = 'default',
  ) {}

  consume(key: string, now = Date.now()): BucketConsumeResult {
    const windowStart = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (prev.length >= this.limit) {
      const oldest = prev[0] ?? now;
      this.hits.set(key, prev);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, oldest + this.windowMs - now),
        limit: this.limit,
        policy: this.policy,
      };
    }
    prev.push(now);
    this.hits.set(key, prev);
    return {
      allowed: true,
      remaining: Math.max(0, this.limit - prev.length),
      retryAfterMs: 0,
      limit: this.limit,
      policy: this.policy,
    };
  }

  remaining(key: string, now = Date.now()): number {
    const windowStart = now - this.windowMs;
    const prev = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    return Math.max(0, this.limit - prev.length);
  }

  clear(): void {
    this.hits.clear();
  }
}

/** 3 holds per credential-identity per 10 minutes. */
export function createHoldRateLimiter(): MemoryRateBucket {
  return new MemoryRateBucket(3, 10 * 60 * 1000, 'hold');
}

/** OTP submit brute-force bucket: 5 attempts then 15 minute lock window. */
export function createOtpRateLimiter(): MemoryRateBucket {
  return new MemoryRateBucket(5, 15 * 60 * 1000, 'otp');
}
