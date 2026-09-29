/**
 * Locale / timezone helpers (SPEC §17). IANA + BCP 47.
 * X-APP-Locale wins over Accept-Language for page.language.
 * Unknown timezone: ignore + warn timezone_fallback.
 * MUST NOT rewrite stored RFC 3339 datetime values.
 */

export const WARN_TIMEZONE_FALLBACK = 'app.warn.negotiate.timezone_fallback';
export const WARN_LANGUAGE_FALLBACK = 'app.warn.negotiate.language_fallback';

const BCP47_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function isBcp47(tag: string): boolean {
  if (typeof tag !== 'string') return false;
  const t = tag.trim();
  if (t.length < 2 || t.length > 35) return false;
  return BCP47_RE.test(t);
}

export function isIanaTimeZone(tz: string): boolean {
  if (typeof tz !== 'string') return false;
  const name = tz.trim();
  if (name.length < 1 || name.length > 64) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: name }).format(0);
    return true;
  } catch {
    return false;
  }
}

/** First tag from Accept-Language, ignoring q weights for simple selection. */
export function parseAcceptLanguage(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const first = header.split(',')[0]?.trim();
  if (!first) return undefined;
  const tag = first.split(';')[0]?.trim();
  if (!tag || !isBcp47(tag)) return undefined;
  return tag;
}

export interface ResolveLocaleInput {
  appLocale?: string | null;
  acceptLanguage?: string | null;
  appTimeZone?: string | null;
  /** RFC 3339 datetime strings already stored. Returned unchanged. */
  storedDatetimes?: string[];
}

export interface ResolveLocaleResult {
  language?: string;
  timeZone?: string;
  warnings: string[];
  /** Same references/values as input.storedDatetimes - never rewritten. */
  storedDatetimes?: string[];
}

/**
 * Resolve page.language and display time zone.
 * X-APP-Locale wins over Accept-Language. Unknown TZ ignored + warn.
 */
export function resolveLocale(input: ResolveLocaleInput): ResolveLocaleResult {
  const warnings: string[] = [];
  let language: string | undefined;
  if (input.appLocale && isBcp47(input.appLocale)) {
    language = input.appLocale.trim();
  } else if (input.appLocale && input.appLocale.trim().length > 0) {
    warnings.push(WARN_LANGUAGE_FALLBACK);
    language = parseAcceptLanguage(input.acceptLanguage);
  } else {
    language = parseAcceptLanguage(input.acceptLanguage);
  }

  let timeZone: string | undefined;
  if (input.appTimeZone && input.appTimeZone.trim().length > 0) {
    if (isIanaTimeZone(input.appTimeZone)) {
      timeZone = input.appTimeZone.trim();
    } else {
      warnings.push(WARN_TIMEZONE_FALLBACK);
    }
  }

  const storedDatetimes = input.storedDatetimes;
  return { language, timeZone, warnings, storedDatetimes };
}

/** Display-only. MUST NOT be used to rewrite stored RFC 3339 values. */
export function formatDatetimeForZone(rfc3339: string, _timeZone?: string): string {
  return rfc3339;
}
