/**
 * Dual-speak helpers: select 1.0 vs 1.1 from request headers and project
 * 1.1-only constructs off 1.0 documents. Types that 1.1 adds are local
 * because @agent-page/server dist is still the 1.0 surface.
 */

import {
  parseAcceptVersions,
  type ActionDef,
  type PageManifest,
  type StateNode,
} from '@agent-page/server';

export type WireVersion = '1.0' | '1.1';

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'awaiting_payment'
  | 'awaiting_3ds'
  | 'paid'
  | 'fulfilling'
  | 'shipped'
  | 'delivered'
  | 'cancel_pending'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export type PaymentStatus =
  'unpaid' | 'requires_action' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface OrderItem {
  sku: string;
  qty: number;
  amount: number;
}

export interface OrderPayment {
  status: PaymentStatus;
  psp?: string;
  start_url?: string;
}

export interface OrderValue {
  id: string;
  status: OrderStatus;
  currency?: string;
  total?: number;
  scale?: number;
  items?: OrderItem[];
  payment?: OrderPayment;
  created_at?: string;
  updated_at?: string;
  extra?: Record<string, string | number | boolean | null>;
}

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ['pending', 'cancelled', 'failed'],
  pending: ['awaiting_payment', 'cancelled', 'failed'],
  awaiting_payment: ['awaiting_3ds', 'paid', 'failed', 'cancelled'],
  awaiting_3ds: ['paid', 'failed', 'awaiting_payment'],
  paid: ['fulfilling', 'refund_pending', 'cancelled', 'failed'],
  fulfilling: ['shipped', 'refund_pending', 'cancelled', 'failed'],
  shipped: ['delivered', 'refund_pending', 'failed'],
  delivered: ['refund_pending'],
  cancel_pending: ['cancelled', 'awaiting_payment', 'fulfilling'],
  cancelled: [],
  refund_pending: ['refunded', 'paid', 'failed'],
  refunded: [],
  failed: [],
};

export const ORDER_STATUS_OPTIONS = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];

export const SESSION_STATUS_OPTIONS = [
  'anonymous',
  'pending_mfa',
  'authenticated',
  'expired',
  'locked',
  'pending_consent',
] as const;

export type SessionStatus = (typeof SESSION_STATUS_OPTIONS)[number];

export const FEATURE_FLAG_KEYS = [
  'identity_flows',
  'mfa',
  'passkey',
  'oauth',
  'magic_link',
  'human_hold',
  'consent',
  'events_sse',
  'events_longpoll',
  'events_ws',
  'session_resume',
  'typeahead',
  'file_presign',
  'geopoint',
  'quantity',
  'datetime_range',
  'bulk_actions',
  'commerce',
  'order_state',
  'deep_focus',
  'locale_tz',
  'error_i18n',
  'action_result_pagination',
  'drafts',
] as const;

export const IMPLEMENTED_FEATURES: Record<string, boolean> = {
  identity_flows: true,
  mfa: true,
  passkey: false,
  oauth: false,
  magic_link: false,
  human_hold: true,
  consent: true,
  events_sse: true,
  events_longpoll: true,
  events_ws: false,
  session_resume: true,
  typeahead: true,
  file_presign: false,
  geopoint: false,
  quantity: false,
  datetime_range: false,
  bulk_actions: false,
  commerce: true,
  order_state: true,
  deep_focus: false,
  locale_tz: false,
  error_i18n: false,
  action_result_pagination: false,
  drafts: false,
};

export const CONSENT_VERSION = '2026-08-01';

export const HOLD_KIND_OPTIONS = ['captcha', 'webview', 'liveness', 'tos'] as const;

export const MEDIA_EVENT = 'application/vnd.agent-page-event+json';
export const MEDIA_EVENT_STREAM = 'text/event-stream';

export function asManifest(m: Omit<PageManifest, 'app'> & { app: WireVersion }): PageManifest {
  return m as PageManifest;
}

export function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name.toLowerCase()] ?? headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function selectedApp(headers?: Record<string, string | string[] | undefined>): WireVersion {
  const listed = parseAcceptVersions(headerValue(headers, 'x-app-accept-versions'));
  const xver = headerValue(headers, 'x-app-version');
  const offered = listed && listed.length > 0 ? listed : xver ? [xver.trim()] : ['1.0'];
  if (offered.includes('1.1')) return '1.1';
  return '1.0';
}

export function boolNode(value: boolean, label?: string): StateNode {
  return label ? { type: 'boolean', value, label } : { type: 'boolean', value };
}

export function stringNode(value: string, label?: string, secret?: boolean): StateNode {
  const n: StateNode = label ? { type: 'string', value, label } : { type: 'string', value };
  if (secret) (n as { secret?: boolean }).secret = true;
  return n;
}

export function numberNode(
  value: number,
  opts?: { label?: string; min?: number; max?: number; unit?: string; scale?: number },
): StateNode {
  const n: StateNode = { type: 'number', value };
  if (opts?.label) n.label = opts.label;
  if (opts?.min !== undefined) (n as { min?: number }).min = opts.min;
  if (opts?.max !== undefined) (n as { max?: number }).max = opts.max;
  if (opts?.unit) (n as { unit?: string }).unit = opts.unit;
  if (opts?.scale !== undefined) (n as { scale?: number }).scale = opts.scale;
  return n;
}

