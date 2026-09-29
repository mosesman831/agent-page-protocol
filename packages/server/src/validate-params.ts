/**
 * ParamDef validation per SPEC §6.3.
 */

import type { ParamDef, ValidationFailure, StateNode } from './types.js';
import { isRfc3339, isValidCalendarDate } from './validate-state.js';
import { detailString } from './errors.js';

const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MAX_PARAMS = 64;

export type ParamMode = 'strict' | 'lenient';

export interface ValidateParamsOptions {
  mode?: ParamMode;
  pathPrefix?: string;
}

function fail(
  code: string,
  message: string,
  path?: string,
  details?: Record<string, StateNode>,
): ValidationFailure {
  return { code, message, path, details };
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function validateOneParam(def: ParamDef, value: unknown, path: string): ValidationFailure | null {
  if (value === null) {
    if (def.nullable) return null;
    return fail('app.err.validation.param_type', 'Parameter must not be null', path, {
      expected: detailString(def.type, 'expected'),
      received: detailString('null', 'received'),
    });
  }

  switch (def.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return fail('app.err.validation.param_type', 'Parameter must be a string', path, {
          expected: detailString('string'),
          received: detailString(typeName(value)),
        });
      }
      if (def.min_length !== undefined && value.length < def.min_length) {
        return fail(
          'app.err.validation.param_range',
          `String shorter than min_length ${def.min_length}`,
          path,
        );
      }
      if (def.max_length !== undefined && value.length > def.max_length) {
        return fail(
          'app.err.validation.param_range',
          `String longer than max_length ${def.max_length}`,
          path,
        );
      }
      if (def.pattern) {
        try {
          const re = new RegExp(def.pattern);
          if (!re.test(value)) {
            return fail(
              'app.err.validation.param_pattern',
              'Parameter does not match pattern',
              path,
            );
          }
        } catch {
          return fail(
            'app.err.validation.param_pattern',
            'Invalid parameter pattern on server',
            path,
          );
        }
      }
      return null;
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be a finite number', path, {
          expected: detailString('number'),
          received: detailString(typeName(value)),
        });
      }
      if (def.min !== undefined && value < def.min) {
        return fail('app.err.validation.param_range', `Number below min ${def.min}`, path);
      }
      if (def.max !== undefined && value > def.max) {
        return fail('app.err.validation.param_range', `Number above max ${def.max}`, path);
      }
      return null;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        return fail('app.err.validation.param_type', 'Parameter must be a boolean', path, {
          expected: detailString('boolean'),
          received: detailString(typeName(value)),
        });
      }
      return null;
    }
    case 'date': {
      if (typeof value !== 'string') {
        return fail('app.err.validation.param_type', 'Parameter must be a date string', path, {
          expected: detailString('date'),
          received: detailString(typeName(value)),
        });
      }
      if (!DATE_RE.test(value) || !isValidCalendarDate(value)) {
        return fail(
          'app.err.validation.param_type',
          'Parameter must be a valid YYYY-MM-DD date',
          path,
        );
      }
      return null;
    }
    case 'datetime': {
      if (typeof value !== 'string') {
        return fail('app.err.validation.param_type', 'Parameter must be a datetime string', path, {
          expected: detailString('datetime'),
          received: detailString(typeName(value)),
        });
      }
      if (!isRfc3339(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be RFC 3339 datetime', path);
      }
      return null;
    }
    case 'enum': {
      if (typeof value !== 'string') {
        return fail('app.err.validation.param_type', 'Enum parameter must be a string', path, {
          expected: detailString('enum'),
          received: detailString(typeName(value)),
        });
      }
      if (!def.options || !def.options.includes(value)) {
        return fail('app.err.validation.param_enum', 'Parameter not in enum options', path);
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be an array', path, {
          expected: detailString('array'),
          received: detailString(typeName(value)),
        });
      }
      if (def.min_items !== undefined && value.length < def.min_items) {
        return fail(
          'app.err.validation.param_range',
          `Array shorter than min_items ${def.min_items}`,
          path,
        );
      }
      if (def.max_items !== undefined && value.length > def.max_items) {
        return fail(
          'app.err.validation.param_range',
          `Array longer than max_items ${def.max_items}`,
          path,
        );
      }
      if (!def.item_type) {
        return fail('app.err.validation.param_type', 'array ParamDef missing item_type', path);
      }
      for (let i = 0; i < value.length; i++) {
        const err = validateOneParam(def.item_type, value[i], `${path}/${i}`);
        if (err) return err;
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be an object', path, {
          expected: detailString('object'),
          received: detailString(typeName(value)),
        });
      }
      if (!def.properties) {
        return fail('app.err.validation.param_type', 'object ParamDef missing properties', path);
      }
      const obj = value as Record<string, unknown>;
      for (const [k, childDef] of Object.entries(def.properties)) {
        if (!(k in obj)) {
          if (childDef.required) {
            return fail(
              'app.err.validation.missing_param',
              `Missing required property ${k}`,
              `${path}/${k}`,
            );
          }
          continue;
        }
        const err = validateOneParam(childDef, obj[k], `${path}/${k}`);
        if (err) return err;
      }
      return null;
    }
    case 'geopoint': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be a geopoint object', path, {
          expected: detailString('geopoint'),
          received: detailString(typeName(value)),
        });
      }
      const g = value as Record<string, unknown>;
      if (typeof g.lat !== 'number' || !Number.isFinite(g.lat)) {
        return fail(
          'app.err.validation.param_type',
          'geopoint.lat must be a finite number',
          `${path}/lat`,
        );
      }
      if (g.lat < -90 || g.lat > 90) {
        return fail(
          'app.err.validation.param_range',
          'geopoint.lat must be within -90..90',
          `${path}/lat`,
        );
      }
      if (typeof g.lng !== 'number' || !Number.isFinite(g.lng)) {
        return fail(
          'app.err.validation.param_type',
          'geopoint.lng must be a finite number',
          `${path}/lng`,
        );
      }
      if (g.lng < -180 || g.lng > 180) {
        return fail(
          'app.err.validation.param_range',
          'geopoint.lng must be within -180..180',
          `${path}/lng`,
        );
      }
      if ('accuracy_m' in g) {
        if (
          typeof g.accuracy_m !== 'number' ||
          !Number.isFinite(g.accuracy_m) ||
          g.accuracy_m < 0
        ) {
          return fail(
            'app.err.validation.param_range',
            'accuracy_m must be >= 0',
            `${path}/accuracy_m`,
          );
        }
      }
      if (
        'label' in g &&
        (typeof g.label !== 'string' || g.label.length < 1 || g.label.length > 200)
      ) {
        return fail(
          'app.err.validation.param_range',
          'geopoint label must be 1-200 chars',
          `${path}/label`,
        );
      }
      return null;
    }
    case 'file': {
      if (typeof value === 'string') {
        if (value.length < 1 || value.length > 255 || /[/\\]/.test(value)) {
          return fail('app.err.validation.param_file', 'Invalid file name', path);
        }
        return null;
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(
          'app.err.validation.param_type',
          'file param must be an object or string',
          path,
          {
            expected: detailString('file'),
            received: detailString(typeName(value)),
          },
        );
      }
      const f = value as Record<string, unknown>;
      if (
        typeof f.file_id !== 'string' ||
        typeof f.name !== 'string' ||
        typeof f.mime !== 'string'
      ) {
        return fail('app.err.validation.param_file', 'file requires file_id, name, mime', path);
      }
      if (f.name.length < 1 || f.name.length > 255 || /[/\\]/.test(f.name)) {
        return fail('app.err.validation.param_file', 'Invalid file name', `${path}/name`);
      }
      if ('size' in f && (typeof f.size !== 'number' || !Number.isInteger(f.size) || f.size < 0)) {
        return fail('app.err.validation.param_file', 'Invalid file size', `${path}/size`);
      }
      if ('sha256' in f && (typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256))) {
        return fail('app.err.validation.param_file', 'Invalid sha256', `${path}/sha256`);
      }
      return null;
    }
    case 'date_range': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(
          'app.err.validation.param_type',
          'Parameter must be a date_range object',
          path,
          {
            expected: detailString('date_range'),
            received: detailString(typeName(value)),
          },
        );
      }
      const r = value as Record<string, unknown>;
      if (typeof r.from !== 'string' || !DATE_RE.test(r.from) || !isValidCalendarDate(r.from)) {
        return fail(
          'app.err.validation.param_type',
          'date_range.from must be YYYY-MM-DD',
          `${path}/from`,
        );
      }
      if (typeof r.to !== 'string' || !DATE_RE.test(r.to) || !isValidCalendarDate(r.to)) {
        return fail(
          'app.err.validation.param_type',
          'date_range.to must be YYYY-MM-DD',
          `${path}/to`,
        );
      }
      if (r.from > r.to) {
        return fail('app.err.validation.param_range', 'date_range from must be <= to', path);
      }
      return null;
    }
    case 'datetime_range': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail(
          'app.err.validation.param_type',
          'Parameter must be a datetime_range object',
          path,
          {
            expected: detailString('datetime_range'),
            received: detailString(typeName(value)),
          },
        );
      }
      const r = value as Record<string, unknown>;
      if (typeof r.from !== 'string' || !isRfc3339(r.from)) {
        return fail(
          'app.err.validation.param_type',
          'datetime_range.from must be RFC 3339 with offset',
          `${path}/from`,
        );
      }
      if (typeof r.to !== 'string' || !isRfc3339(r.to)) {
        return fail(
          'app.err.validation.param_type',
          'datetime_range.to must be RFC 3339 with offset',
          `${path}/to`,
        );
      }
      if (Date.parse(r.from) > Date.parse(r.to)) {
        return fail('app.err.validation.param_range', 'datetime_range from must be <= to', path);
      }
      return null;
    }
    case 'quantity': {
      let qtyValue: number;
      let unit: string | undefined;
      if (typeof value === 'number' && Number.isFinite(value)) {
        qtyValue = value;
        unit = def.unit;
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const q = value as Record<string, unknown>;
        if (typeof q.value !== 'number' || !Number.isFinite(q.value)) {
          return fail(
            'app.err.validation.param_type',
            'quantity.value must be a finite number',
            `${path}/value`,
          );
        }
        qtyValue = q.value;
        if (typeof q.unit !== 'string') {
          return fail(
            'app.err.validation.param_type',
            'quantity.unit must be a string',
            `${path}/unit`,
          );
        }
        unit = q.unit;
      } else {
        return fail('app.err.validation.param_type', 'Parameter must be a quantity object', path, {
          expected: detailString('quantity'),
          received: detailString(typeName(value)),
        });
      }
      if (def.scale !== undefined && !Number.isInteger(qtyValue)) {
        return fail(
          'app.err.validation.param_type',
          'quantity value with scale must be integer',
          `${path}/value`,
        );
      }
      if (def.min !== undefined && qtyValue < def.min) {
        return fail(
          'app.err.validation.param_range',
          `quantity below min ${def.min}`,
          `${path}/value`,
        );
      }
      if (def.max !== undefined && qtyValue > def.max) {
        return fail(
          'app.err.validation.param_range',
          `quantity above max ${def.max}`,
          `${path}/value`,
        );
      }
      const allowed = def.units;
      if (allowed && allowed.length > 0) {
        if (!unit || !allowed.includes(unit)) {
          return fail(
            'app.err.validation.param_unit',
            'quantity unit is not in the allowed list',
            `${path}/unit`,
          );
        }
      } else if (def.unit && unit && unit !== def.unit) {
        return fail(
          'app.err.validation.param_unit',
          'quantity unit does not match ParamDef.unit',
          `${path}/unit`,
        );
      }
      return null;
    }
    case 'money': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail('app.err.validation.param_type', 'Parameter must be a money object', path, {
          expected: detailString('money'),
          received: detailString(typeName(value)),
        });
      }
      const m = value as Record<string, unknown>;
      if (
        typeof m.amount !== 'number' ||
        !Number.isFinite(m.amount) ||
        !Number.isInteger(m.amount)
      ) {
        return fail(
          'app.err.validation.param_money',
          'money.amount must be an integer',
          `${path}/amount`,
        );
      }
      if (Math.abs(m.amount) > Number.MAX_SAFE_INTEGER) {
        return fail(
          'app.err.validation.param_money',
          'money.amount exceeds MAX_SAFE_INTEGER',
          `${path}/amount`,
        );
      }
      if (
        typeof m.scale !== 'number' ||
        !Number.isInteger(m.scale) ||
        m.scale < 0 ||
        m.scale > 18
      ) {
        return fail(
          'app.err.validation.param_money',
          'money.scale must be integer 0-18',
          `${path}/scale`,
        );
      }
      if (typeof m.currency !== 'string' || !/^[A-Z]{3}$/.test(m.currency)) {
        return fail(
          'app.err.validation.param_money',
          'money.currency must be ISO 4217',
          `${path}/currency`,
        );
      }
      if (def.currency && m.currency !== def.currency) {
        return fail(
          'app.err.validation.param_money',
          'money.currency does not match ParamDef',
          `${path}/currency`,
        );
      }
      if (def.scale !== undefined && m.scale !== def.scale) {
        return fail(
          'app.err.validation.param_money',
          'money.scale does not match ParamDef',
          `${path}/scale`,
        );
      }
      return null;
    }
    default:
      return fail(
        'app.err.validation.param_type',
        `Unknown ParamDef type: ${(def as ParamDef).type}`,
        path,
      );
  }
}

