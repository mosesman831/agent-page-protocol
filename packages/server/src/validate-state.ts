/**
 * StateNode validation per SPEC §5.3 (+ table support from §5.1.11).
 */

import type {
  AppProtocolVersion,
  OrderStatus,
  PaginationInfo,
  PaymentStatus,
  StateNode,
  TableFieldType,
  ValidationFailure,
} from './types.js';
import { ORDER_TRANSITIONS } from './types.js';

const STATE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ILLEGAL_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** §5.2#12: closed member sets per node type — servers MUST NOT emit extras. */
export const NODE_MEMBERS: Record<string, ReadonlySet<string>> = {
  string: new Set(['type', 'label', 'value', 'secret']),
  number: new Set(['type', 'label', 'value', 'min', 'max', 'scale', 'unit']),
  boolean: new Set(['type', 'label', 'value']),
  null: new Set(['type', 'label']),
  date: new Set(['type', 'label', 'value']),
  datetime: new Set(['type', 'label', 'value']),
  enum: new Set(['type', 'label', 'value', 'options', 'option_labels']),
  array: new Set(['type', 'label', 'value', 'item_label', 'pagination']),
  object: new Set(['type', 'label', 'value']),
  file: new Set(['type', 'label', 'value']),
  table: new Set(['type', 'label', 'value', 'fields', 'item_label', 'pagination']),
  geopoint: new Set(['type', 'label', 'value']),
  quantity: new Set(['type', 'label', 'value', 'scale']),
  order: new Set(['type', 'label', 'value']),
  daterange: new Set(['type', 'label', 'value']),
  datetimerange: new Set(['type', 'label', 'value']),
  embed: new Set(['type', 'label', 'url', 'description', 'sandbox', 'height']),
  markdown: new Set(['type', 'label', 'value']),
  media: new Set(['type', 'label', 'value']),
  tree: new Set(['type', 'label', 'value']),
};

export const PAGINATION_MEMBERS = new Set(['cursor', 'has_more', 'total']);
const TABLE_FIELD_TYPES = new Set<TableFieldType>([
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'file',
  'null',
  'any',
]);

const ORDER_STATUSES = new Set<string>(Object.keys(ORDER_TRANSITIONS));
const PAYMENT_STATUSES = new Set<string>([
  'unpaid',
  'requires_action',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
]);
const TABLE_FIELD_TYPES_11 = new Set<string>([
  ...TABLE_FIELD_TYPES,
  'geopoint',
  'quantity',
  'daterange',
  'datetimerange',
]);

export interface ValidateStateOptions {
  strictMode?: boolean;
  path?: string;
  /** When `1.0`, 1.1-only StateNode types are unknown (project first via project-v10). */
  selectedVersion?: AppProtocolVersion;
}

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

