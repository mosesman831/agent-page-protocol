/**
 * APP wire parsing - media types, document discrimination, JSON Pointer helpers.
 * SPEC §2, §3, §5, §7 (JSON Pointer), §14
 */

import {
  formatCellCurrency,
  formatCellNumber,
  formatCurrencyAmount,
  formatPlainNumber,
} from './money.js';

export const APP_VERSION = '1.0';
export const APP_VERSION_11 = '1.1';
export const EXT_VERSION = '0.5.0';

export const MEDIA_PAGE = 'application/vnd.agent-page+json';
export const MEDIA_DIFF = 'application/vnd.agent-page-diff+json';
export const MEDIA_ERROR = 'application/vnd.agent-page-error+json';
export const MEDIA_ACTION = 'application/vnd.agent-page-action+json';
export const MEDIA_EVENT = 'application/vnd.agent-page-event+json';

export const ACCEPT_HEADER = `${MEDIA_PAGE}, ${MEDIA_DIFF}, ${MEDIA_ERROR}`;

/** Closed set of X-APP-Response-Mode values (§3.4 / §3.9). */
export const RESPONSE_MODES = Object.freeze(['full', 'diff', 'redirect', 'error', 'async']);

export const HEADER = {
  CLIENT: 'X-APP-Client',
  IF_MATCH_VERSION: 'X-APP-If-Match-Version',
  IDEMPOTENCY_KEY: 'X-APP-Idempotency-Key',
  CONFIRMATION: 'X-APP-Confirmation',
  RESPONSE_MODE: 'X-APP-Response-Mode',
  RESULT_VERSION: 'X-APP-Result-Version',
  NAVIGATE: 'X-APP-Navigate',
  REQUEST_ID: 'X-APP-Request-Id',
  PAGE_ID: 'X-APP-Page-Id',
  VERSION: 'X-APP-Version',
  CSRF: 'X-APP-CSRF',
  ORIGIN: 'X-APP-Origin',
  ACCEPT_VERSIONS: 'X-APP-Accept-Versions',
  CHALLENGE: 'X-APP-Challenge',
  HOLD_TOKEN: 'X-APP-Hold-Token',
  RESUME: 'X-APP-Resume',
  ACCESS_TOKEN: 'X-APP-Access-Token',
  REFRESH_TOKEN: 'X-APP-Refresh-Token',
  SET_RESUME: 'Set-APP-Resume',
};

export function parseMediaType(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const base = raw.split(';')[0]?.trim().toLowerCase() ?? '';
  return base.length > 0 ? base : null;
}

export function isAppPageMedia(type) {
  return parseMediaType(type) === MEDIA_PAGE;
}

export function isAppDiffMedia(type) {
  return parseMediaType(type) === MEDIA_DIFF;
}

export function isAppErrorMedia(type) {
  return parseMediaType(type) === MEDIA_ERROR;
}

export function isAppMedia(type) {
  const t = parseMediaType(type);
  return t === MEDIA_PAGE || t === MEDIA_DIFF || t === MEDIA_ERROR || t === MEDIA_ACTION;
}

/**
 * Normalize response-mode header; unknown → null (caller falls back to body shape).
 */
export function parseResponseMode(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const mode = raw.trim().toLowerCase();
  return RESPONSE_MODES.includes(mode) ? mode : null;
}

/**
 * Root `page_version` is non-authoritative (C1 / §12). Strip if present; never require.
 */
export function stripNonAuthoritativeRoot(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  if (!('page_version' in doc)) return doc;
  const { page_version: _ignored, ...rest } = doc;
  return rest;
}

/**
 * Discriminate a parsed JSON body into manifest | diff | error | unknown.
 */
