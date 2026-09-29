/**
 * Optional --dynamic-tools projection (§10.18). Off by default.
 */

import type { JsonSchema } from './schemas.js';

export interface PageActionDef {
  id: string;
  description?: string;
  kind?: string;
  side_effect?: string;
  requires_confirmation?: boolean;
  idempotent?: boolean;
  auth?: string;
  input?: Record<string, unknown>;
  params?: Array<{
    name: string;
    type?: string;
    required?: boolean;
    enum?: unknown[];
    description?: string;
  }>;
}

export interface DynamicToolDef {
  name: string;
  description: string;
  actionId: string;
  pageId: string;
  inputSchema: JsonSchema;
}

/** Map non [a-z0-9_] to _. */
export function sanitizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

export function dynamicToolName(pageId: string, actionId: string): string {
  return `app_act__${sanitizeId(pageId)}__${sanitizeId(actionId)}`;
}

export function isDynamicActTool(name: string): boolean {
  return name.startsWith('app_act__');
}

export function parseDynamicActTool(name: string): { pageId: string; actionId: string } | null {
  if (!isDynamicActTool(name)) return null;
  const rest = name.slice('app_act__'.length);
  const idx = rest.lastIndexOf('__');
  if (idx <= 0) return null;
  return { pageId: rest.slice(0, idx), actionId: rest.slice(idx + 2) };
}

function paramTypeToSchema(p: {
  name: string;
  type?: string;
  required?: boolean;
  enum?: unknown[];
  description?: string;
}): JsonSchema {
  const base: JsonSchema = {};
  if (p.description) base.description = p.description;
  if (p.enum && p.enum.length > 0) {
    base.enum = p.enum;
    return base;
  }
  switch (p.type) {
    case 'number':
      base.type = 'number';
      break;
    case 'boolean':
      base.type = 'boolean';
      break;
    case 'array':
      base.type = 'array';
      break;
    case 'object':
      base.type = 'object';
      break;
    case 'date':
    case 'datetime':
    case 'string':
    default:
      base.type = 'string';
      break;
  }
  return base;
}

function actionParamsSchema(action: PageActionDef): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  if (Array.isArray(action.params)) {
    for (const p of action.params) {
      properties[p.name] = paramTypeToSchema(p);
      if (p.required) required.push(p.name);
    }
  } else if (action.input && typeof action.input === 'object') {
    const input = action.input as Record<string, unknown>;
    const props = (input.properties as Record<string, JsonSchema> | undefined) ?? {};
    for (const [k, v] of Object.entries(props)) {
      properties[k] = v;
    }
    if (Array.isArray(input.required)) {
      for (const r of input.required) {
        if (typeof r === 'string') required.push(r);
      }
    }
  }

  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      params: {
        type: 'object',
        additionalProperties: true,
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
      session: { type: 'string' },
      wait: { type: 'boolean', default: true },
      follow: { type: 'boolean', default: true },
    },
  };
}

export function buildDynamicTools(pageId: string, actions: PageActionDef[]): DynamicToolDef[] {
  const seen = new Set<string>();
  const out: DynamicToolDef[] = [];
  for (const action of actions) {
    const name = dynamicToolName(pageId, action.id);
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    const side = action.side_effect ?? 'safe';
    const conf = action.requires_confirmation ? ' confirmation_required' : '';
    const description = `${action.description ?? action.id} [${side}]${conf}`;
    out.push({
      name,
      description,
      actionId: action.id,
      pageId,
      inputSchema: actionParamsSchema(action),
    });
  }
  return out;
}
