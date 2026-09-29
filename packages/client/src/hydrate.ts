/**
 * Manifest hydration algorithm (SPEC v0.4-Ultimate §15.3, §8.6).
 */

import type { ManifestCache } from './cache.js';
import { applyDiffDocument, isDiffDocument, isPageManifest } from './diff.js';
import { AppError, isSoftErrorCode } from './errors.js';
import type { AppHttpClient } from './http.js';
import { MEDIA_DIFF, MEDIA_PAGE } from './media-types.js';
import {
  assertSameOrigin,
  NavigationStack,
  normalizeAppUrl,
  requireNavigateLocation,
  resolveAppUrl,
} from './navigate.js';
import type { ResumeStore } from './resume.js';
import type { DiffDocument, PageManifest, PaginationInfo } from './types.js';

export interface HydrateOptions {
  /** Force revalidation even if cache is fresh. */
  force?: boolean;
  /** Skip cache read (still write on success). */
  bypassCache?: boolean;
  /** Origin page URL for same-origin checks when hydrating a relative/absolute nav target. */
  fromPageUrl?: string;
  /** Follow navigation redirects from Location / X-APP-Navigate. */
  followRedirects?: boolean;
  /** Resume token for X-APP-Resume (SPEC §13). */
  resumeToken?: string;
  /** Strict mode: reject unknown manifest members and unknown state node types. */
  strict?: boolean;
  /**
   * URL the returned manifest's page.url must match (normalized §8.2).
   * Defaults to the effective request URL. Async operation polls
   * (Form D §3.3.6) serve the page's manifest from an /operations URL —
   * pass the originating page url so the identity check still applies.
   */
  expectedPageUrl?: string;
}

export interface HydrateContext {
  http: AppHttpClient;
  cache: ManifestCache;
  navStack: NavigationStack;
  resume?: ResumeStore;
}

const PAGE_ID_RE = /^[a-z][a-z0-9_-]{0,127}$/;
export function checkRootMembers(body: Record<string, unknown>): void {
  for (const key of Object.keys(body)) {
    if (!MANIFEST_ROOT_KEYS.has(key)) {
      throw new AppError('app.err.manifest.strict_unknown', {
        message: `Unknown manifest member: ${key}`,
        path: `/${key}`,
      });
    }
  }
}

