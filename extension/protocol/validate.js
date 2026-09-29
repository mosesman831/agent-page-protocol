/**
 * Lightweight Page Manifest / Diff / Error validation (SPEC §2, §5, §7, Appendix A).
 * No external JSON Schema engine - structural checks sufficient for the renderer.
 */

import {
  APP_VERSION,
  classifyDocument,
  stripNonAuthoritativeRoot,
  tableFieldKeys,
} from './parse.js';

const STATE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ACTION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PAGE_ID_RE = /^[a-z][a-z0-9_-]{0,127}$/;
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const STATE_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'null',
  'date',
  'datetime',
  'enum',
  'array',
  'object',
  'file',
  'table',
  // 1.1 (§9 / §12)
  'geopoint',
  'quantity',
  'order',
  'daterange',
  'datetimerange',
  // SPEC-WEB-NODES (v1.2): embed / markdown / media / tree
  'embed',
  'markdown',
  'media',
  'tree',
]);

const TABLE_FIELD_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'file',
  'null',
  'any',
  'geopoint',
  'quantity',
  'daterange',
  'datetimerange',
]);

const SIDE_EFFECTS = new Set(['safe', 'destructive', 'financial', 'identity']);
const ACTION_KINDS = new Set(['query', 'mutate', 'navigate', 'confirm', 'delegate']);
const PATCH_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

const CHALLENGE_KINDS = new Set([
  'otp',
  'totp',
  'webauthn',
  'magic_link',
  'password',
  'backup_code',
  'push',
]);
const HOLD_KINDS = new Set(['captcha', 'webview', 'liveness', 'tos']);
const HOLD_STATUSES = new Set(['pending', 'cleared', 'expired', 'failed']);
const EVENT_TYPES = new Set([
  'state.changed',
  'page.replaced',
  'action.completed',
  'session.expired',
  'hold.cleared',
  'challenge.updated',
  'order.updated',
  'consent.changed',
  'heartbeat',
]);
const EVENT_HINTS = new Set(['revalidate', 'diff', 'drop']);
const ORDER_STATUSES = new Set([
  'draft',
  'pending',
  'awaiting_payment',
  'awaiting_3ds',
  'paid',
  'fulfilling',
  'shipped',
  'delivered',
  'cancel_pending',
  'cancelled',
  'refund_pending',
  'refunded',
  'failed',
]);

/** Identity / concurrency paths - MUST NOT appear in diffs (§7.2). */
const FORBIDDEN_DIFF_EXACT = new Set([
  '/app',
  '/page/id',
  '/page/url',
  '/page/version',
  '/page/etag',
]);

const FORBIDDEN_DIFF_PREFIXES = [
  '/app/',
  '/page/id/',
  '/page/url/',
  '/page/version/',
  '/page/etag/',
];

const ALLOWED_DIFF_ROOTS = ['/state', '/actions', '/navigation', '/present', '/error', '/meta'];
const ALLOWED_DIFF_PAGE_FIELDS = [
  '/page/title',
  '/page/description',
  '/page/language',
  '/page/generated_at',
];

function decodePointerToken(token) {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

// Table cell-level patches are forbidden — whole-node only (TV-35). A path
// like /state/<key>/value/<r>/<c> addresses a cell when <key> is a table.
function isTableCellPath(manifest, path) {
  if (!manifest || typeof path !== 'string' || !path.startsWith('/')) return false;
  const tokens = path.slice(1).split('/').map(decodePointerToken);
  if (tokens[0] !== 'state' || tokens.length < 4) return false;
  const node = manifest.state?.[tokens[1]];
  return !!node && node.type === 'table' && tokens[2] === 'value';
}

// Same policy as packages/client/src/diff.ts isAllowedDiffPath — keep in
// sync (equivalence pinned by schema/extension-diff.test.mjs).
export function isAllowedDiffPath(path, manifest) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false;
  if (FORBIDDEN_DIFF_EXACT.has(path)) return false;
  for (const forbidden of FORBIDDEN_DIFF_PREFIXES) {
    if (path.startsWith(forbidden)) return false;
  }
  const pageField = ALLOWED_DIFF_PAGE_FIELDS.some((f) => path === f || path.startsWith(`${f}/`));
  const root = ALLOWED_DIFF_ROOTS.some((r) => path === r || path.startsWith(`${r}/`));
  if (!pageField && !root) return false;
  if (isTableCellPath(manifest, path)) return false;
  return true;
}

