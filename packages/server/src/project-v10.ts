/**
 * 1.0 projection map (SPEC §2.5). MUST when selected version is 1.0.
 * Preserve money integer+scale. Do not invent HTML.
 */

import {
  ORDER_TRANSITIONS,
  type ActionDef,
  type ErrorEnvelope,
  type PageManifest,
  type ParamDef,
  type StateNode,
} from './types.js';

const V11_STATE_TYPES = new Set([
  'geopoint',
  'quantity',
  'order',
  'daterange',
  'datetimerange',
  'embed',
  'markdown',
  'media',
  'tree',
]);

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}

export function projectStateNodeToV10(node: StateNode): StateNode {
  const n = node as StateNode & Record<string, unknown>;
  switch (n.type) {
    case 'geopoint': {
      const v = n.value as { lat: number; lng: number; accuracy_m?: number; label?: string };
      const value: Record<string, StateNode> = {
        lat: { type: 'number', value: v.lat },
        lng: { type: 'number', value: v.lng },
      };
      if (v.accuracy_m !== undefined) value.accuracy_m = { type: 'number', value: v.accuracy_m };
      if (v.label !== undefined) value.label = { type: 'string', value: v.label };
      const out: StateNode = { type: 'object', value };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'quantity': {
      const v = n.value as { value: number; unit: string };
      const out: StateNode = {
        type: 'number',
        value: v.value,
        unit: v.unit,
      };
      if (typeof n.scale === 'number') (out as { scale?: number }).scale = n.scale as number;
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'order': {
      const v = n.value as {
        id: string;
        status: string;
        currency?: string;
        total?: number;
        scale?: number;
        items?: unknown;
        payment?: { status: string; psp?: string; start_url?: string };
        created_at?: string;
        updated_at?: string;
      };
      const value: Record<string, StateNode> = {
        id: { type: 'string', value: v.id },
        status: {
          type: 'enum',
          value: v.status,
          options: Object.keys(ORDER_TRANSITIONS),
        },
      };
      if (v.total !== undefined) {
        const money: StateNode = { type: 'number', value: v.total };
        if (typeof v.scale === 'number') (money as { scale?: number }).scale = v.scale;
        if (v.currency) (money as { unit?: string }).unit = v.currency;
        value.total = money;
      }
      if (v.currency) value.currency = { type: 'string', value: v.currency };
      if (v.created_at) value.created_at = { type: 'datetime', value: v.created_at };
      if (v.updated_at) value.updated_at = { type: 'datetime', value: v.updated_at };
      if (v.payment) {
        value.payment = {
          type: 'object',
          value: {
            status: { type: 'string', value: v.payment.status },
            ...(v.payment.psp ? { psp: { type: 'string' as const, value: v.payment.psp } } : {}),
            ...(v.payment.start_url
              ? { start_url: { type: 'string' as const, value: v.payment.start_url } }
              : {}),
          },
        };
      }
      const out: StateNode = { type: 'object', value };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'daterange': {
      const v = n.value as { from: string; to: string };
      const out: StateNode = {
        type: 'object',
        value: {
          from: { type: 'date', value: v.from },
          to: { type: 'date', value: v.to },
        },
      };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'datetimerange': {
      const v = n.value as { from: string; to: string };
      const out: StateNode = {
        type: 'object',
        value: {
          from: { type: 'datetime', value: v.from },
          to: { type: 'datetime', value: v.to },
        },
      };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'embed': {
      // Opaque iframe → its declared agent-facing members only (SPEC-WEB-NODES).
      const out: StateNode = {
        type: 'object',
        value: {
          url: { type: 'string', value: String(n.url ?? '') },
          description: { type: 'string', value: String(n.description ?? '') },
        },
      };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'markdown': {
      const out: StateNode = { type: 'string', value: String(n.value ?? '') };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'media': {
      const items = Array.isArray(n.value) ? (n.value as Record<string, unknown>[]) : [];
      const out: StateNode = {
        type: 'array',
        value: items.map((it) => ({
          type: 'object',
          value: {
            url: { type: 'string' as const, value: String(it?.url ?? '') },
            ...(it?.alt !== undefined
              ? { alt: { type: 'string' as const, value: String(it.alt) } }
              : {}),
            ...(it?.kind !== undefined
              ? { kind: { type: 'string' as const, value: String(it.kind) } }
              : {}),
          },
        })),
      };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'tree': {
      const proj = (items: unknown): StateNode[] =>
        (Array.isArray(items) ? (items as Record<string, unknown>[]) : []).map((it) => ({
          type: 'object',
          value: {
            id: { type: 'string' as const, value: String(it?.id ?? '') },
            label: { type: 'string' as const, value: String(it?.label ?? '') },
            ...(it?.children !== undefined
              ? { children: { type: 'array' as const, value: proj(it.children) } }
              : {}),
          },
        }));
      const out: StateNode = { type: 'array', value: proj(n.value) };
      if (n.label) (out as { label?: string }).label = n.label as string;
      return out;
    }
    case 'array': {
      const arr = n as { type: 'array'; value: StateNode[]; label?: string; pagination?: unknown };
      return {
        ...arr,
        value: arr.value.map((child) => projectStateNodeToV10(child)),
      } as StateNode;
    }
    case 'object': {
      const obj = n as { type: 'object'; value: Record<string, StateNode>; label?: string };
      const value: Record<string, StateNode> = {};
      for (const [k, child] of Object.entries(obj.value ?? {})) {
        value[k] = projectStateNodeToV10(child);
      }
      return { ...obj, value };
    }
    default:
      if (V11_STATE_TYPES.has(String(n.type))) {
        return { type: 'object', value: {} };
      }
      return node;
  }
}

export function projectStateRootToV10(state: Record<string, StateNode>): Record<string, StateNode> {
  const out: Record<string, StateNode> = {};
  for (const [k, v] of Object.entries(state)) {
    out[k] = projectStateNodeToV10(v);
  }
  return out;
}

export function projectParamDefToV10(def: ParamDef): ParamDef {
  const next: ParamDef = clone(def);
  delete (next as { options_source?: unknown }).options_source;
  delete (next as { transfer?: unknown }).transfer;
  delete (next as { accept_mime?: unknown }).accept_mime;

  switch (def.type) {
    case 'geopoint':
      next.type = 'object';
      next.properties = {
        lat: { type: 'number', required: true },
        lng: { type: 'number', required: true },
      };
      break;
    case 'file':
      next.type = 'string';
      next.upload = true;
      break;
    case 'date_range':
      next.type = 'object';
      next.properties = {
        from: { type: 'date', required: true },
        to: { type: 'date', required: true },
      };
      break;
    case 'datetime_range':
      next.type = 'object';
      next.properties = {
        from: { type: 'datetime', required: true },
        to: { type: 'datetime', required: true },
      };
      break;
    case 'quantity':
      next.type = 'object';
      next.properties = {
        value: { type: 'number', required: true },
        unit: { type: 'string', required: true },
      };
      break;
    case 'money':
      next.type = 'object';
      next.properties = {
        amount: { type: 'number', required: true },
        scale: { type: 'number', required: true },
        currency: { type: 'string', required: true },
      };
      break;
    default:
      break;
  }

  if (next.item_type) next.item_type = projectParamDefToV10(next.item_type);
  if (next.properties) {
    const props: Record<string, ParamDef> = {};
    for (const [k, child] of Object.entries(next.properties)) {
      props[k] = projectParamDefToV10(child);
    }
    next.properties = props;
  }
  return next;
}

export function projectActionDefToV10(def: ActionDef): ActionDef {
  const next: ActionDef = clone(def);
  delete (next as { bulk?: unknown }).bulk;
  if (next.output) {
    const out = { ...next.output };
    delete (out as { resume_url?: unknown }).resume_url;
    next.output = out;
  }
  if (next.policy) {
    const policy = { ...next.policy };
    delete policy.consent_purposes;
    delete policy.step_up;
    next.policy = policy;
  }
  if (next.input) {
    const input: Record<string, ParamDef> = {};
    for (const [k, p] of Object.entries(next.input)) {
      input[k] = projectParamDefToV10(p);
    }
    next.input = input;
  }
  return next;
}

export function projectErrorEnvelopeToV10(env: ErrorEnvelope): ErrorEnvelope {
  const next: ErrorEnvelope = clone(env);
  next.app = '1.0';
  delete next.error.message_id;
  delete next.error.retry_class;
  return next;
}

export function projectManifestToV10(manifest: PageManifest): PageManifest {
  const next: PageManifest = clone(manifest);
  next.app = '1.0';
  const page = { ...next.page };
  delete (page as { focus?: unknown }).focus;
  delete (page as { time_zone?: unknown }).time_zone;
  next.page = page;
  next.state = projectStateRootToV10(next.state ?? {});
  if (next.actions) {
    const actions: Record<string, ActionDef> = {};
    for (const [k, def] of Object.entries(next.actions)) {
      actions[k] = projectActionDefToV10(def);
    }
    next.actions = actions;
  }
  if (next.navigation) {
    const nav = { ...next.navigation };
    delete (nav as { anchors?: unknown }).anchors;
    next.navigation = nav;
  }
  if (next.error) {
    const err = { ...next.error } as { message_id?: unknown; retry_class?: unknown };
    delete err.message_id;
    delete err.retry_class;
    next.error = err as PageManifest['error'];
  }
  return next;
}