export function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [ys, ms, ds] = value.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** RFC 3339-ish datetime check (date + time + timezone offset or Z). */
export function isRfc3339(value: string): boolean {
  if (typeof value !== 'string' || value.length < 19) return false;
  // Basic shape: YYYY-MM-DDTHH:MM:SS[.fff](Z|±HH:MM)
  const re =
    /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/;
  if (!re.test(value)) return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function allUniqueStrings(arr: unknown[]): boolean {
  if (!arr.every((x) => typeof x === 'string')) return false;
  return new Set(arr as string[]).size === arr.length;
}

function validatePagination(pagination: unknown, path: string): ValidationFailure | null {
  if (pagination === undefined) return null;
  if (typeof pagination !== 'object' || pagination === null || Array.isArray(pagination)) {
    return fail('app.err.state.invalid_node', 'pagination must be an object', path);
  }
  const p = pagination as PaginationInfo;
  for (const k of Object.keys(p)) {
    if (ILLEGAL_KEYS.has(k) || !PAGINATION_MEMBERS.has(k)) {
      return fail(
        'app.err.state.invalid_node',
        `Unexpected pagination member: ${k}`,
        `${path}/${k}`,
      );
    }
  }
  if (!(typeof p.cursor === 'string' || p.cursor === null)) {
    return fail(
      'app.err.state.invalid_node',
      'pagination.cursor must be string or null',
      `${path}/cursor`,
    );
  }
  if (typeof p.has_more !== 'boolean') {
    return fail(
      'app.err.state.invalid_node',
      'pagination.has_more must be boolean',
      `${path}/has_more`,
    );
  }
  if (!(typeof p.total === 'number' || p.total === null)) {
    return fail(
      'app.err.state.invalid_node',
      'pagination.total must be number or null',
      `${path}/total`,
    );
  }
  if (typeof p.total === 'number' && !Number.isFinite(p.total)) {
    return fail(
      'app.err.state.number_overflow',
      'pagination.total must be finite',
      `${path}/total`,
    );
  }
  return null;
}

function cellMatchesFieldType(cell: unknown, fieldType: TableFieldType): boolean {
  switch (fieldType) {
    case 'string':
    case 'date':
    case 'datetime':
    case 'enum':
      return typeof cell === 'string';
    case 'number':
      return typeof cell === 'number' && Number.isFinite(cell);
    case 'boolean':
      return typeof cell === 'boolean';
    case 'null':
      return cell === null;
    case 'file':
      return typeof cell === 'object' && cell !== null && !Array.isArray(cell);
    case 'any':
      return true;
    default:
      return false;
  }
}

function validateTableNode(
  node: Record<string, unknown>,
  depth: number,
  path: string,
  selectedVersion?: AppProtocolVersion,
): ValidationFailure | null {
  const fields = node.fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    return fail('app.err.state.invalid_node', 'table.fields must be an object', `${path}/fields`);
  }
  const fieldKeys = Object.keys(fields as object);
  if (fieldKeys.length === 0 || fieldKeys.length > 128) {
    return fail(
      'app.err.state.invalid_node',
      'table.fields must have 1–128 entries',
      `${path}/fields`,
    );
  }
  for (const key of fieldKeys) {
    if (ILLEGAL_KEYS.has(key) || !STATE_KEY_RE.test(key)) {
      return fail(
        'app.err.state.illegal_key',
        `Illegal table field key: ${key}`,
        `${path}/fields/${key}`,
      );
    }
    const ft = (fields as Record<string, unknown>)[key];
    const allowed = selectedVersion === '1.0' ? TABLE_FIELD_TYPES : TABLE_FIELD_TYPES_11;
    if (typeof ft !== 'string' || !allowed.has(ft as TableFieldType)) {
      return fail(
        'app.err.state.invalid_node',
        `Invalid table field type for ${key}`,
        `${path}/fields/${key}`,
      );
    }
  }

  const value = node.value;
  if (!Array.isArray(value)) {
    return fail('app.err.state.invalid_node', 'table.value must be an array', `${path}/value`);
  }
  if (value.length > 10000) {
    return fail('app.err.state.array_too_long', 'table.value exceeds 10000 rows', `${path}/value`);
  }

  const expectedLen = fieldKeys.length;
  const fieldTypes = fieldKeys.map((k) => (fields as Record<string, TableFieldType>)[k]);

  for (let i = 0; i < value.length; i++) {
    const row = value[i];
    if (!Array.isArray(row)) {
      return fail('app.err.state.invalid_node', 'table row must be an array', `${path}/value/${i}`);
    }
    if (row.length !== expectedLen) {
      return fail(
        'app.err.state.invalid_node',
        `table row length ${row.length} != fields count ${expectedLen}`,
        `${path}/value/${i}`,
      );
    }
    for (let c = 0; c < row.length; c++) {
      if (!cellMatchesFieldType(row[c], fieldTypes[c]!)) {
        return fail(
          'app.err.state.invalid_node',
          `table cell type mismatch for field ${fieldKeys[c]}`,
          `${path}/value/${i}/${c}`,
        );
      }
      // Extra date/datetime validation for string cells
      if (fieldTypes[c] === 'date' && typeof row[c] === 'string') {
        if (!isValidCalendarDate(row[c] as string)) {
          return fail(
            'app.err.state.invalid_date',
            'Invalid table date cell',
            `${path}/value/${i}/${c}`,
          );
        }
      }
      if (fieldTypes[c] === 'datetime' && typeof row[c] === 'string') {
        if (!isRfc3339(row[c] as string)) {
          return fail(
            'app.err.state.invalid_datetime',
            'Invalid table datetime cell',
            `${path}/value/${i}/${c}`,
          );
        }
      }
    }
  }

  const pagErr = validatePagination(node.pagination, `${path}/pagination`);
  if (pagErr) return pagErr;

  // depth is consumed for consistency with nested types; tables are leaf-ish
  void depth;
  return null;
}