const MANIFEST_ROOT_KEYS = new Set([
  'app',
  'page',
  'state',
  'actions',
  'navigation',
  'present',
  'error',
  'meta',
]);
const STATE_NODE_TYPES = new Set([
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

/** §5.2#12 member allowlists per known node type (strict/conformance clients). */
const NODE_MEMBERS: Record<string, ReadonlySet<string>> = {
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
const PAGINATION_MEMBERS = new Set(['cursor', 'has_more', 'total']);
const FORBIDDEN_STATE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STATE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
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

const ACTION_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ACTION_KINDS = new Set(['query', 'mutate', 'navigate', 'confirm', 'delegate']);
const SIDE_EFFECTS = new Set(['safe', 'destructive', 'financial', 'identity']);

/** State-root key grammar — the lenient floor (§5.2): STATE_KEY_RE plus
 * forbidden object keys. */
export function checkStateKeys(state: unknown): void {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return;
  for (const key of Object.keys(state)) {
    if (FORBIDDEN_STATE_KEYS.has(key) || !STATE_KEY_RE.test(key)) {
      throw new AppError('app.err.state.illegal_key', {
        message: `Invalid state key: ${key}`,
        path: `/state/${key}`,
      });
    }
  }
}

/**
 * The actions-block contract the extension enforces on receipt and after
 * diff apply: object map ≤128 keys, key grammar, def objects, kind and
 * side_effect vocabulary (§5.2). Enforced unconditionally — it is the
 * lenient floor.
 */
export function checkActions(actions: unknown): void {
  if (actions == null) return;
  if (typeof actions !== 'object' || Array.isArray(actions)) {
    throw new AppError('app.err.manifest.invalid', { message: 'actions must be object' });
  }
  const keys = Object.keys(actions);
  if (keys.length > 128) {
    throw new AppError('app.err.action.too_many', { message: 'actions exceeds 128' });
  }
  for (const [key, def] of Object.entries(actions)) {
    if (!ACTION_KEY_RE.test(key)) {
      throw new AppError('app.err.manifest.invalid', {
        message: `Invalid action key: ${key}`,
        path: `/actions/${key}`,
      });
    }
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      throw new AppError('app.err.manifest.invalid', {
        message: 'ActionDef must be object',
        path: `/actions/${key}`,
      });
    }
    const d = def as { kind?: unknown; side_effect?: unknown };
    if (d.kind != null && (typeof d.kind !== 'string' || !ACTION_KINDS.has(d.kind))) {
      throw new AppError('app.err.manifest.invalid', {
        message: `Invalid action kind: ${d.kind}`,
        path: `/actions/${key}/kind`,
      });
    }
    if (
      d.side_effect != null &&
      (typeof d.side_effect !== 'string' || !SIDE_EFFECTS.has(d.side_effect))
    ) {
      throw new AppError('app.err.manifest.invalid', {
        message: `Invalid side_effect: ${d.side_effect}`,
        path: `/actions/${key}/side_effect`,
      });
    }
  }
}

export function checkStateNodes(node: unknown, path: string, strict: boolean): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const n = node as {
    type?: unknown;
    value?: unknown;
    pagination?: unknown;
  };
  if (typeof n.type !== 'string' || n.type === '') {
    throw new AppError('app.err.state.invalid_node', {
      message: 'State node is missing a string type',
      path,
    });
  }
  if (!STATE_NODE_TYPES.has(n.type)) {
    throw new AppError('app.err.state.unknown_type', {
      message: `Unknown state node type: ${n.type}`,
      path,
    });
  }
  // §5.2#7: forbidden keys anywhere under /state; #12: closed member sets.
  for (const k of Object.keys(n)) {
    if (FORBIDDEN_STATE_KEYS.has(k)) {
      throw new AppError('app.err.state.invalid_node', {
        message: `Forbidden member ${k} on state node`,
        path,
      });
    }
  }
  const allowed = strict && typeof n.type === 'string' ? NODE_MEMBERS[n.type] : undefined;
  if (allowed) {
    for (const k of Object.keys(n)) {
      if (!allowed.has(k)) {
        throw new AppError('app.err.state.invalid_node', {
          message: `Extra member ${k} on ${n.type} node`,
          path: `${path}/${k}`,
        });
      }
    }
  }
  function fail(code: string, message: string): never {
    throw new AppError(code, { message, path });
  }
  const pag = n.pagination;
  if (pag && typeof pag === 'object' && !Array.isArray(pag)) {
    if (strict) {
      for (const k of Object.keys(pag)) {
        if (!PAGINATION_MEMBERS.has(k)) {
          throw new AppError('app.err.state.invalid_node', {
            message: `Extra member ${k} on pagination`,
            path: `${path}/pagination/${k}`,
          });
        }
      }
    }
    const p = pag as { cursor?: unknown; has_more?: unknown; total?: unknown };
    if (!('cursor' in p) || !('has_more' in p) || !('total' in p)) {
      fail('app.err.state.invalid_node', 'pagination requires cursor/has_more/total');
    }
    if (p.cursor != null && typeof p.cursor !== 'string') {
      fail('app.err.state.invalid_node', 'pagination.cursor must be string|null');
    }
    if (typeof p.has_more !== 'boolean') {
      fail('app.err.state.invalid_node', 'pagination.has_more must be boolean');
    }
    if (
      p.total != null &&
      (typeof p.total !== 'number' || !Number.isInteger(p.total) || p.total < 0)
    ) {
      fail('app.err.state.invalid_node', 'pagination.total must be integer|null ≥0');
    }
  }
  // Value-shape checks per node type — the lenient contract the extension
  // renderer enforces on receipt and after diff apply; the strict client
  // must match it (§5.2).
  switch (n.type) {
    case 'null':
      if ('value' in n) fail('app.err.state.invalid_node', 'null node must not have value');
      break;
    case 'string':
      if (typeof n.value !== 'string') fail('app.err.state.invalid_node', 'string value required');
      break;
    case 'number': {
      if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
        fail('app.err.state.number_overflow', 'finite number value required');
      }
      if (typeof (n as { scale?: unknown }).scale === 'number' && !Number.isInteger(n.value)) {
        fail('app.err.state.invalid_node', 'scaled number must be integer minor units');
      }
      if (Number.isInteger(n.value) && Math.abs(n.value as number) > Number.MAX_SAFE_INTEGER) {
        fail('app.err.state.number_precision', 'integer exceeds 2^53−1');
      }
      break;
    }
    case 'boolean':
      if (typeof n.value !== 'boolean')
        fail('app.err.state.invalid_node', 'boolean value required');
      break;
    case 'date':
      if (typeof n.value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(n.value)) {
        fail('app.err.state.invalid_date', 'date YYYY-MM-DD required');
      }
      break;
    case 'datetime':
      if (typeof n.value !== 'string' || Number.isNaN(Date.parse(n.value))) {
        fail('app.err.state.invalid_datetime', 'datetime RFC3339 required');
      }
      break;
    case 'enum': {
      const opts = (n as { options?: unknown }).options;
      if (typeof n.value !== 'string') {
        fail('app.err.state.invalid_enum', 'enum value string required');
      }
      if (!Array.isArray(opts) || opts.length < 1) {
        fail('app.err.state.invalid_enum', 'enum options required');
      }
      if (!(opts as unknown[]).includes(n.value)) {
        fail('app.err.state.invalid_enum', 'enum value not in options');
      }
      break;
    }
    case 'geopoint': {
      const vo = n.value as { lat?: unknown; lng?: unknown } | null | undefined;
      if (vo == null || typeof vo !== 'object' || Array.isArray(vo)) {
        fail('app.err.state.invalid_geopoint', 'geopoint value object required');
      }
      const lat = typeof vo.lat === 'number' ? vo.lat : (vo.lat as { value?: unknown })?.value;
      const lng = typeof vo.lng === 'number' ? vo.lng : (vo.lng as { value?: unknown })?.value;
      if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
        fail('app.err.state.invalid_geopoint', 'geopoint.lat out of range');
      }
      if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
        fail('app.err.state.invalid_geopoint', 'geopoint.lng out of range');
      }
      break;
    }
    case 'order': {
      const vo = n.value as Record<string, unknown> | null | undefined;
      if (vo == null || typeof vo !== 'object' || Array.isArray(vo)) {
        fail('app.err.commerce.not_an_order', 'order value object required');
      }
      if (typeof vo.id !== 'string' || !vo.id) {
        fail('app.err.commerce.not_an_order', 'order.id required');
      }
      if (typeof vo.status !== 'string' || !ORDER_STATUSES.has(vo.status)) {
        fail('app.err.commerce.not_an_order', `order.status invalid: ${vo.status}`);
      }
      if (vo.total != null) {
        if (!Number.isInteger(vo.total)) {
          fail('app.err.commerce.not_an_order', 'order.total must be integer minor units');
        }
        if (!Number.isInteger(vo.scale)) {
          fail('app.err.commerce.not_an_order', 'order.scale required with total');
        }
        if (typeof vo.currency !== 'string') {
          fail('app.err.commerce.not_an_order', 'order.currency required with total');
        }
      }
      if (vo.items != null && (!Array.isArray(vo.items) || vo.items.length > 128)) {
        fail('app.err.commerce.not_an_order', 'order.items invalid');
      }
      break;
    }
    case 'object': {
      const fields = n.value ?? (n as { fields?: unknown }).fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        fail('app.err.state.invalid_node', 'object value map required');
      }
      for (const [k, child] of Object.entries(fields as Record<string, unknown>)) {
        if (FORBIDDEN_STATE_KEYS.has(k)) {
          throw new AppError('app.err.state.invalid_node', {
            message: `Forbidden member ${k} under ${path}`,
            path: `${path}/${k}`,
          });
        }
        if (
          child &&
          typeof child === 'object' &&
          !Array.isArray(child) &&
          (strict || (child as { type?: unknown }).type)
        ) {
          checkStateNodes(child, `${path}/value/${k}`, strict);
        }
      }
      break;
    }
    case 'array': {
      if (!Array.isArray(n.value)) {
        fail('app.err.state.invalid_node', 'array value required');
      }
      n.value.forEach((child: unknown, i: number) => {
        if (
          child &&
          typeof child === 'object' &&
          !Array.isArray(child) &&
          (strict || (child as { type?: unknown }).type)
        ) {
          checkStateNodes(child, `${path}/value/${i}`, strict);
        }
      });
      break;
    }
    case 'embed': {
      const eu = (n as { url?: unknown }).url;
      if (typeof eu !== 'string' || !/^https:\/\//.test(eu) || eu.length > 2048) {
        fail('app.err.state.invalid_embed', 'embed url must be an https URI');
      }
      const desc = (n as { description?: unknown }).description;
      if (typeof desc !== 'string' || desc.length < 1 || desc.length > 512) {
        fail('app.err.state.invalid_embed', 'embed description required (1..512)');
      }
      const sb = (n as { sandbox?: unknown }).sandbox;
      if (sb !== undefined) {
        const flags = new Set(['scripts', 'forms', 'popups', 'same-origin']);
        if (
          !Array.isArray(sb) ||
          !sb.every((f: unknown) => typeof f === 'string' && flags.has(f as string))
        ) {
          fail('app.err.state.invalid_embed', 'sandbox must be scripts/forms/popups/same-origin');
        }
      }
      const h = (n as { height?: unknown }).height;
      if (h !== undefined && (!Number.isInteger(h) || (h as number) < 16 || (h as number) > 2000)) {
        fail('app.err.state.invalid_embed', 'embed height must be integer 16..2000');
      }
      break;
    }
    case 'markdown': {
      if (typeof n.value !== 'string' || n.value.length > 65536) {
        fail('app.err.state.invalid_markdown', 'markdown value string required (<= 65536)');
      }
      break;
    }
    case 'media': {
      if (!Array.isArray(n.value) || n.value.length > 256) {
        fail('app.err.state.invalid_media', 'media value array required (<= 256)');
      }
      for (const item of n.value as unknown[]) {
        const it = item as { url?: unknown } | null;
        if (it == null || typeof it !== 'object' || Array.isArray(it)) {
          fail('app.err.state.invalid_media', 'media item must be an object');
        }
        if (typeof it.url !== 'string' || !/^https:\/\//.test(it.url) || it.url.length > 2048) {
          fail('app.err.state.invalid_media', 'media item url must be an https URI');
        }
      }
      break;
    }
    case 'tree': {
      const walkTree = (items: unknown, depth: number): void => {
        if (!Array.isArray(items) || items.length > 512) {
          fail('app.err.state.invalid_tree', 'tree value must be an array <= 512 items');
        }
        if (depth > 16) fail('app.err.state.invalid_tree', 'tree depth exceeded 16');
        for (const item of items as unknown[]) {
          const it = item as { id?: unknown; label?: unknown; children?: unknown } | null;
          if (it == null || typeof it !== 'object' || Array.isArray(it)) {
            fail('app.err.state.invalid_tree', 'tree item must be an object');
          }
          if (typeof it.id !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(it.id)) {
            fail('app.err.state.invalid_tree', 'tree item id invalid');
          }
          if (typeof it.label !== 'string' || it.label.length < 1 || it.label.length > 128) {
            fail('app.err.state.invalid_tree', 'tree item label required (1..128)');
          }
          if (it.children !== undefined) walkTree(it.children, depth + 1);
        }
      };
      walkTree(n.value, 1);
      break;
    }
    case 'table': {
      const fields = (n as { fields?: unknown }).fields;
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
        fail('app.err.state.invalid_node', 'table fields map required');
      }
      const fmap = fields as Record<string, unknown>;
      const keys = Object.keys(fmap);
      if (keys.length < 1 || keys.length > 128) {
        fail('app.err.state.object_too_large', 'table fields count out of range');
      }
      for (const [k, tv] of Object.entries(fmap)) {
        if (!STATE_KEY_RE.test(k)) {
          fail('app.err.state.illegal_key', `Invalid table field key: ${k}`);
        }
        if (typeof tv !== 'string' || !TABLE_FIELD_TYPES.has(tv)) {
          fail('app.err.state.invalid_node', `Invalid table field type: ${tv}`);
        }
      }
      if (!Array.isArray(n.value)) {
        fail('app.err.state.invalid_node', 'table value row array required');
      }
      const rows = n.value as unknown[];
      if (rows.length > 10000) {
        fail('app.err.state.array_too_long', 'table rows exceed cap');
      }
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row) || row.length !== keys.length) {
          fail('app.err.state.invalid_node', `table row ${i} length must equal fields count`);
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * §5.2 invariant on contradictory pagination — `cursor:null` + `has_more:true`
 * is treated as `has_more:false` and surfaces app.warn.state.pagination_inconsistent
 * in meta.warnings. Defense in depth: conforming servers normalize on emit, but
 * clients MUST enforce it on receipt (TV-04).
 */
export function normalizePagination(manifest: PageManifest): void {
  let inconsistent = false;
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const node = n as { type?: string; value?: unknown; pagination?: PaginationInfo };
    if ((node.type === 'array' || node.type === 'table') && node.pagination) {
      const pag = node.pagination;
      if (pag.cursor === null && pag.has_more === true) {
        pag.has_more = false;
        inconsistent = true;
      }
    }
    if (node.type === 'object' && node.value && typeof node.value === 'object') {
      for (const v of Object.values(node.value as Record<string, unknown>)) walk(v);
    } else if (node.type === 'array' && Array.isArray(node.value)) {
      node.value.forEach(walk);
    }
  };
  for (const n of Object.values(manifest.state)) walk(n);
  if (inconsistent) {
    const meta = (manifest.meta ??= {}) as Record<string, unknown>;
    const warnings = Array.isArray(meta.warnings) ? meta.warnings : (meta.warnings = []);
    (warnings as unknown[]).push({
      code: 'app.warn.state.pagination_inconsistent',
      message: 'cursor null with has_more true',
    });
  }
}

