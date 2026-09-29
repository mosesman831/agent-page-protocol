/**
 * Shared text/format helpers for the manifest → HTML renderer — the tiny
 * pure functions both render-html.mjs (page assembly) and render-fields.mjs
 * (form widgets) need.
 */

export const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const moneyFmt = (n) => {
  const unit = n.unit ?? 'GBP';
  const scale = n.scale ?? 2;
  const sym = { GBP: '£', USD: '$', EUR: '€' }[unit] ?? `${unit} `;
  return `${sym}${(Number(n.value) / 10 ** scale).toLocaleString('en-GB', { minimumFractionDigits: scale, maximumFractionDigits: scale })}`;
};

export const humanize = (k) =>
  String(k)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** site-relative path: /app/<site>/<slug> -> /site/<site>/<slug> */
export const toSite = (url) => String(url ?? '').replace(/\/app\//, '/site/');

export const isMoneyNode = (v) =>
  v && typeof v === 'object' && v.unit && Number.isFinite(Number(v.value));