export function enumNode(value: string, options: readonly string[], label?: string): StateNode {
  const n: StateNode = { type: 'enum', value, options: [...options] };
  if (label) n.label = label;
  return n;
}

export function datetimeNode(value: string, label?: string): StateNode {
  return label ? { type: 'datetime', value, label } : { type: 'datetime', value };
}

export function buildFeaturesNode(): StateNode {
  const value: Record<string, StateNode> = {};
  for (const key of FEATURE_FLAG_KEYS) {
    value[key] = boolNode(IMPLEMENTED_FEATURES[key] === true);
  }
  return { type: 'object', label: 'Features', value };
}

export function cloneManifest(manifest: PageManifest): PageManifest {
  return structuredClone(manifest);
}

export function orderStateNode(order: OrderValue, label = 'Order'): StateNode {
  return { type: 'order', label, value: order } as unknown as StateNode;
}

function projectOrderNode(node: StateNode): StateNode {
  const v = (node as unknown as { value: OrderValue }).value;
  const obj: Record<string, StateNode> = {
    id: stringNode(v.id),
    status: enumNode(v.status, ORDER_STATUS_OPTIONS),
  };
  if (v.currency) obj.currency = stringNode(v.currency);
  if (v.total !== undefined) {
    obj.total = numberNode(v.total, { unit: v.currency, scale: v.scale ?? 2, label: 'Total' });
  }
  if (v.scale !== undefined) obj.scale = numberNode(v.scale, { label: 'Scale' });
  if (v.created_at) obj.created_at = datetimeNode(v.created_at);
  if (v.updated_at) obj.updated_at = datetimeNode(v.updated_at);
  if (v.payment) {
    obj.payment = {
      type: 'object',
      value: {
        status: enumNode(v.payment.status, [
          'unpaid',
          'requires_action',
          'processing',
          'succeeded',
          'failed',
          'cancelled',
        ]),
        ...(v.payment.psp ? { psp: stringNode(v.payment.psp) } : {}),
        ...(v.payment.start_url ? { start_url: stringNode(v.payment.start_url) } : {}),
      },
    };
  }
  if (v.items) {
    obj.items = {
      type: 'array',
      item_label: 'item',
      value: v.items.map((item) => ({
        type: 'object' as const,
        value: {
          sku: stringNode(item.sku),
          qty: numberNode(item.qty),
          amount: numberNode(item.amount, { scale: v.scale ?? 2, unit: v.currency }),
        },
      })),
    };
  }
  return { type: 'object', label: node.label, value: obj };
}

function projectStateMap(state: Record<string, StateNode>): void {
  for (const [key, node] of Object.entries(state)) {
    if (!node || typeof node !== 'object') continue;
    if ((node as { type?: string }).type === 'order') {
      state[key] = projectOrderNode(node);
      continue;
    }
    if (node.type === 'object' && node.value && typeof node.value === 'object') {
      projectStateMap(node.value as Record<string, StateNode>);
    } else if (node.type === 'array' && Array.isArray(node.value)) {
      for (const item of node.value) {
        if (item && typeof item === 'object' && (item as StateNode).type === 'object') {
          const obj = item as { type: 'object'; value: Record<string, StateNode> };
          if (obj.value) projectStateMap(obj.value);
        }
      }
    }
  }
}

function strip11ActionKeys(actions: Record<string, ActionDef> | undefined): void {
  if (!actions) return;
  for (const action of Object.values(actions)) {
    delete (action as ActionDef & { bulk?: unknown }).bulk;
    if (action.output) {
      delete (action.output as ActionDef['output'] & { resume_url?: unknown }).resume_url;
    }
    if (action.input) {
      for (const param of Object.values(action.input)) {
        if (param && typeof param === 'object') {
          delete param.options_source;
        }
      }
    }
    if (action.policy) {
      delete action.policy.consent_purposes;
      delete action.policy.step_up;
      delete action.policy.secret_params;
      delete action.policy.pii_params;
      if (Object.keys(action.policy).length === 0) {
        delete action.policy;
      }
    }
  }
}

/** Project a canonical 1.1-shaped manifest down to a 1.0-legal document. */
export function projectTo10(manifest: PageManifest): PageManifest {
  (manifest as { app: WireVersion }).app = '1.0';
  if (manifest.state.protocol_version && manifest.state.protocol_version.type === 'string') {
    manifest.state.protocol_version.value = '1.0';
  }
  projectStateMap(manifest.state);
  strip11ActionKeys(manifest.actions);
  if (manifest.actions?.search_airports) {
    delete manifest.actions.search_airports;
  }
  if (manifest.meta && 'flow' in manifest.meta) {
    const { flow: _flow, ...rest } = manifest.meta;
    void _flow;
    manifest.meta = rest;
  }
  return manifest;
}

/**
 * Clone a canonical (1.1-shaped) manifest and emit for the selected version.
 * Features remain as an object of boolean StateNodes on 1.0 so 1.1 clients
 * can still read flags when middleware echoes X-APP-Version 1.0.
 */
export function finalizeManifest(
  canonical: PageManifest,
  headers?: Record<string, string | string[] | undefined>,
): PageManifest {
  const version = selectedApp(headers);
  const copy = cloneManifest(canonical);
  (copy as { app: WireVersion }).app = version;
  if (version === '1.0') return projectTo10(copy);
  return copy;
}

export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
