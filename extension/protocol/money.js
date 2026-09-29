/**
 * Single home for every Intl.NumberFormat use in the extension — money and
 * numeric display formatting live here and nowhere else, so currency semantics
 * (unit, scale, fallback shape) can only drift in one place.
 */

const currencyFormatters = new Map();

/** Intl currency formatter for an ISO 4217 unit (cached per unit). */
export function currencyFormatter(unit) {
  let f = currencyFormatters.get(unit);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency: unit });
    currencyFormatters.set(unit, f);
  }
  return f;
}

/** `amount` (already descaled) as currency text; `${amount} ${unit}` on Intl failure. */
export function formatCurrencyAmount(amount, unit) {
  try {
    return currencyFormatter(unit || 'USD').format(amount);
  } catch {
    return `${amount} ${unit || ''}`.trim();
  }
}

/** `total / 10**scale` as currency text; `${amount.toFixed(scale)} ${currency}` on failure. */
export function formatScaledMoney(total, scale, currency) {
  const amount = Number(total) / 10 ** scale;
  try {
    return currencyFormatter(currency || 'USD').format(amount);
  } catch {
    return `${amount.toFixed(scale)} ${currency || ''}`.trim();
  }
}

/** `num / 10**scale` as a fixed-decimal number with no currency symbol. */
export function formatScaledNumber(num, scale) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: scale,
    maximumFractionDigits: scale,
  }).format(num / 10 ** scale);
}

/** Plain grouped number (no currency style), with an optional ` ${unit}` suffix. */
export function formatPlainNumber(amount, unit) {
  const formatted = new Intl.NumberFormat().format(amount);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Table-cell currency fallback: USD, at most 2 decimals. */
export function formatCellCurrency(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

/** Table-cell number: integers plain, fractions up to 6 decimals. */
export function formatCellNumber(value) {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 6,
  }).format(value);
}
