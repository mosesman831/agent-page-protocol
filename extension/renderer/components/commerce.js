/**
 * commerce.js - shared helpers for card.js, detail.js and table.js (store skin).
 * Pure functions over manifest field maps: values may be StateNodes or plain JSON.
 * This module never uses innerHTML and never contains a hard-coded image URL.
 */

import { formatStateValue, stateNodePlain, tableFieldKeys } from '../../protocol/parse.js';
import { currencyFormatter, formatScaledNumber } from '../../protocol/money.js';

const ISO_UNIT_RE = /^[A-Z]{3}$/;

const CHIP_TONE_SUCCESS = new Set(['in_stock', 'available', 'accepted', 'confirmed', 'paid']);
const CHIP_TONE_ACCENT = new Set(['offer', 'counter_offer', 'countered', 'negotiating']);
const CHIP_TONE_DANGER = new Set([
  'unavailable',
  'out_of_stock',
  'sold_out',
  'rejected',
  'expired',
  'failed',
  'cancelled',
]);
const CHIP_KEYS = ['status', 'availability', 'offer_status', 'stock_status'];
const CHIP_LABELS = {
  in_stock: 'In stock',
  counter_offer: 'Counter-offer',
  out_of_stock: 'Out of stock',
};
const PRICE_FALLBACK_KEYS = ['price', 'total', 'amount'];

/** True when `v` looks like a StateNode ({type, value|fields}). */
export function isNode(v) {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof v.type === 'string' &&
    ('value' in v || 'fields' in v || v.type === 'null')
  );
}

/**
 * Field map for an item: object node -> value ?? fields; table row (positional
 * array) -> zipped with the container's field keys; plain object -> as-is.
 */
export function fields(item, containerNode) {
  if (item == null) return {};
  if (Array.isArray(item)) {
    const keys = tableFieldKeys(containerNode);
    const out = {};
    keys.forEach((k, i) => {
      out[k] = item[i] ?? null;
    });
    return out;
  }
  if (isNode(item)) {
    const inner = item.value ?? item.fields;
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner;
    return { value: item.value ?? null };
  }
  return typeof item === 'object' ? item : {};
}

/** Plain displayable value of a field (StateNode-aware). */
export function plainOf(v) {
  return isNode(v) ? stateNodePlain(v) : v;
}

/**
 * Resolve an image URL from a field map. Keys: `image`, then `images[0]`.
 * Accepts a string node, a plain string, or a `file` node (value.url; a present
 * value.mime must start with image/). The URL is used only when its protocol is
 * https: or its origin equals the page origin. Anything else -> null.
 */