function err(code, message, path) {
  return { ok: false, code, message, path };
}

function validatePagination(pag, path) {
  if (pag == null) return { ok: true };
  if (typeof pag !== 'object' || Array.isArray(pag)) {
    return err('app.err.state.invalid_node', 'pagination must be object', path);
  }
  if (!('cursor' in pag) || !('has_more' in pag) || !('total' in pag)) {
    return err('app.err.state.invalid_node', 'pagination requires cursor/has_more/total', path);
  }
  if (pag.cursor != null && typeof pag.cursor !== 'string') {
    return err('app.err.state.invalid_node', 'pagination.cursor must be string|null', path);
  }
  if (typeof pag.has_more !== 'boolean') {
    return err('app.err.state.invalid_node', 'pagination.has_more must be boolean', path);
  }
  if (pag.total != null && (!Number.isInteger(pag.total) || pag.total < 0)) {
    return err('app.err.state.invalid_node', 'pagination.total must be integer|null ≥0', path);
  }
  return { ok: true };
}

function validateStateNode(node, path) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return err('app.err.state.invalid_node', 'State node must be an object', path);
  }
  if (!STATE_TYPES.has(node.type)) {
    // Strict renderer: unknown types rejected with registry code (§5.2#11)
    return err('app.err.state.unknown_type', `Unknown state type: ${node.type}`, path);
  }
  for (const k of Object.keys(node)) {
    if (FORBIDDEN_OBJECT_KEYS.has(k)) {
      return err('app.err.state.illegal_key', `Forbidden node member: ${k}`, `${path}/${k}`);
    }
  }
  switch (node.type) {
    case 'null':
      if ('value' in node) {
        return err('app.err.state.invalid_node', 'null node must not have value', path);
      }
      break;
    case 'string':
      if (typeof node.value !== 'string') {
        return err('app.err.state.invalid_node', 'string value required', path);
      }
      break;
    case 'number':
      if (typeof node.value !== 'number' || !Number.isFinite(node.value)) {
        return err('app.err.state.number_overflow', 'finite number value required', path);
      }
      if (typeof node.scale === 'number' && !Number.isInteger(node.value)) {
        return err('app.err.state.invalid_node', 'scaled number must be integer minor units', path);
      }
      if (Number.isInteger(node.value) && Math.abs(node.value) > Number.MAX_SAFE_INTEGER) {
        return err('app.err.state.number_precision', 'integer exceeds 2^53−1', path);
      }
      break;
    case 'boolean':
      if (typeof node.value !== 'boolean') {
        return err('app.err.state.invalid_node', 'boolean value required', path);
      }
      break;
    case 'date':
      if (typeof node.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(node.value)) {
        return err('app.err.state.invalid_date', 'date YYYY-MM-DD required', path);
      }
      break;
    case 'datetime':
      if (typeof node.value !== 'string' || Number.isNaN(Date.parse(node.value))) {
        return err('app.err.state.invalid_datetime', 'datetime RFC3339 required', path);
      }
      break;
    case 'enum':
      if (typeof node.value !== 'string') {
        return err('app.err.state.invalid_enum', 'enum value string required', path);
      }
      if (!Array.isArray(node.options) || node.options.length < 1) {
        return err('app.err.state.invalid_enum', 'enum options required', path);
      }
      if (!node.options.includes(node.value)) {
        return err('app.err.state.invalid_enum', 'enum value not in options', path);
      }
      break;
    case 'array':
      if (!Array.isArray(node.value)) {
        return err('app.err.state.invalid_node', 'array value required', path);
      }
      for (let i = 0; i < node.value.length; i++) {
        const item = node.value[i];
        if (item && typeof item === 'object' && item.type) {
          const r = validateStateNode(item, `${path}/value/${i}`);
          if (!r.ok) return r;
        }
      }
      {
        const pr = validatePagination(node.pagination, `${path}/pagination`);
        if (!pr.ok) return pr;
      }
      break;
    case 'object': {
      const fields = node.value ?? node.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return err('app.err.state.invalid_node', 'object value map required', path);
      }
      for (const [k, v] of Object.entries(fields)) {
        if (FORBIDDEN_OBJECT_KEYS.has(k)) {
          return err(
            'app.err.state.illegal_key',
            `Forbidden object key: ${k}`,
            `${path}/value/${k}`,
          );
        }
        if (v && typeof v === 'object' && v.type) {
          const r = validateStateNode(v, `${path}/value/${k}`);
          if (!r.ok) return r;
        }
      }
      break;
    }
    case 'table': {
      const fields = node.fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        return err('app.err.state.invalid_node', 'table fields map required', path);
      }
      const keys = Object.keys(fields);
      if (keys.length < 1 || keys.length > 128) {
        return err('app.err.state.object_too_large', 'table fields count out of range', path);
      }
      for (const [k, t] of Object.entries(fields)) {
        if (!STATE_KEY_RE.test(k)) {
          return err('app.err.state.illegal_key', `Invalid table field key: ${k}`, path);
        }
        if (!TABLE_FIELD_TYPES.has(t)) {
          return err('app.err.state.invalid_node', `Invalid table field type: ${t}`, path);
        }
      }
      if (!Array.isArray(node.value)) {
        return err('app.err.state.invalid_node', 'table value row array required', path);
      }
      if (node.value.length > 10000) {
        return err('app.err.state.array_too_long', 'table rows exceed cap', path);
      }
      for (let i = 0; i < node.value.length; i++) {
        const row = node.value[i];
        if (!Array.isArray(row) || row.length !== keys.length) {
          return err(
            'app.err.state.invalid_node',
            `table row ${i} length must equal fields count`,
            `${path}/value/${i}`,
          );
        }
      }
      {
        const pr = validatePagination(node.pagination, `${path}/pagination`);
        if (!pr.ok) return pr;
      }
      break;
    }
    case 'file':
      break;
    case 'geopoint': {
      const v = node.value;
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return err('app.err.state.invalid_geopoint', 'geopoint value object required', path);
      }
      const lat = typeof v.lat === 'number' ? v.lat : v.lat?.value;
      const lng = typeof v.lng === 'number' ? v.lng : v.lng?.value;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
        return err('app.err.state.invalid_geopoint', 'geopoint.lat out of range', path);
      }
      if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        return err('app.err.state.invalid_geopoint', 'geopoint.lng out of range', path);
      }
      break;
    }
    case 'order': {
      const v = node.value;
      if (!v || typeof v !== 'object' || Array.isArray(v)) {
        return err('app.err.commerce.not_an_order', 'order value object required', path);
      }
      if (typeof v.id !== 'string' || !v.id) {
        return err('app.err.commerce.not_an_order', 'order.id required', path);
      }
      if (typeof v.status !== 'string' || !ORDER_STATUSES.has(v.status)) {
        return err('app.err.commerce.not_an_order', `order.status invalid: ${v.status}`, path);
      }
      if (v.total != null) {
        if (!Number.isInteger(v.total)) {
          return err(
            'app.err.commerce.not_an_order',
            'order.total must be integer minor units',
            path,
          );
        }
        if (!Number.isInteger(v.scale)) {
          return err('app.err.commerce.not_an_order', 'order.scale required with total', path);
        }
        if (typeof v.currency !== 'string') {
          return err('app.err.commerce.not_an_order', 'order.currency required with total', path);
        }
      }
      if (v.items != null) {
        if (!Array.isArray(v.items) || v.items.length > 128) {
          return err('app.err.commerce.not_an_order', 'order.items invalid', path);
        }
      }
      break;
    }
    case 'quantity':
    case 'daterange':
    case 'datetimerange':
      break;
    case 'embed': {
      if (typeof node.url !== 'string' || !/^https:\/\//.test(node.url)) {
        return err('app.err.state.invalid_embed', 'embed url must be an https URI', path);
      }
      const desc = node.description;
      if (typeof desc !== 'string' || desc.length < 1 || desc.length > 512) {
        return err('app.err.state.invalid_embed', 'embed description required (1..512)', path);
      }
      break;
    }
    case 'markdown': {
      if (typeof node.value !== 'string') {
        return err('app.err.state.invalid_markdown', 'markdown value string required', path);
      }
      break;
    }
    case 'media': {
      if (!Array.isArray(node.value) || node.value.length > 256) {
        return err('app.err.state.invalid_media', 'media value array required (<= 256)', path);
      }
      for (const it of node.value) {
        if (
          !it ||
          typeof it !== 'object' ||
          Array.isArray(it) ||
          typeof it.url !== 'string' ||
          !/^https:\/\//.test(it.url)
        ) {
          return err('app.err.state.invalid_media', 'media item url must be an https URI', path);
        }
      }
      break;
    }
    case 'tree': {
      const walkTree = (items, depth) => {
        if (!Array.isArray(items) || items.length > 512) {
          return err('app.err.state.invalid_tree', 'tree value must be an array <= 512', path);
        }
        if (depth > 16) {
          return err('app.err.state.invalid_tree', 'tree depth exceeded 16', path);
        }
        for (const it of items) {
          if (
            !it ||
            typeof it !== 'object' ||
            Array.isArray(it) ||
            typeof it.id !== 'string' ||
            typeof it.label !== 'string'
          ) {
            return err('app.err.state.invalid_tree', 'tree item requires id+label', path);
          }
          if (it.children !== undefined) {
            const e = walkTree(it.children, depth + 1);
            if (e) return e;
          }
        }
        return null;
      };
      const terr = walkTree(node.value, 1);
      if (terr) return terr;
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

/** Unwrap StateNode `{type,value}` or plain value. */
function nodeVal(node) {
  if (node == null) return null;
  if (typeof node === 'object' && node !== null && 'type' in node && 'value' in node) {
    return node.value;
  }
  return node;
}

function challengeFields(challenge) {
  if (!challenge || typeof challenge !== 'object') return null;
  const raw = challenge.value && typeof challenge.value === 'object' ? challenge.value : challenge;
  return {
    id: nodeVal(raw.id),
    kind: nodeVal(raw.kind),
    channel: nodeVal(raw.channel),
    expires_at: nodeVal(raw.expires_at),
    ttl_ms: nodeVal(raw.ttl_ms),
    attempts_remaining: nodeVal(raw.attempts_remaining),
    max_attempts: nodeVal(raw.max_attempts),
    param: nodeVal(raw.param) || 'otp',
    length: nodeVal(raw.length),
    pattern: nodeVal(raw.pattern),
    mask: nodeVal(raw.mask),
    public_key: raw.public_key,
    raw,
  };
}

/**
 * Light validation of a challenge object / StateNode (§6.1).
 * @returns {{ ok: true, challenge: object } | { ok: false, code: string, message: string }}
 */
export function validateChallengeRecord(challenge) {
  const fields = challengeFields(challenge);
  if (!fields) {
    return err('app.err.auth.challenge_invalid', 'challenge object required');
  }
  if (typeof fields.id !== 'string' || fields.id.length < 8 || fields.id.length > 128) {
    return err('app.err.auth.challenge_invalid', 'challenge.id invalid');
  }
  if (!CHALLENGE_KINDS.has(fields.kind)) {
    return err('app.err.auth.challenge_invalid', `challenge.kind invalid: ${fields.kind}`);
  }
  if (typeof fields.ttl_ms === 'number') {
    if (fields.ttl_ms < 30_000 || fields.ttl_ms > 600_000) {
      return err('app.err.auth.challenge_invalid', 'challenge.ttl_ms out of range');
    }
  }
  if (fields.kind === 'webauthn' && fields.public_key == null) {
    return err('app.err.auth.challenge_invalid', 'webauthn requires public_key');
  }
  return { ok: true, challenge: fields };
}

function holdFields(hold) {
  if (!hold || typeof hold !== 'object') return null;
  const raw = hold.value && typeof hold.value === 'object' ? hold.value : hold;
  return {
    id: nodeVal(raw.id),
    kind: nodeVal(raw.kind),
    status: nodeVal(raw.status),
    verify_url: nodeVal(raw.verify_url),
    widget_url: nodeVal(raw.widget_url),
    resume_action: nodeVal(raw.resume_action),
    expires_at: nodeVal(raw.expires_at),
    ttl_ms: nodeVal(raw.ttl_ms),
    who: nodeVal(raw.who),
    agent_solvable: nodeVal(raw.agent_solvable),
    issued_count: nodeVal(raw.issued_count),
    raw,
  };
}

/**
 * Light validation of a hold object / StateNode (§7.1).
 */
export function validateHoldRecord(hold) {
  const fields = holdFields(hold);
  if (!fields) {
    return err('app.err.hold.invalid', 'hold object required');
  }
  if (typeof fields.id !== 'string' || !fields.id) {
    return err('app.err.hold.invalid', 'hold.id required');
  }
  if (!HOLD_KINDS.has(fields.kind)) {
    return err('app.err.hold.invalid', `hold.kind invalid: ${fields.kind}`);
  }
  if (fields.status != null && !HOLD_STATUSES.has(fields.status)) {
    return err('app.err.hold.invalid', `hold.status invalid: ${fields.status}`);
  }
  if (typeof fields.verify_url !== 'string' || !fields.verify_url) {
    return err('app.err.hold.invalid', 'hold.verify_url required');
  }
  if (typeof fields.ttl_ms === 'number') {
    if (fields.ttl_ms < 60_000 || fields.ttl_ms > 900_000) {
      return err('app.err.hold.invalid', 'hold.ttl_ms out of range');
    }
  }
  if (fields.agent_solvable === true && (fields.kind === 'captcha' || fields.kind === 'liveness')) {
    return err('app.err.hold.invalid', 'captcha/liveness must not be agent_solvable');
  }
  return { ok: true, hold: fields };
}

/**
 * Light validation of an Event Record (§14.1).
 */
export function validateEventRecord(doc) {
  if (!doc || typeof doc !== 'object') {
    return err('app.err.payload.invalid_json', 'Event Record must be object');
  }
  const ev = doc.event;
  if (!ev || typeof ev !== 'object') {
    return err('app.err.payload.invalid_json', 'event object required');
  }
  if (typeof ev.id !== 'string' || !ev.id) {
    return err('app.err.payload.invalid_json', 'event.id required');
  }
  if (typeof ev.type !== 'string') {
    return err('app.err.payload.invalid_json', 'event.type required');
  }
  // Unknown event types: ignore (forward compat) - still structurally ok
  if (!EVENT_TYPES.has(ev.type) && ev.type !== 'heartbeat') {
    // accept unknown type for forward compat; caller may ignore
  }
  if (typeof ev.page_id !== 'string' || typeof ev.page_url !== 'string') {
    return err('app.err.payload.invalid_json', 'event.page_id/page_url required');
  }
  if (typeof ev.version !== 'string') {
    return err('app.err.payload.invalid_json', 'event.version required');
  }
  if (typeof ev.occurred_at !== 'string') {
    return err('app.err.payload.invalid_json', 'event.occurred_at required');
  }
  if (!EVENT_HINTS.has(ev.hint)) {
    return err('app.err.payload.invalid_json', `event.hint invalid: ${ev.hint}`);
  }
  return { ok: true, event: ev, knownType: EVENT_TYPES.has(ev.type) };
}

/** Extract challenge StateNode from 428 error envelope. */
export function extractChallenge(errorDoc) {
  const details = errorDoc?.error?.details || errorDoc?.details;
  if (!details?.challenge) return null;
  const v = validateChallengeRecord(details.challenge);
  return v.ok ? v.challenge : null;
}

/** Extract hold StateNode from 428 error envelope. */
export function extractHold(errorDoc) {
  const details = errorDoc?.error?.details || errorDoc?.details;
  if (!details?.hold) return null;
  const v = validateHoldRecord(details.hold);
  return v.ok ? v.hold : null;
}

/** UX stale window for challenge/hold/confirm: min(ttl_ms, 30s). */
export function staleWindowMs(ttlMs, fallback = 30_000) {
  const ttl = typeof ttlMs === 'number' && Number.isFinite(ttlMs) ? ttlMs : fallback;
  return Math.min(Math.max(0, ttl), 30_000);
}

export { ORDER_STATUSES, CHALLENGE_KINDS, HOLD_KINDS, EVENT_TYPES };

function validateActionDef(def, path) {
  if (!def || typeof def !== 'object') {
    return err('app.err.manifest.invalid', 'ActionDef must be object', path);
  }
  if (def.kind && !ACTION_KINDS.has(def.kind)) {
    return err('app.err.manifest.invalid', `Invalid action kind: ${def.kind}`, path);
  }
  if (def.side_effect && !SIDE_EFFECTS.has(def.side_effect)) {
    return err('app.err.manifest.invalid', `Invalid side_effect: ${def.side_effect}`, path);
  }
  return { ok: true };
}

// §5.2 invariant: cursor:null + has_more:true is contradictory — receivers
// normalize to has_more:false and surface app.warn.state.pagination_inconsistent
// in meta.warnings (same normalization the strict client performs, TV-04).
function normalizePaginationInconsistent(manifest) {
  let inconsistent = false;
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if ((node.type === 'array' || node.type === 'table') && node.pagination) {
      const pag = node.pagination;
      if (pag.cursor === null && pag.has_more === true) {
        pag.has_more = false;
        inconsistent = true;
      }
    }
    if (node.type === 'object' && node.value && typeof node.value === 'object') {
      for (const v of Object.values(node.value)) walk(v);
    } else if (node.type === 'array' && Array.isArray(node.value)) {
      for (const v of node.value) walk(v);
    }
  };
  for (const n of Object.values(manifest.state ?? {})) walk(n);
  if (inconsistent) {
    const meta = (manifest.meta ??= {});
    const warnings = Array.isArray(meta.warnings) ? meta.warnings : (meta.warnings = []);
    warnings.push({
      code: 'app.warn.state.pagination_inconsistent',
      message: 'cursor null with has_more true',
    });
  }
}