/**
 * Validate a single StateNode. Returns null on success, ValidationFailure on error.
 */
function validateGeoPoint(n: Record<string, unknown>, path: string): ValidationFailure | null {
  const v = n.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return fail(
      'app.err.state.invalid_geopoint',
      'geopoint value must be an object',
      `${path}/value`,
    );
  }
  const gv = v as Record<string, unknown>;
  if (typeof gv.lat !== 'number' || !Number.isFinite(gv.lat) || gv.lat < -90 || gv.lat > 90) {
    return fail(
      'app.err.state.invalid_geopoint',
      'lat must be finite and within -90..90',
      `${path}/value/lat`,
    );
  }
  if (typeof gv.lng !== 'number' || !Number.isFinite(gv.lng) || gv.lng < -180 || gv.lng > 180) {
    return fail(
      'app.err.state.invalid_geopoint',
      'lng must be finite and within -180..180',
      `${path}/value/lng`,
    );
  }
  if ('accuracy_m' in gv) {
    if (typeof gv.accuracy_m !== 'number' || !Number.isFinite(gv.accuracy_m) || gv.accuracy_m < 0) {
      return fail(
        'app.err.state.invalid_geopoint',
        'accuracy_m must be a finite number >= 0',
        `${path}/value/accuracy_m`,
      );
    }
  }
  if (
    'label' in gv &&
    (typeof gv.label !== 'string' || gv.label.length < 1 || gv.label.length > 200)
  ) {
    return fail('app.err.state.invalid_geopoint', 'invalid geopoint label', `${path}/value/label`);
  }
  return null;
}

const HTTPS_URL_RE = /^https:\/\/[\s\S]{0,2044}$/;
const EMBED_SANDBOX_FLAGS = new Set(['scripts', 'forms', 'popups', 'same-origin']);
const MEDIA_KINDS = new Set(['image', 'video', 'audio']);
const TREE_ID_RE = /^[a-z0-9_-]{1,64}$/;

function validateEmbed(n: Record<string, unknown>, path: string): ValidationFailure | null {
  if (typeof n.url !== 'string' || !HTTPS_URL_RE.test(n.url)) {
    return fail('app.err.state.invalid_embed', 'embed url must be an https URI', `${path}/url`);
  }
  if (typeof n.description !== 'string' || n.description.length < 1 || n.description.length > 512) {
    return fail(
      'app.err.state.invalid_embed',
      'embed requires description (1..512 chars)',
      `${path}/description`,
    );
  }
  if ('sandbox' in n) {
    const sb = n.sandbox;
    if (
      !Array.isArray(sb) ||
      sb.length > 4 ||
      !sb.every((f) => typeof f === 'string' && EMBED_SANDBOX_FLAGS.has(f))
    ) {
      return fail(
        'app.err.state.invalid_embed',
        'sandbox must be a subset of scripts/forms/popups/same-origin',
        `${path}/sandbox`,
      );
    }
    if (new Set(sb).size !== sb.length) {
      return fail('app.err.state.invalid_embed', 'sandbox flags must be unique', `${path}/sandbox`);
    }
  }
  if ('height' in n) {
    if (
      typeof n.height !== 'number' ||
      !Number.isInteger(n.height) ||
      n.height < 16 ||
      n.height > 2000
    ) {
      return fail(
        'app.err.state.invalid_embed',
        'height must be an integer in 16..2000',
        `${path}/height`,
      );
    }
  }
  return null;
}

function validateMarkdown(n: Record<string, unknown>, path: string): ValidationFailure | null {
  if (typeof n.value !== 'string' || n.value.length > 65536) {
    return fail(
      'app.err.state.invalid_markdown',
      'markdown value must be a string <= 65536 chars',
      `${path}/value`,
    );
  }
  return null;
}

