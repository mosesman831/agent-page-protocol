/**
 * Minimal JSON Schema validator for MCP tool inputSchema (§10.19 -> -32602).
 * Covers the subset used by §10 schemas: type, required, additionalProperties,
 * enum, const, pattern, minLength/maxLength, minimum/maximum, maxProperties,
 * maxItems, propertyNames, items, properties, default (ignored).
 */

import type { JsonSchema } from './schemas.js';

export interface ValidationFailure {
  path: string;
  message: string;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  switch (t) {
    case 'object':
      return isObject(v);
    case 'array':
      return Array.isArray(v);
    case 'string':
      return typeof v === 'string';
    case 'integer':
      return typeof v === 'number' && Number.isInteger(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'null':
      return v === null;
    default:
      return true;
  }
}

function validateAgainst(
  schema: JsonSchema,
  value: unknown,
  path: string,
  failures: ValidationFailure[],
): void {
  if ('const' in schema && value !== schema.const) {
    failures.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
    return;
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    failures.push({ path, message: `expected one of ${JSON.stringify(schema.enum)}` });
    return;
  }

  if (typeof schema.type === 'string') {
    if (!matchesType(value, schema.type)) {
      failures.push({ path, message: `expected type ${schema.type}, got ${typeOf(value)}` });
      return;
    }
  } else if (Array.isArray(schema.type)) {
    if (!(schema.type as string[]).some((t) => matchesType(value, t))) {
      failures.push({
        path,
        message: `expected type ${JSON.stringify(schema.type)}, got ${typeOf(value)}`,
      });
      return;
    }
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      failures.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      failures.push({ path, message: `string longer than maxLength ${schema.maxLength}` });
    }
    if (typeof schema.pattern === 'string') {
      const re = new RegExp(schema.pattern);
      if (!re.test(value)) {
        failures.push({ path, message: `string does not match pattern ${schema.pattern}` });
      }
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      failures.push({ path, message: `number below minimum ${schema.minimum}` });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      failures.push({ path, message: `number above maximum ${schema.maximum}` });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      failures.push({ path, message: `array longer than maxItems ${schema.maxItems}` });
    }
    if (isObject(schema.items)) {
      value.forEach((item, i) =>
        validateAgainst(schema.items as JsonSchema, item, `${path}/${i}`, failures),
      );
    }
  }

  if (
    isObject(value) &&
    (schema.type === 'object' || schema.properties || schema.additionalProperties === false)
  ) {
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {};
    const required = (schema.required as string[] | undefined) ?? [];
    for (const key of required) {
      if (!(key in value)) {
        failures.push({
          path: path ? `${path}/${key}` : key,
          message: 'required property missing',
        });
      }
    }

    const keys = Object.keys(value);
    if (typeof schema.maxProperties === 'number' && keys.length > schema.maxProperties) {
      failures.push({
        path,
        message: `object has more than maxProperties ${schema.maxProperties}`,
      });
    }

    if (
      isObject(schema.propertyNames) &&
      typeof (schema.propertyNames as JsonSchema).pattern === 'string'
    ) {
      const re = new RegExp((schema.propertyNames as JsonSchema).pattern as string);
      for (const key of keys) {
        if (!re.test(key)) {
          failures.push({ path: key, message: `property name does not match pattern` });
        }
      }
    }

    for (const key of keys) {
      const childPath = path ? `${path}/${key}` : key;
      if (key in props) {
        validateAgainst(props[key], value[key], childPath, failures);
      } else if (schema.additionalProperties === false) {
        failures.push({ path: childPath, message: 'additional property not allowed' });
      } else if (isObject(schema.additionalProperties)) {
        validateAgainst(schema.additionalProperties as JsonSchema, value[key], childPath, failures);
      }
    }
  }
}

export function validateInput(
  schema: JsonSchema,
  value: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; failures: ValidationFailure[] } {
  const failures: ValidationFailure[] = [];
  if (value === undefined || value === null) {
    value = {};
  }
  if (!isObject(value)) {
    return { ok: false, failures: [{ path: '', message: 'arguments must be an object' }] };
  }
  validateAgainst(schema, value, '', failures);
  if (failures.length > 0) {
    return { ok: false, failures };
  }
  return { ok: true, value };
}