/**
 * Validate a Page Manifest. Returns { ok: true, manifest } or { ok: false, code, message }.
 * Root `page_version` is ignored (non-authoritative).
 */
export function validateManifest(doc) {
  if (!doc || typeof doc !== 'object') {
    return err('app.err.manifest.invalid', 'Manifest must be an object');
  }
  const normalized = stripNonAuthoritativeRoot(doc);
  if (normalized.app !== APP_VERSION && normalized.app !== '1.1') {
    return err('app.err.version.unsupported', `Unsupported app version: ${normalized.app}`);
  }
  if (!normalized.page || typeof normalized.page !== 'object') {
    return err('app.err.manifest.invalid', 'page object required');
  }
  if (!normalized.page.id || !PAGE_ID_RE.test(normalized.page.id)) {
    return err('app.err.manifest.invalid', 'page.id invalid');
  }
  if (!normalized.page.url || typeof normalized.page.url !== 'string') {
    return err('app.err.manifest.invalid', 'page.url required');
  }
  // page.version is the sole semantic concurrency token (C1)
  if (normalized.page.version != null && typeof normalized.page.version !== 'string') {
    return err('app.err.manifest.invalid', 'page.version must be string');
  }
  if (
    !normalized.state ||
    typeof normalized.state !== 'object' ||
    Array.isArray(normalized.state)
  ) {
    return err('app.err.state.invalid_root', 'state object required');
  }
  const stateKeys = Object.keys(normalized.state);
  if (stateKeys.length > 512) {
    return err('app.err.state.object_too_large', 'state exceeds 512 keys');
  }
  for (const [key, node] of Object.entries(normalized.state)) {
    if (FORBIDDEN_OBJECT_KEYS.has(key) || !STATE_KEY_RE.test(key)) {
      return err('app.err.state.illegal_key', `Invalid state key: ${key}`, `/state/${key}`);
    }
    const r = validateStateNode(node, `/state/${key}`);
    if (!r.ok) return r;
  }
  if (normalized.actions != null) {
    if (typeof normalized.actions !== 'object' || Array.isArray(normalized.actions)) {
      return err('app.err.manifest.invalid', 'actions must be object');
    }
    const keys = Object.keys(normalized.actions);
    if (keys.length > 128) {
      return err('app.err.action.too_many', 'actions exceeds 128');
    }
    for (const [key, def] of Object.entries(normalized.actions)) {
      if (!ACTION_KEY_RE.test(key)) {
        return err('app.err.manifest.invalid', `Invalid action key: ${key}`);
      }
      const r = validateActionDef(def, `/actions/${key}`);
      if (!r.ok) return r;
    }
  }
  normalizePaginationInconsistent(normalized);
  return { ok: true, manifest: normalized };
}