function validateMediaItem(item: unknown, path: string): ValidationFailure | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return fail('app.err.state.invalid_media', 'media item must be an object', path);
  }
  const it = item as Record<string, unknown>;
  if (typeof it.url !== 'string' || !HTTPS_URL_RE.test(it.url)) {
    return fail(
      'app.err.state.invalid_media',
      'media item url must be an https URI',
      `${path}/url`,
    );
  }
  if ('alt' in it && (typeof it.alt !== 'string' || it.alt.length > 256)) {
    return fail('app.err.state.invalid_media', 'alt must be a string <= 256', `${path}/alt`);
  }
  if ('kind' in it && (typeof it.kind !== 'string' || !MEDIA_KINDS.has(it.kind))) {
    return fail('app.err.state.invalid_media', 'kind must be image|video|audio', `${path}/kind`);
  }
  for (const k of Object.keys(it)) {
    if (k !== 'url' && k !== 'alt' && k !== 'kind') {
      return fail(
        'app.err.state.invalid_media',
        `Unexpected media item member: ${k}`,
        `${path}/${k}`,
      );
    }
  }
  return null;
}

function validateMedia(n: Record<string, unknown>, path: string): ValidationFailure | null {
  if (!Array.isArray(n.value)) {
    return fail('app.err.state.invalid_media', 'media value must be an array', `${path}/value`);
  }
  if (n.value.length > 256) {
    return fail('app.err.state.invalid_media', 'media exceeds 256 items', `${path}/value`);
  }
  for (let i = 0; i < n.value.length; i++) {
    const err = validateMediaItem(n.value[i], `${path}/value/${i}`);
    if (err) return err;
  }
  return null;
}

function validateTreeItems(items: unknown, depth: number, path: string): ValidationFailure | null {
  if (!Array.isArray(items) || items.length > 512) {
    return fail('app.err.state.invalid_tree', 'tree value must be an array <= 512 items', path);
  }
  if (depth > 16) {
    return fail('app.err.state.invalid_tree', 'tree nesting depth exceeded 16', path);
  }
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Record<string, unknown>;
    const ip = `${path}/${i}`;
    if (typeof it !== 'object' || it === null || Array.isArray(it)) {
      return fail('app.err.state.invalid_tree', 'tree item must be an object', ip);
    }
    if (typeof it.id !== 'string' || !TREE_ID_RE.test(it.id)) {
      return fail(
        'app.err.state.invalid_tree',
        'tree item id must match ^[a-z0-9_-]{1,64}$',
        `${ip}/id`,
      );
    }
    if (typeof it.label !== 'string' || it.label.length < 1 || it.label.length > 128) {
      return fail(
        'app.err.state.invalid_tree',
        'tree item label must be 1..128 chars',
        `${ip}/label`,
      );
    }
    for (const k of Object.keys(it)) {
      if (k !== 'id' && k !== 'label' && k !== 'children') {
        return fail(
          'app.err.state.invalid_tree',
          `Unexpected tree item member: ${k}`,
          `${ip}/${k}`,
        );
      }
    }
    if ('children' in it) {
      const err = validateTreeItems(it.children, depth + 1, `${ip}/children`);
      if (err) return err;
    }
  }
  return null;
}

function validateTree(n: Record<string, unknown>, path: string): ValidationFailure | null {
  return validateTreeItems(n.value, 1, `${path}/value`);
}

function validateQuantity(n: Record<string, unknown>, path: string): ValidationFailure | null {
  const v = n.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return fail(
      'app.err.state.invalid_quantity',
      'quantity value must be an object',
      `${path}/value`,
    );
  }
  const qv = v as Record<string, unknown>;
  if (typeof qv.value !== 'number' || !Number.isFinite(qv.value)) {
    return fail(
      'app.err.state.invalid_quantity',
      'quantity.value must be a finite number',
      `${path}/value/value`,
    );
  }
  if (
    typeof qv.unit !== 'string' ||
    qv.unit.length < 1 ||
    qv.unit.length > 32 ||
    !/^[A-Za-z0-9_/%]+$/.test(qv.unit)
  ) {
    return fail(
      'app.err.state.invalid_quantity',
      'quantity.unit must match ^[A-Za-z0-9_/%]+$ (1-32 chars)',
      `${path}/value/unit`,
    );
  }
  if ('scale' in n) {
    if (typeof n.scale !== 'number' || !Number.isInteger(n.scale) || (n.scale as number) < 0) {
      return fail('app.err.state.invalid_quantity', 'scale must be integer >= 0', `${path}/scale`);
    }
    if (!Number.isInteger(qv.value)) {
      return fail(
        'app.err.state.invalid_quantity',
        'quantity with scale must have integer value',
        `${path}/value/value`,
      );
    }
  }
  return null;
}

