import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifyReason = 'missing' | 'malformed' | 'mismatch' | 'stale';

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyReason };

const LOCKED_HEADER = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

/**
 * X-Payment-Signature: the whole header must be t=<digits>,v1=<64 lowercase hex>.
 * Extra pairs, whitespace, and uppercase hex are malformed.
 */
export function verifyPaymentSignature(
  header: string | undefined,
  rawBody: Buffer,
  secret: string,
  nowSec: number,
): VerifyResult {
  if (header === undefined) return { ok: false, reason: 'missing' };
  const match = LOCKED_HEADER.exec(header);
  if (!match) return { ok: false, reason: 'malformed' };
  return verifyParts(match[1]!, match[2]!, rawBody, secret, nowSec);
}

/**
 * Shared compare used by the locked header and by Stripe-Signature after
 * other comma pairs (v0) have been ignored.
 */
export function verifyParts(
  digits: string,
  v1hex: string,
  rawBody: Buffer,
  secret: string,
  nowSec: number,
): VerifyResult {
  if (!/^\d{1,12}$/.test(digits) || !/^[0-9a-f]{64}$/.test(v1hex)) {
    return { ok: false, reason: 'malformed' };
  }
  if (!Number.isInteger(nowSec)) return { ok: false, reason: 'malformed' };
  const ts = Number(digits);
  if (Math.abs(nowSec - ts) > 300) return { ok: false, reason: 'stale' };

  const prefix = Buffer.from(`${digits}.`, 'utf8');
  const expected = createHmac('sha256', secret)
    .update(Buffer.concat([prefix, rawBody]))
    .digest('hex');
  const a = Buffer.from(v1hex, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || a.length !== 32) return { ok: false, reason: 'malformed' };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

/** Stripe-Signature: t= and v1= required; other comma pairs ignored. One v1 only. */
export function parseStripeSignatureHeader(header: string): { digits: string; v1: string } | null {
  if (header === '') return null;
  let digits: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const piece = part.trim();
    if (piece.startsWith('t=')) {
      if (digits !== undefined) return null;
      digits = piece.slice(2);
    } else if (piece.startsWith('v1=')) {
      if (v1 !== undefined) return null;
      v1 = piece.slice(3);
    }
  }
  if (digits === undefined || v1 === undefined) return null;
  if (!/^\d{1,12}$/.test(digits) || !/^[0-9a-f]{64}$/.test(v1)) return null;
  return { digits, v1 };
}