export function classifyDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { kind: 'unknown', doc };
  }
  const normalized = stripNonAuthoritativeRoot(doc);
  if (normalized.app !== APP_VERSION && normalized.app !== APP_VERSION_11) {
    return { kind: 'unknown', doc: normalized };
  }
  if (
    normalized.error &&
    typeof normalized.error === 'object' &&
    normalized.error.code &&
    !normalized.page
  ) {
    if (!normalized.state && String(normalized.error.code).startsWith('app.err.')) {
      return { kind: 'error', doc: normalized };
    }
  }
  if (Array.isArray(normalized.diff) && normalized.base && normalized.result_version) {
    return { kind: 'diff', doc: normalized };
  }
  if (normalized.page && normalized.state) {
    return { kind: 'manifest', doc: normalized };
  }
  if (normalized.error?.code && !normalized.page) {
    return { kind: 'error', doc: normalized };
  }
  return { kind: 'unknown', doc: normalized };
}

export function parseJsonText(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: {
        app: APP_VERSION,
        error: {
          code: 'app.err.payload.invalid_json',
          message: err instanceof Error ? err.message : 'JSON parse failed',
          retryable: false,
        },
      },
    };
  }
}

/** Read X-APP-Result-Version from a Headers-like object. */
export function readResultVersion(headers) {
  if (!headers) return null;
  const get =
    typeof headers.get === 'function'
      ? (n) => headers.get(n)
      : (n) => headers[n] ?? headers[n.toLowerCase()];
  const v = get(HEADER.RESULT_VERSION) || get('x-app-result-version');
  return v && typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** RFC 6901 unescape */
export function unescapePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function escapePointerToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Resolve a JSON Pointer against a document. Returns undefined if missing.
 */
export function getByPointer(doc, pointer) {
  if (pointer === '' || pointer === '/') {
    return pointer === '' ? doc : doc?.[''];
  }
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) {
    return undefined;
  }
  const parts = pointer.split('/').slice(1).map(unescapePointerToken);
  let cur = doc;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return undefined;
      cur = cur[idx];
    } else if (Object.prototype.hasOwnProperty.call(cur, part)) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Dot-path from /state root (present.state_path) → JSON Pointer under /state.
 * e.g. "results" → "/state/results", "flight.segments" → "/state/flight/segments"
 */
export function statePathToPointer(statePath) {
  if (!statePath || typeof statePath !== 'string') return '/state';
  const parts = statePath.split('.').filter(Boolean).map(escapePointerToken);
  return `/state/${parts.join('/')}`;
}

/**
 * Field names of a v0.4 table node in JSON insertion order.
 */
export function tableFieldKeys(node) {
  if (!node || typeof node !== 'object') return [];
  if (node.fields && typeof node.fields === 'object' && !Array.isArray(node.fields)) {
    return Object.keys(node.fields);
  }
  // Legacy v0.3 columns fallback
  if (Array.isArray(node.columns)) {
    return node.columns.map((c) => (typeof c === 'string' ? c : c.key));
  }
  return [];
}

/**
 * Extract displayable plain value from a StateNode (or plain JSON fallback).
 */
export function stateNodePlain(node) {
  if (node == null) return null;
  if (typeof node !== 'object' || Array.isArray(node)) return node;
  if (!('type' in node)) return node;
  switch (node.type) {
    case 'null':
      return null;
    case 'string':
    case 'number':
    case 'boolean':
    case 'date':
    case 'datetime':
    case 'enum':
      return node.value;
    case 'array':
      return Array.isArray(node.value) ? node.value.map((item) => stateNodePlain(item)) : [];
    case 'object': {
      const out = {};
      const fields = node.value || node.fields || {};
      for (const [k, v] of Object.entries(fields)) {
        out[k] = stateNodePlain(v);
      }
      return out;
    }
    case 'table': {
      const cols = tableFieldKeys(node);
      const rows = Array.isArray(node.value)
        ? node.value
        : Array.isArray(node.rows)
          ? node.rows
          : [];
      return rows.map((row) => {
        if (Array.isArray(row)) {
          const obj = {};
          cols.forEach((key, i) => {
            obj[key] = row[i] ?? null;
          });
          return obj;
        }
        return stateNodePlain(row);
      });
    }
    case 'file':
      return node.value?.url || node.value?.name || node.url || node.name || null;
    case 'embed':
      return { url: node.url, description: node.description };
    case 'markdown':
      return node.value;
    case 'media':
      return Array.isArray(node.value) ? node.value.map((it) => it?.url ?? it) : [];
    case 'tree': {
      const flat = (items) =>
        (Array.isArray(items) ? items : []).map((it) => ({
          id: it?.id,
          label: it?.label,
          ...(it?.children ? { children: flat(it.children) } : {}),
        }));
      return flat(node.value);
    }
    default:
      return 'value' in node ? node.value : node;
  }
}