/**
 * Validate action params against ActionDef.input.
 * Returns { ok, params } with defaults applied, or a ValidationFailure.
 */
export function validateParams(
  inputDefs: Record<string, ParamDef> | undefined,
  rawParams: Record<string, unknown> | undefined,
  options: ValidateParamsOptions = {},
): { ok: true; params: Record<string, unknown> } | { ok: false; error: ValidationFailure } {
  const mode = options.mode ?? 'strict';
  const pathPrefix = options.pathPrefix ?? '/params';
  const defs = inputDefs ?? {};
  const params = { ...(rawParams ?? {}) };

  const keys = Object.keys(params);
  if (keys.length > MAX_PARAMS) {
    return {
      ok: false,
      error: fail(
        'app.err.validation.too_many_params',
        `Too many params (max ${MAX_PARAMS})`,
        pathPrefix,
      ),
    };
  }

  // 1. Unknown keys
  for (const key of keys) {
    if (!(key in defs)) {
      if (mode === 'strict') {
        return {
          ok: false,
          error: fail(
            'app.err.validation.unknown_param',
            `Unknown parameter: ${key}`,
            `${pathPrefix}/${key}`,
          ),
        };
      }
      delete params[key];
    }
  }

  // 2. Missing required + 3–5 type/enum/range + 6 defaults
  for (const [key, def] of Object.entries(defs)) {
    if (!(key in params)) {
      if (def.required) {
        return {
          ok: false,
          error: fail(
            'app.err.validation.missing_param',
            `Missing required parameter: ${key}`,
            `${pathPrefix}/${key}`,
          ),
        };
      }
      if ('default' in def) {
        params[key] = def.default;
      }
      continue;
    }
    const err = validateOneParam(def, params[key], `${pathPrefix}/${key}`);
    if (err) return { ok: false, error: err };
  }

  return { ok: true, params };
}

/**
 * Canonical JSON serialization of params (sorted keys, recursive).
 * Used for confirmation token binding (§10.4).
 */
export function canonicalizeParams(params: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(params));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortKeysDeep(obj[key]);
    }
    return out;
  }
  return value;
}