export function validateDiffDocument(doc) {
  if (!doc || typeof doc !== 'object') {
    return err('app.err.diff.invalid', 'Diff must be an object');
  }
  const normalized = stripNonAuthoritativeRoot(doc);
  if (normalized.app !== APP_VERSION && normalized.app !== '1.1') {
    return err('app.err.version.unsupported', `Unsupported app version: ${normalized.app}`);
  }
  if (!normalized.base || typeof normalized.base !== 'object') {
    return err('app.err.diff.invalid', 'base required');
  }
  // base.version only - base.etag / result_etag abolished (C2)
  if (!normalized.base.page_id || !normalized.base.page_url || !normalized.base.version) {
    return err('app.err.diff.invalid', 'base.page_id/page_url/version required');
  }
  if (typeof normalized.result_version !== 'string') {
    return err('app.err.diff.invalid', 'result_version required');
  }
  if (!Array.isArray(normalized.diff)) {
    return err('app.err.diff.invalid', 'diff array required');
  }
  for (const op of normalized.diff) {
    if (!op || !PATCH_OPS.has(op.op)) {
      return err('app.err.diff.unsupported_op', `Unsupported op: ${op?.op}`);
    }
    // RFC 6902: add/replace/test carry a value; move/copy carry `from`.
    if ((op.op === 'add' || op.op === 'replace' || op.op === 'test') && !('value' in op)) {
      return err('app.err.diff.invalid', `Op ${op.op} requires value`, op.path);
    }
    if ((op.op === 'move' || op.op === 'copy') && !('from' in op)) {
      return err('app.err.diff.invalid', `Op ${op.op} requires from`, op.path);
    }
    if (!isAllowedDiffPath(op.path)) {
      return err('app.err.diff.invalid_path', `Diff path not allowed: ${op.path}`, op.path);
    }
    if ((op.op === 'move' || op.op === 'copy') && !isAllowedDiffPath(op.from)) {
      return err('app.err.diff.invalid_path', `Diff from path not allowed: ${op.from}`, op.from);
    }
  }
  return { ok: true, diffDoc: normalized };
}