function validateOrder(n: Record<string, unknown>, path: string): ValidationFailure | null {
  const v = n.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return fail('app.err.state.invalid_node', 'order value must be an object', `${path}/value`);
  }
  const ov = v as Record<string, unknown>;
  if (typeof ov.id !== 'string' || ov.id.length < 1) {
    return fail('app.err.state.invalid_node', 'order.id is required', `${path}/value/id`);
  }
  if (typeof ov.status !== 'string' || !ORDER_STATUSES.has(ov.status)) {
    return fail(
      'app.err.state.invalid_node',
      'order.status is not a known status',
      `${path}/value/status`,
    );
  }
  void (ov.status as OrderStatus);
  if (ov.total !== undefined) {
    if (typeof ov.total !== 'number' || !Number.isInteger(ov.total)) {
      return fail(
        'app.err.state.invalid_node',
        'order.total must be integer minor units',
        `${path}/value/total`,
      );
    }
    if (typeof ov.scale !== 'number' || !Number.isInteger(ov.scale) || ov.scale < 0) {
      return fail(
        'app.err.state.invalid_node',
        'order.scale is required when total is present',
        `${path}/value/scale`,
      );
    }
    if (typeof ov.currency !== 'string' || ov.currency.length < 1) {
      return fail(
        'app.err.state.invalid_node',
        'order.currency is required when total is present',
        `${path}/value/currency`,
      );
    }
  }
  if (ov.items !== undefined) {
    if (!Array.isArray(ov.items) || ov.items.length > 128) {
      return fail(
        'app.err.state.invalid_node',
        'order.items must be an array of at most 128',
        `${path}/value/items`,
      );
    }
  }
  if (ov.payment !== undefined) {
    if (typeof ov.payment !== 'object' || ov.payment === null || Array.isArray(ov.payment)) {
      return fail(
        'app.err.state.invalid_node',
        'order.payment must be an object',
        `${path}/value/payment`,
      );
    }
    const pay = ov.payment as Record<string, unknown>;
    if (typeof pay.status !== 'string' || !PAYMENT_STATUSES.has(pay.status)) {
      return fail(
        'app.err.state.invalid_node',
        'invalid payment.status',
        `${path}/value/payment/status`,
      );
    }
    void (pay.status as PaymentStatus);
  }
  if (
    ov.created_at !== undefined &&
    (typeof ov.created_at !== 'string' || !isRfc3339(ov.created_at))
  ) {
    return fail(
      'app.err.state.invalid_datetime',
      'order.created_at must be RFC 3339',
      `${path}/value/created_at`,
    );
  }
  if (
    ov.updated_at !== undefined &&
    (typeof ov.updated_at !== 'string' || !isRfc3339(ov.updated_at))
  ) {
    return fail(
      'app.err.state.invalid_datetime',
      'order.updated_at must be RFC 3339',
      `${path}/value/updated_at`,
    );
  }
  return null;
}

function validateDateRange(
  n: Record<string, unknown>,
  path: string,
  datetime: boolean,
): ValidationFailure | null {
  const v = n.value;
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return fail('app.err.state.invalid_range', 'range value must be an object', `${path}/value`);
  }
  const rv = v as Record<string, unknown>;
  if (typeof rv.from !== 'string' || typeof rv.to !== 'string') {
    return fail(
      'app.err.state.invalid_range',
      'range requires from and to strings',
      `${path}/value`,
    );
  }
  if (datetime) {
    if (!isRfc3339(rv.from)) {
      return fail(
        'app.err.state.invalid_datetime',
        'range.from must be RFC 3339 with offset',
        `${path}/value/from`,
      );
    }
    if (!isRfc3339(rv.to)) {
      return fail(
        'app.err.state.invalid_datetime',
        'range.to must be RFC 3339 with offset',
        `${path}/value/to`,
      );
    }
    if (Date.parse(rv.from) > Date.parse(rv.to)) {
      return fail('app.err.state.invalid_range', 'range from must be <= to', `${path}/value`);
    }
  } else {
    if (!DATE_RE.test(rv.from) || !isValidCalendarDate(rv.from)) {
      return fail(
        'app.err.state.invalid_date',
        'range.from is not a valid date',
        `${path}/value/from`,
      );
    }
    if (!DATE_RE.test(rv.to) || !isValidCalendarDate(rv.to)) {
      return fail('app.err.state.invalid_date', 'range.to is not a valid date', `${path}/value/to`);
    }
    if (rv.from > rv.to) {
      return fail('app.err.state.invalid_range', 'range from must be <= to', `${path}/value`);
    }
  }
  return null;
}