/**
 * Format a StateNode (or plain value) for display.
 * Money: integer minor units ÷ 10^scale with unit (§5.2#4).
 */
export function formatStateValue(node, format) {
  if (node == null) return '';
  const type = node?.type;
  if (type === 'null') return '';
  if (type === 'string' && node.secret) {
    const v = String(node.value ?? '');
    if (v.length <= 4) return '••••';
    return `${v[0]}${'•'.repeat(Math.min(8, v.length - 2))}${v.slice(-2)}`;
  }

  const plain = stateNodePlain(node);
  if (plain == null) return '';

  const unit = node?.unit;
  const scale = node?.scale;

  if (format === 'currency' || (type === 'number' && unit && /^[A-Z]{3}$/.test(unit))) {
    let amount = typeof plain === 'number' ? plain : Number(plain);
    if (typeof scale === 'number' && Number.isInteger(scale)) {
      amount = amount / 10 ** scale;
    }
    return formatCurrencyAmount(amount, unit);
  }

  if (format === 'percent') {
    const n = Number(plain);
    return `${(n * 100).toFixed(1)}%`;
  }

  if (format === 'duration_min') {
    const mins = Number(plain);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  if (format === 'date' || type === 'date') {
    return String(plain);
  }

  if (format === 'datetime' || type === 'datetime') {
    try {
      return new Date(String(plain)).toLocaleString();
    } catch {
      return String(plain);
    }
  }

  if (format === 'number' || type === 'number') {
    let amount = Number(plain);
    if (typeof scale === 'number') amount = amount / 10 ** scale;
    return formatPlainNumber(amount, unit);
  }

  if (typeof plain === 'boolean') return plain ? 'Yes' : 'No';
  if (typeof plain === 'object') return JSON.stringify(plain);
  return String(plain);
}

/**
 * Format a plain table cell given declared field type and optional format hint.
 */
export function formatTableCell(value, fieldType, format) {
  if (value == null) return '';
  if (format === 'currency' && typeof value === 'number') {
    return formatCellCurrency(value);
  }
  if (fieldType === 'number' || format === 'number' || typeof value === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return formatCellNumber(value);
    }
  }
  if (fieldType === 'boolean' || typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (fieldType === 'datetime' && typeof value === 'string') {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }
  return String(value);
}

/**
 * Resolve {param.*} and {state.*} in confirm.body_template (§10.4).
 * Unresolvable → empty string.
 */
export function expandTemplate(template, { params = {}, state = {} } = {}) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{(param|state)\.([^}]+)\}/g, (_, root, path) => {
    const parts = path.split('.');
    let cur = root === 'param' ? params : state;
    for (const p of parts) {
      if (cur == null) return '';
      if (typeof cur === 'object' && 'type' in cur && cur.type) {
        if (cur.type === 'object') {
          cur = (cur.value || cur.fields || {})[p];
        } else if (cur.type === 'array') {
          cur = cur.value?.[Number(p)];
        } else {
          cur = cur[p];
        }
      } else {
        cur = cur[p];
      }
    }
    if (cur == null) return '';
    if (typeof cur === 'object' && cur.type) {
      return String(formatStateValue(cur));
    }
    return String(cur);
  });
}

export function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Mode B confirmation header value (§10.4.2) - renderer/extension only. */
export function uuidModeToken(id = uuid()) {
  const raw = String(id).startsWith('uuid-mode:')
    ? String(id).slice('uuid-mode:'.length)
    : String(id);
  return `uuid-mode:${raw}`;
}

export function deepClone(value) {
  return structuredClone(value);
}