export function validateErrorEnvelope(doc) {
  if (!doc || typeof doc !== 'object') {
    return err('app.err.payload.invalid_json', 'Error envelope must be object');
  }
  const e = doc.error;
  if (!e || typeof e !== 'object' || typeof e.code !== 'string') {
    return err('app.err.payload.invalid_json', 'error.code required');
  }
  return { ok: true, error: doc };
}

/**
 * Validate unknown response body by classification.
 */
export function validateAppDocument(doc) {
  const { kind, doc: classified } = classifyDocument(doc);
  switch (kind) {
    case 'manifest':
      return { kind, ...validateManifest(classified) };
    case 'diff':
      return { kind, ...validateDiffDocument(classified) };
    case 'error':
      return { kind, ...validateErrorEnvelope(classified) };
    default:
      return {
        kind: 'unknown',
        ok: false,
        code: 'app.err.manifest.invalid',
        message: 'Unrecognized APP document',
      };
  }
}

/**
 * Extract confirmation challenge string from a 428 error envelope (§10.4.2 Mode A).
 * details.confirmation_challenge is a string StateNode.
 */
export function extractConfirmationChallenge(errorDoc) {
  const details = errorDoc?.error?.details || errorDoc?.details;
  if (!details) return null;
  const node = details.confirmation_challenge;
  if (typeof node === 'string') return node;
  if (node && typeof node === 'object' && typeof node.value === 'string') return node.value;
  if (typeof errorDoc?.error?.confirmation_challenge === 'string') {
    return errorDoc.error.confirmation_challenge;
  }
  return null;
}

/** Authorization level from ActionDef (§10.4). Returns 0-4. */
export function confirmationLevel(actionDef) {
  if (!actionDef) return 0;
  const se = actionDef.side_effect || 'safe';
  let level = 0;
  if (se === 'destructive') level = 1;
  else if (se === 'financial') level = 2;
  else if (se === 'identity') level = 3;
  if (actionDef.requires_confirmation) {
    level = Math.max(level, 4);
  }
  return level;
}

export function needsConfirmation(actionDef) {
  return confirmationLevel(actionDef) > 0;
}

export { tableFieldKeys };