export function validateStateNode(
  node: unknown,
  depth = 0,
  strictMode = true,
  path = '/state',
  selectedVersion?: AppProtocolVersion,
): ValidationFailure | null {
  if (depth > 32) {
    return fail('app.err.state.depth_exceeded', 'Nested StateNode depth exceeded 32', path);
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    return fail('app.err.state.invalid_node', 'StateNode must be a non-null object', path);
  }

  const n = node as Record<string, unknown>;
  if (typeof n.type !== 'string') {
    return fail('app.err.state.invalid_node', 'StateNode.type must be a string', path);
  }

  // §5.2#7/#12: forbidden keys and closed member sets anywhere under /state.
  const allowed = NODE_MEMBERS[n.type];
  for (const k of Object.keys(n)) {
    if (ILLEGAL_KEYS.has(k)) {
      return fail('app.err.state.invalid_node', `Forbidden key: ${k}`, `${path}/${k}`);
    }
    if (allowed && !allowed.has(k)) {
      return fail(
        'app.err.state.invalid_node',
        `Unexpected member ${k} on ${n.type} node`,
        `${path}/${k}`,
      );
    }
  }

  switch (n.type) {
    case 'string': {
      if (typeof n.value !== 'string') {
        return fail('app.err.state.invalid_node', 'string value must be a string', `${path}/value`);
      }
      if (utf8ByteLength(n.value) > 65536) {
        return fail('app.err.state.string_too_long', 'string value exceeds 64KiB', `${path}/value`);
      }
      if ('secret' in n && typeof n.secret !== 'boolean') {
        return fail('app.err.state.invalid_node', 'secret must be boolean', `${path}/secret`);
      }
      return null;
    }
    case 'number': {
      if (typeof n.value !== 'number') {
        return fail('app.err.state.invalid_node', 'number value must be a number', `${path}/value`);
      }
      if (!Number.isFinite(n.value)) {
        return fail(
          'app.err.state.number_overflow',
          'number value must be finite',
          `${path}/value`,
        );
      }
      // C7 / §5.2: Integers with |v| > Number.MAX_SAFE_INTEGER (2^53−1) MUST fail.
      if (Number.isInteger(n.value) && Math.abs(n.value) > Number.MAX_SAFE_INTEGER) {
        return fail(
          'app.err.state.number_precision',
          'Integer exceeds Number.MAX_SAFE_INTEGER (2^53-1)',
          `${path}/value`,
        );
      }
      // Normalize -0 → 0 for emit checks (treat as valid input).
      if (Object.is(n.value, -0)) {
        (n as { value: number }).value = 0;
      }
      if ('unit' in n && (typeof n.unit !== 'string' || (n.unit as string).length > 32)) {
        return fail('app.err.state.invalid_node', 'invalid unit', `${path}/unit`);
      }
      if ('scale' in n) {
        if (typeof n.scale !== 'number' || !Number.isInteger(n.scale) || (n.scale as number) < 0) {
          return fail('app.err.state.invalid_node', 'scale must be integer >= 0', `${path}/scale`);
        }
        // Money with scale MUST be integer value (invariant 10 / §5.2#4).
        if (!Number.isInteger(n.value)) {
          return fail(
            'app.err.state.invalid_node',
            'number with scale must have integer value (minor units)',
            `${path}/value`,
          );
        }
      }
      return null;
    }
    case 'boolean': {
      if (typeof n.value !== 'boolean') {
        return fail('app.err.state.invalid_node', 'boolean value must be boolean', `${path}/value`);
      }
      return null;
    }
    case 'null': {
      if ('value' in n) {
        return fail('app.err.state.invalid_node', 'null node must not have value', path);
      }
      return null;
    }
    case 'date': {
      if (typeof n.value !== 'string') {
        return fail('app.err.state.invalid_node', 'date value must be string', `${path}/value`);
      }
      if (!DATE_RE.test(n.value) || !isValidCalendarDate(n.value)) {
        return fail('app.err.state.invalid_date', 'Invalid calendar date', `${path}/value`);
      }
      return null;
    }
    case 'datetime': {
      if (typeof n.value !== 'string') {
        return fail('app.err.state.invalid_node', 'datetime value must be string', `${path}/value`);
      }
      if (!isRfc3339(n.value)) {
        return fail('app.err.state.invalid_datetime', 'Invalid RFC 3339 datetime', `${path}/value`);
      }
      return null;
    }
    case 'enum': {
      if (!Array.isArray(n.options) || n.options.length < 1 || n.options.length > 256) {
        return fail('app.err.state.invalid_enum', 'enum.options invalid', `${path}/options`);
      }
      if (!allUniqueStrings(n.options)) {
        return fail(
          'app.err.state.invalid_enum',
          'enum.options must be unique strings',
          `${path}/options`,
        );
      }
      for (const opt of n.options) {
        if (typeof opt !== 'string' || opt.length < 1 || opt.length > 128) {
          return fail(
            'app.err.state.invalid_enum',
            'enum option length invalid',
            `${path}/options`,
          );
        }
      }
      if (typeof n.value !== 'string' || !(n.options as string[]).includes(n.value)) {
        return fail('app.err.state.invalid_enum', 'enum value not in options', `${path}/value`);
      }
      if (n.option_labels !== undefined) {
        if (
          typeof n.option_labels !== 'object' ||
          n.option_labels === null ||
          Array.isArray(n.option_labels)
        ) {
          return fail(
            'app.err.state.invalid_enum',
            'enum.option_labels must be an object',
            `${path}/option_labels`,
          );
        }
        if (Object.keys(n.option_labels).length > 256) {
          return fail(
            'app.err.state.invalid_enum',
            'enum.option_labels exceeds 256 entries',
            `${path}/option_labels`,
          );
        }
        for (const [k, lbl] of Object.entries(n.option_labels as Record<string, unknown>)) {
          if (!(n.options as string[]).includes(k)) {
            return fail(
              'app.err.state.invalid_enum',
              'enum.option_labels key not in options',
              `${path}/option_labels`,
            );
          }
          if (typeof lbl !== 'string' || lbl.length < 1 || lbl.length > 200) {
            return fail(
              'app.err.state.invalid_enum',
              'enum.option_labels values must be strings 1-200 chars',
              `${path}/option_labels`,
            );
          }
        }
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(n.value)) {
        return fail('app.err.state.invalid_node', 'array value must be an array', `${path}/value`);
      }
      if (n.value.length > 10000) {
        return fail('app.err.state.array_too_long', 'array exceeds 10000 items', `${path}/value`);
      }
      for (let i = 0; i < n.value.length; i++) {
        const err = validateStateNode(
          n.value[i],
          depth + 1,
          strictMode,
          `${path}/value/${i}`,
          selectedVersion,
        );
        if (err) return err;
      }
      const pagErr = validatePagination(n.pagination, `${path}/pagination`);
      if (pagErr) return pagErr;
      return null;
    }
    case 'object': {
      if (typeof n.value !== 'object' || n.value === null || Array.isArray(n.value)) {
        return fail(
          'app.err.state.invalid_node',
          'object value must be a plain object',
          `${path}/value`,
        );
      }
      const keys = Object.keys(n.value as object);
      if (keys.length > 512) {
        return fail('app.err.state.object_too_large', 'object exceeds 512 keys', `${path}/value`);
      }
      for (const key of keys) {
        if (ILLEGAL_KEYS.has(key) || !STATE_KEY_RE.test(key)) {
          return fail('app.err.state.illegal_key', `Illegal key: ${key}`, `${path}/value/${key}`);
        }
        const err = validateStateNode(
          (n.value as Record<string, unknown>)[key],
          depth + 1,
          strictMode,
          `${path}/value/${key}`,
          selectedVersion,
        );
        if (err) return err;
      }
      return null;
    }
    case 'file': {
      const v = n.value;
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return fail('app.err.state.invalid_file', 'file value must be an object', `${path}/value`);
      }
      const fv = v as Record<string, unknown>;
      if (
        typeof fv.url !== 'string' ||
        typeof fv.name !== 'string' ||
        typeof fv.mime !== 'string'
      ) {
        return fail('app.err.state.invalid_file', 'file requires url, name, mime', `${path}/value`);
      }
      if (fv.name.length < 1 || fv.name.length > 255 || /[/\\]/.test(fv.name)) {
        return fail('app.err.state.invalid_file', 'invalid file name', `${path}/value/name`);
      }
      if ('size' in fv) {
        if (typeof fv.size !== 'number' || !Number.isInteger(fv.size) || fv.size < 0) {
          return fail('app.err.state.invalid_file', 'invalid file size', `${path}/value/size`);
        }
      }
      if ('sha256' in fv) {
        if (typeof fv.sha256 !== 'string' || !SHA256_RE.test(fv.sha256)) {
          return fail('app.err.state.invalid_file', 'invalid sha256', `${path}/value/sha256`);
        }
      }
      return null;
    }
    case 'table':
      return validateTableNode(n, depth, path, selectedVersion);
    case 'geopoint':
    case 'quantity':
    case 'order':
    case 'daterange':
    case 'datetimerange': {
      if (selectedVersion === '1.0') {
        if (strictMode) {
          return fail('app.err.state.unknown_type', `Unknown StateNode type: ${n.type}`, path);
        }
        return null;
      }
      if (n.type === 'geopoint') return validateGeoPoint(n, path);
      if (n.type === 'quantity') return validateQuantity(n, path);
      if (n.type === 'order') return validateOrder(n, path);
      return validateDateRange(n, path, n.type === 'datetimerange');
    }
    case 'embed':
    case 'markdown':
    case 'media':
    case 'tree': {
      if (selectedVersion === '1.0') {
        if (strictMode) {
          return fail('app.err.state.unknown_type', `Unknown StateNode type: ${n.type}`, path);
        }
        return null;
      }
      if (n.type === 'embed') return validateEmbed(n, path);
      if (n.type === 'markdown') return validateMarkdown(n, path);
      if (n.type === 'media') return validateMedia(n, path);
      return validateTree(n, path);
    }
    default: {
      if (strictMode) {
        return fail('app.err.state.unknown_type', `Unknown StateNode type: ${n.type}`, path);
      }
      return null;
    }
  }
}