export function resolveImage(f, pageUrl) {
  if (!f || typeof f !== 'object') return null;
  let raw;
  const field = f.image ?? f.images;
  if (isNode(field) && field.type === 'array') {
    raw = Array.isArray(field.value) ? field.value[0] : undefined;
  } else if (Array.isArray(field)) {
    raw = field[0];
  } else {
    raw = field;
  }

  let url;
  if (isNode(raw) && raw.type === 'file') {
    const v = raw.value;
    if (v && typeof v === 'object' && v.mime != null && !String(v.mime).startsWith('image/')) {
      return null;
    }
    url = v?.url;
  } else {
    url = plainOf(raw);
  }
  if (typeof url !== 'string' || !url) return null;

  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  try {
    const base = new URL(pageUrl);
    if (u.protocol === 'https:' || u.origin === base.origin) return u.href;
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolve the price field of a field map. Key: first
 * section.columns[].format==='currency' key; else first number node with an
 * /^[A-Z]{3}$/ unit; else price|total|amount.
 * Returns { key, text, raw, unit, scale } or null. Never implicit USD.
 */
export function resolvePrice(f, section) {
  if (!f || typeof f !== 'object') return null;
  let key = null;

  const cols = section?.columns;
  if (Array.isArray(cols)) {
    const hit = cols.find((c) => c && c.format === 'currency' && f[c.key] != null);
    if (hit) key = hit.key;
  }
  if (key == null) {
    for (const [k, v] of Object.entries(f)) {
      const isNum = isNode(v) ? v.type === 'number' : typeof v === 'number';
      const unit = isNode(v) ? v.unit : v && typeof v === 'object' ? v.unit : undefined;
      if (isNum && typeof unit === 'string' && ISO_UNIT_RE.test(unit)) {
        key = k;
        break;
      }
    }
  }
  if (key == null) {
    for (const k of PRICE_FALLBACK_KEYS) {
      if (f[k] != null) {
        key = k;
        break;
      }
    }
  }
  if (key == null) return null;

  const node = f[key];
  const num = Number(plainOf(node));
  if (!Number.isFinite(num)) return null;
  const unit = isNode(node) ? node.unit : node && typeof node === 'object' ? node.unit : undefined;
  const scaleRaw = isNode(node)
    ? node.scale
    : node && typeof node === 'object'
      ? node.scale
      : undefined;
  const scale = Number.isInteger(scaleRaw) ? scaleRaw : 0;

  let text;
  if (typeof unit === 'string' && ISO_UNIT_RE.test(unit)) {
    text = formatStateValue(isNode(node) ? node : { type: 'number', value: num, unit, scale });
  } else {
    text = formatScaledNumber(num, scale);
  }
  return { key, text, raw: num, unit: typeof unit === 'string' ? unit : '', scale };
}

/**
 * Resolve a status/availability chip from a field map.
 * Returns { key, tone, label, value } or null. No chip field -> no chip.
 */
export function resolveChip(f) {
  if (!f || typeof f !== 'object') return null;
  for (const key of CHIP_KEYS) {
    const raw = f[key];
    if (raw == null) continue;
    const v = plainOf(raw);
    if (typeof v !== 'string' || !v) continue;
    const tone = CHIP_TONE_SUCCESS.has(v)
      ? 'success'
      : CHIP_TONE_ACCENT.has(v)
        ? 'accent'
        : CHIP_TONE_DANGER.has(v)
          ? 'danger'
          : 'neutral';
    const label = CHIP_LABELS[v] || humanize(v);
    return { key, tone, label, value: v };
  }
  return null;
}

/**
 * Currency cell for table.js: unit from state.currency.value when /^[A-Z]{3}$/;
 * scale from state[colKey + '_scale'].value ?? state.price_scale.value when an
 * integer, else 0. Intl currency when unit exists, else fixed-decimal number
 * with no symbol. Reads only manifest nodes; never USD.
 */
export function resolveTableMoney(value, colKey, state) {
  const cur = state?.currency;
  const unitRaw = cur && typeof cur === 'object' ? cur.value : cur;
  const unit = typeof unitRaw === 'string' && ISO_UNIT_RE.test(unitRaw) ? unitRaw : null;

  const scaleNode = state?.[colKey + '_scale'] ?? state?.price_scale;
  const scaleRaw = scaleNode && typeof scaleNode === 'object' ? scaleNode.value : scaleNode;
  const scale = Number.isInteger(scaleRaw) ? scaleRaw : 0;

  const amount = Number(value) / 10 ** scale;
  if (unit) {
    try {
      return currencyFormatter(unit).format(amount);
    } catch {
      /* fall through to fixed decimals */
    }
  }
  return formatScaledNumber(value, scale);
}

/** `back_ordered` -> `Back ordered`; `succeeded` -> `Succeeded`. */
export function humanize(v) {
  const s = String(v).replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** First letter of the first two words starting with a letter or digit. */
export function monogram(title) {
  const words = String(title || '')
    .split(/\s+/)
    .filter((w) => /^[a-z0-9]/i.test(w));
  const a = words[0]?.[0] || '·';
  const b = words[1]?.[0] || '';
  return (a + b).toUpperCase();
}

/**
 * Build a media slot: an <img> (lazy/async/no-referrer) or a typographic
 * placeholder. On `error` the img is replaced by the placeholder and
 * `app-card--noimg` is added to `host`. Never leaves a broken image.
 */
export function buildMedia({ imageUrl, title, host, mediaClass = 'app-card-media' }) {
  const media = document.createElement('div');
  media.className = mediaClass;

  const placeholder = () => {
    const ph = document.createElement('div');
    ph.className = 'app-card-ph';
    ph.setAttribute('aria-hidden', 'true');
    const mark = document.createElement('span');
    mark.className = 'app-ph-mark';
    mark.textContent = monogram(title);
    ph.appendChild(mark);
    return ph;
  };

  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'app-card-img';
    img.src = imageUrl;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.alt = title || '';
    img.addEventListener('error', () => {
      img.replaceWith(placeholder());
      host?.classList.add('app-card--noimg');
    });
    media.appendChild(img);
  } else {
    media.appendChild(placeholder());
    host?.classList.add('app-card--noimg');
  }
  return media;
}