/**
 * Manifest receipt checks (SPEC §5.7): envelope shape via isPageManifest,
 * then page.id grammar, page.url == effective request URL (normalized §8.2).
 * Strict mode additionally rejects unknown root members and unknown state
 * node types (conformance clients).
 */
function validateManifest(
  body: unknown,
  requestId: string | null | undefined,
  effectiveUrl: string,
  strict: boolean,
): PageManifest {
  if (!isPageManifest(body)) {
    throw new AppError('app.err.manifest.invalid', {
      message: 'Response is not a valid Page Manifest',
      request_id: requestId ?? undefined,
    });
  }
  if (strict) {
    for (const key of Object.keys(body)) {
      if (!MANIFEST_ROOT_KEYS.has(key)) {
        throw new AppError('app.err.manifest.strict_unknown', {
          message: `Unknown manifest member: ${key}`,
          path: `/${key}`,
          request_id: requestId ?? undefined,
        });
      }
    }
    for (const [k, node] of Object.entries(body.state)) {
      checkStateNodes(node, `/state/${k}`, true);
    }
  }
  checkStateKeys(body.state);
  checkActions(body.actions);
  if (!PAGE_ID_RE.test(body.page.id)) {
    throw new AppError('app.err.manifest.invalid_page_id', {
      message: `Bad page.id grammar: ${body.page.id}`,
      path: '/page/id',
      request_id: requestId ?? undefined,
    });
  }
  if (normalizeAppUrl(body.page.url) !== normalizeAppUrl(effectiveUrl)) {
    throw new AppError('app.err.manifest.url_mismatch', {
      message: `page.url ${body.page.url} does not match request URL ${effectiveUrl}`,
      path: '/page/url',
      request_id: requestId ?? undefined,
    });
  }
  normalizePagination(body);
  return body;
}