/**
 * Validate `/state` root map (SPEC §5.2).
 */
export function validateStateRoot(
  state: unknown,
  options: ValidateStateOptions = {},
): ValidationFailure | null {
  const path = options.path ?? '/state';
  const strictMode = options.strictMode ?? true;
  const selectedVersion = options.selectedVersion;

  if (state === null) {
    return fail('app.err.manifest.invalid', '/state must not be null', path);
  }
  if (typeof state !== 'object' || Array.isArray(state)) {
    return fail('app.err.manifest.invalid', '/state must be an object', path);
  }
  // SPEC: manifest.json caps /state at maxProperties 512 (same cap as
  // nested object values below)
  if (Object.keys(state as object).length > 512) {
    return fail('app.err.state.object_too_large', 'state exceeds 512 keys', path);
  }

  for (const key of Object.keys(state as object)) {
    if (ILLEGAL_KEYS.has(key) || !STATE_KEY_RE.test(key)) {
      return fail('app.err.state.illegal_key', `Illegal state key: ${key}`, `${path}/${key}`);
    }
    const err = validateStateNode(
      (state as Record<string, unknown>)[key],
      0,
      strictMode,
      `${path}/${key}`,
      selectedVersion,
    );
    if (err) return err;
  }
  return null;
}

export function assertValidStateNode(
  node: unknown,
  strictMode = true,
  path = '/state',
): asserts node is StateNode {
  const err = validateStateNode(node, 0, strictMode, path);
  if (err) {
    const e = new Error(err.message) as Error & { code: string; path?: string };
    e.code = err.code;
    e.path = err.path;
    throw e;
  }
}