/**
 * hydrate(url): cache hit → return; else GET with If-None-Match; 304 touch; 200 validate+cache.
 * After 303, ALWAYS re-GET Location with full APP Accept / X-APP-Version / X-APP-Client (TV-38).
 */
export async function hydrate(
  ctx: HydrateContext,
  url: string,
  options: HydrateOptions = {},
): Promise<PageManifest> {
  const absolute = resolveAppUrl(url, options.fromPageUrl ?? url);
  if (options.fromPageUrl) {
    assertSameOrigin(absolute, options.fromPageUrl);
  }

  const cached = options.bypassCache ? undefined : ctx.cache.get(absolute);
  if (!options.force && cached && ctx.cache.stillFresh(cached)) {
    return cached.manifest;
  }

  ctx.navStack.push(absolute);

  const resumeToken = options.resumeToken ?? ctx.resume?.get(absolute);

  const { meta, body } = await ctx.http.get(absolute, {
    ifNoneMatch: cached?.etag,
    pageUrl: absolute,
    resumeToken,
  });

  if (meta.setAppResume) {
    ctx.resume?.applyHeader(absolute, meta.setAppResume);
  }

  if (meta.status === 304) {
    if (!cached) {
      throw new AppError('app.err.cache.revalidate_failed', {
        message: 'Received 304 without a cached manifest',
        request_id: meta.requestId ?? undefined,
      });
    }
    ctx.cache.touch(absolute);
    return cached.manifest;
  }

  // Redirect (303/302/301) — require Location === X-APP-Navigate when APP navigate (TV-39)
  if (
    options.followRedirects !== false &&
    (meta.status === 303 || meta.status === 302 || meta.status === 301)
  ) {
    const next =
      meta.location && meta.navigate
        ? requireNavigateLocation(meta.location, meta.navigate, absolute)
        : meta.location
          ? resolveAppUrl(meta.location, absolute)
          : meta.navigate
            ? resolveAppUrl(meta.navigate, absolute)
            : null;
    if (!next) {
      throw new AppError('app.err.navigation.invalid_url', {
        message: 'Redirect without Location',
        request_id: meta.requestId ?? undefined,
      });
    }
    assertSameOrigin(next, absolute);
    ctx.navStack.trackRedirect(next);
    // Always re-GET with full APP headers (TV-38) — http.get always sends Accept/Version/Client
    return hydrate(ctx, next, {
      ...options,
      fromPageUrl: absolute,
      force: true,
      bypassCache: true,
    });
  }

  if (meta.status === 404) {
    throw new AppError('app.err.page.not_found', {
      httpStatus: 404,
      request_id: meta.requestId ?? undefined,
    });
  }
  if (meta.status === 410) {
    throw new AppError('app.err.page.gone', {
      httpStatus: 410,
      request_id: meta.requestId ?? undefined,
    });
  }

  if (meta.status >= 400 || meta.mediaType === 'application/vnd.agent-page-error+json') {
    ctx.http.throwIfError(body, meta);
  }

  if (meta.mediaType === MEDIA_DIFF && isDiffDocument(body) && cached) {
    const applied = applyDiffDocument(cached.manifest, body as DiffDocument);
    if (!applied.ok) {
      throw new AppError(applied.code, { message: applied.message });
    }
    ctx.cache.set(absolute, applied.manifest, {
      etag: applied.manifest.page.etag ?? meta.etag ?? undefined,
      cacheControl: meta.cacheControl ?? undefined,
    });
    return applied.manifest;
  }

  if (meta.mediaType && meta.mediaType !== MEDIA_PAGE && meta.status === 200) {
    if (!isPageManifest(body)) {
      throw new AppError('app.err.negotiate.not_acceptable', {
        message: `Unexpected Content-Type: ${meta.mediaType}`,
        httpStatus: 406,
        request_id: meta.requestId ?? undefined,
      });
    }
  }

  const manifest = validateManifest(
    body,
    meta.requestId,
    options.expectedPageUrl ?? absolute,
    options.strict === true,
  );
  if (!manifest.page.url) {
    manifest.page.url = absolute;
  }

  // Soft error channel abuse: hard codes on 200 soft channel → manifest.invalid (TV-52)
  if (manifest.error?.code && !isSoftErrorCode(manifest.error.code)) {
    throw new AppError('app.err.manifest.invalid', {
      message: `Soft error channel used with non-soft code: ${manifest.error.code}`,
      request_id: meta.requestId ?? undefined,
    });
  }

  ctx.cache.set(manifest.page.url || absolute, manifest, {
    etag: manifest.page.etag ?? meta.etag ?? undefined,
    cacheControl: meta.cacheControl ?? undefined,
  });

  ctx.navStack.resetRedirects();
  return manifest;
}
