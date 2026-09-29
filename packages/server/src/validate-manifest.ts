/**
 * Publish-time manifest graph validation (SPEC §5.3 / §10.2 / §10.4).
 * State-shape checks live in validate-state.ts; this covers the parts a
 * state validator cannot see: the action catalog itself.
 */

import type { PageManifest, ParamDef, ValidationFailure } from './types.js';
import { validateOptionsSource } from './options-source.js';

/** SPEC §10.4: a page MUST NOT advertise more than 128 actions. */
export const MAX_ACTIONS_PER_PAGE = 128;

const ACTION_ID_RE = /^[a-z][a-z0-9_]{0,63}$/;
const ACTION_KINDS = new Set(['query', 'mutate', 'navigate', 'confirm', 'delegate']);
const SIDE_EFFECTS = new Set(['safe', 'destructive', 'financial', 'identity']);
const PARAM_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'array',
  'object',
  'geopoint',
  'file',
  'date_range',
  'datetime_range',
  'quantity',
  'money',
]);

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

export const PARAM_MEMBERS = new Set([
  'type',
  'required',
  'nullable',
  'description',
  'default',
  'min',
  'max',
  'min_length',
  'max_length',
  'min_items',
  'max_items',
  'pattern',
  'options',
  'option_labels',
  'options_source',
  'item_type',
  'properties',
  'example',
  'upload',
  'collection_format',
  'transfer',
  'accept_mime',
  'max_bytes',
  'open',
  'max_span_seconds',
  'max_accuracy_m',
  'units',
  'unit',
  'scale',
  'currency',
]);

function validateParamDef(def: ParamDef, path: string): ValidationFailure | null {
  if (!def || typeof def !== 'object') {
    return fail('app.err.action.invalid_def', 'param def must be an object', path);
  }
  for (const k of Object.keys(def)) {
    if (FORBIDDEN_KEYS.has(k)) {
      return fail('app.err.action.invalid_def', `Forbidden key: ${k}`, `${path}/${k}`);
    }
    if (!PARAM_MEMBERS.has(k)) {
      return fail('app.err.action.invalid_def', `Unexpected param member: ${k}`, `${path}/${k}`);
    }
  }
  if (typeof def.type !== 'string' || !PARAM_TYPES.has(def.type)) {
    return fail(
      'app.err.action.invalid_def',
      `Unknown param type: ${String(def.type)}`,
      `${path}/type`,
    );
  }
  if (def.item_type) {
    const err = validateParamDef(def.item_type, `${path}/item_type`);
    if (err) return err;
  }
  if (def.properties) {
    for (const [k, child] of Object.entries(def.properties)) {
      const err = validateParamDef(child, `${path}/properties/${k}`);
      if (err) return err;
    }
  }
  return null;
}

const PAGE_ID_RE = /^[a-z][a-z0-9_-]{0,127}$/;
const PAGE_VERSION_RE = /^[A-Za-z0-9._:-]+$/;
export const PAGE_MEMBERS = new Set([
  'id',
  'url',
  'version',
  'title',
  'etag',
  'generated_at',
  'language',
  'description',
  'time_zone',
  'focus',
]);
export const NAV_MEMBERS = new Set(['breadcrumb', 'related', 'anchors']);
export const NAV_ITEM_MEMBERS = new Set(['label', 'url', 'page_id', 'rel']);
export const NAV_ITEM_RELS = new Set(['up', 'next', 'prev', 'related', 'alternate']);
export const ACTION_DEF_MEMBERS = new Set([
  'description',
  'kind',
  'input',
  'output',
  'side_effect',
  'requires_confirmation',
  'idempotent',
  'timeout_ms',
  'auth',
  'action_url',
  'param_mode',
  'requires_etag_match',
  'rate_limit',
  'confirm',
  'bulk',
  'policy',
  'async',
]);
export const OPTIONS_SOURCE_MEMBERS = new Set([
  'action',
  'param',
  'results_path',
  'min_query_length',
  'debounce_ms',
  'item_value',
  'item_label',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function forbiddenIn(value: unknown, path: string): ValidationFailure | null {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const err = forbiddenIn(value[i], `${path}/${i}`);
      if (err) return err;
    }
    return null;
  }
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k)) {
      return fail('app.err.manifest.invalid', `Forbidden key: ${k}`, `${path}/${k}`);
    }
    const err = forbiddenIn(v, `${path}/${k}`);
    if (err) return err;
  }
  return null;
}

/**
 * Emit-side check for the `page` block (member strictness + the field
 * grammars the schema enforces).
 */
export function validatePageBlock(page: unknown): ValidationFailure | null {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    return fail('app.err.manifest.invalid', 'page must be an object', '/page');
  }
  const p = page as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (FORBIDDEN_KEYS.has(k)) {
      return fail('app.err.manifest.invalid', `Forbidden key: ${k}`, `/page/${k}`);
    }
    if (!PAGE_MEMBERS.has(k)) {
      return fail('app.err.manifest.invalid', `Unexpected page member: ${k}`, `/page/${k}`);
    }
  }
  if (typeof p.id !== 'string' || !PAGE_ID_RE.test(p.id)) {
    return fail(
      'app.err.manifest.invalid',
      'page.id must match ^[a-z][a-z0-9_-]{0,127}$',
      '/page/id',
    );
  }
  if (typeof p.url !== 'string' || p.url.length < 1 || p.url.length > 2048) {
    return fail(
      'app.err.manifest.invalid',
      'page.url must be a string of length 1..2048',
      '/page/url',
    );
  }
  if (
    typeof p.version !== 'string' ||
    p.version.length < 1 ||
    p.version.length > 64 ||
    !PAGE_VERSION_RE.test(p.version)
  ) {
    return fail(
      'app.err.manifest.invalid',
      'page.version must match ^[A-Za-z0-9._:-]{1,64}$',
      '/page/version',
    );
  }
  if ('title' in p && (typeof p.title !== 'string' || p.title.length < 1 || p.title.length > 200)) {
    return fail(
      'app.err.manifest.invalid',
      'page.title must be a string of length 1..200',
      '/page/title',
    );
  }
  if ('etag' in p && (typeof p.etag !== 'string' || p.etag.length < 1 || p.etag.length > 256)) {
    return fail(
      'app.err.manifest.invalid',
      'page.etag must be a string of length 1..256',
      '/page/etag',
    );
  }
  if (
    'language' in p &&
    (typeof p.language !== 'string' || p.language.length < 2 || p.language.length > 35)
  ) {
    return fail(
      'app.err.manifest.invalid',
      'page.language must be a string of length 2..35',
      '/page/language',
    );
  }
  if (
    'description' in p &&
    (typeof p.description !== 'string' || p.description.length < 1 || p.description.length > 500)
  ) {
    return fail(
      'app.err.manifest.invalid',
      'page.description must be a string of length 1..500',
      '/page/description',
    );
  }
  if (
    'time_zone' in p &&
    (typeof p.time_zone !== 'string' || p.time_zone.length < 1 || p.time_zone.length > 64)
  ) {
    return fail(
      'app.err.manifest.invalid',
      'page.time_zone must be a string of length 1..64',
      '/page/time_zone',
    );
  }
  if ('generated_at' in p && !isRfc3339ish(p.generated_at)) {
    return fail(
      'app.err.manifest.invalid',
      'page.generated_at must be RFC 3339',
      '/page/generated_at',
    );
  }
  return null;
}

function isRfc3339ish(v: unknown): boolean {
  return typeof v === 'string' && v.length >= 10 && Number.isFinite(Date.parse(v));
}

/**
 * Emit-side check for the `navigation` block.
 */
export function validateNavigation(nav: unknown): ValidationFailure | null {
  if (nav === undefined) return null;
  if (!nav || typeof nav !== 'object' || Array.isArray(nav)) {
    return fail('app.err.manifest.invalid', 'navigation must be an object', '/navigation');
  }
  const n = nav as Record<string, unknown>;
  for (const k of Object.keys(n)) {
    if (FORBIDDEN_KEYS.has(k) || !NAV_MEMBERS.has(k)) {
      return fail(
        'app.err.manifest.invalid',
        `Unexpected navigation member: ${k}`,
        `/navigation/${k}`,
      );
    }
  }
  const lists = ['breadcrumb', 'related'] as const;
  for (const key of lists) {
    const arr = n[key];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) {
      return fail(
        'app.err.manifest.invalid',
        `navigation.${key} must be an array`,
        `/navigation/${key}`,
      );
    }
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] as Record<string, unknown>;
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.label !== 'string' ||
        typeof item.url !== 'string'
      ) {
        return fail(
          'app.err.manifest.invalid',
          `navigation.${key}[${i}] requires label + url`,
          `/navigation/${key}/${i}`,
        );
      }
      for (const k of Object.keys(item)) {
        if (FORBIDDEN_KEYS.has(k) || !NAV_ITEM_MEMBERS.has(k)) {
          return fail(
            'app.err.manifest.invalid',
            `Unexpected navigation item member: ${k}`,
            `/navigation/${key}/${i}/${k}`,
          );
        }
      }
      if (item.rel !== undefined && !NAV_ITEM_RELS.has(item.rel as string)) {
        return fail(
          'app.err.manifest.invalid',
          `navigation.${key}[${i}].rel not in enum`,
          `/navigation/${key}/${i}/rel`,
        );
      }
      if (
        item.page_id !== undefined &&
        (typeof item.page_id !== 'string' || !PAGE_ID_RE.test(item.page_id))
      ) {
        return fail(
          'app.err.manifest.invalid',
          `navigation.${key}[${i}].page_id invalid`,
          `/navigation/${key}/${i}/page_id`,
        );
      }
    }
  }
  if (n.anchors !== undefined) {
    if (!Array.isArray(n.anchors) || n.anchors.length > 32) {
      return fail(
        'app.err.manifest.invalid',
        'navigation.anchors must be an array of at most 32',
        '/navigation/anchors',
      );
    }
    for (let i = 0; i < n.anchors.length; i++) {
      const a = n.anchors[i] as Record<string, unknown>;
      if (!a || typeof a !== 'object' || typeof a.id !== 'string' || typeof a.label !== 'string') {
        return fail(
          'app.err.manifest.invalid',
          `navigation.anchors[${i}] requires id + label`,
          `/navigation/anchors/${i}`,
        );
      }
    }
  }
  return null;
}

/**
 * Emit-side check for `present`: closed member sets at every level (root,
 * section, component, column, tab, theme, a11y, responsive/breakpoints) per
 * the schema — a schema-invalid layout/section/component breaks strict
 * clients. Forbidden keys are still banned anywhere inside. `meta` stays
 * open; `validateMeta` only checks shape + forbidden keys.
 */
export const PRESENT_MEMBERS = new Set([
  'layout',
  'theme',
  'sections',
  'components',
  'a11y',
  'responsive',
]);
export const PRESENT_LAYOUTS = new Set([
  'list',
  'grid',
  'detail',
  'form',
  'dashboard',
  'chat',
  'table',
  'card',
]);
export const SECTION_MEMBERS = new Set([
  'id',
  'label',
  'state_path',
  'layout',
  'columns',
  'sortable_by',
  'filterable_by',
  'primary_action',
  'item_key',
  'item_label',
  'empty_message',
]);
export const COLUMN_MEMBERS = new Set(['key', 'label', 'format', 'align', 'width']);
export const COLUMN_FORMATS = new Set([
  'number',
  'currency',
  'date',
  'datetime',
  'percent',
  'duration_min',
]);
export const COLUMN_ALIGNS = new Set(['left', 'center', 'right']);
export const COMPONENT_TYPES = new Set([
  'input',
  'textarea',
  'button',
  'select',
  'slider',
  'toggle',
  'checkbox_group',
  'radio_group',
  'datepicker',
  'datetimepicker',
  'table',
  'card',
  'chart',
  'image',
  'link',
  'banner',
  'tabs',
  'breadcrumbs',
  'spinner',
  'price',
  'badge',
  'hidden',
  'order',
  'geopoint',
  'otp',
  'challenge',
  'consent',
  'gallery',
  'calendar',
  'stepper',
]);
export const COMPONENT_MEMBERS = new Set([
  'type',
  'action_id',
  'param',
  'state_path',
  'label',
  'variant',
  'param_map',
  'url',
  'chart_kind',
  'tabs',
]);
export const COMPONENT_VARIANTS = new Set(['primary', 'secondary', 'danger', 'ghost']);
export const CHART_KINDS = new Set(['line', 'bar', 'pie']);
export const TAB_MEMBERS = new Set(['label', 'section']);
export const THEME_MEMBERS = new Set(['palette', 'dark', 'font_display', 'font_body']);
export const A11Y_MEMBERS = new Set(['page_label', 'live_region']);
export const LIVE_REGIONS = new Set(['polite', 'assertive', 'off']);
export const RESPONSIVE_MEMBERS = new Set(['breakpoints']);
export const BREAKPOINT_MEMBERS = new Set(['xs', 'sm', 'md', 'lg', 'xl']);
const SECTION_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const COMPONENT_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const DOT_PATH_RE = /^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$/;

function checkLayout(v: unknown, path: string): ValidationFailure | null {
  if (typeof v !== 'string' || !PRESENT_LAYOUTS.has(v)) {
    return fail('app.err.manifest.invalid', `bad layout at ${path}`, path);
  }
  return null;
}

function checkDotPath(v: unknown, path: string): ValidationFailure | null {
  if (typeof v !== 'string' || v.length < 1 || v.length > 256 || !DOT_PATH_RE.test(v)) {
    return fail('app.err.manifest.invalid', `bad state_path at ${path}`, path);
  }
  return null;
}

function checkColumns(v: unknown, path: string): ValidationFailure | null {
  if (!Array.isArray(v) || v.length > 32) {
    return fail('app.err.manifest.invalid', `columns must be an array <= 32`, path);
  }
  for (let i = 0; i < v.length; i++) {
    const c = v[i];
    const cp = `${path}/${i}`;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      return fail('app.err.manifest.invalid', `column must be an object`, cp);
    }
    for (const k of Object.keys(c)) {
      if (!COLUMN_MEMBERS.has(k)) {
        return fail('app.err.manifest.invalid', `unknown column member ${k}`, cp);
      }
    }
    const col = c as Record<string, unknown>;
    if (typeof col.key !== 'string' || col.key.length < 1 || col.key.length > 64) {
      return fail('app.err.manifest.invalid', `column.key required 1-64 chars`, `${cp}/key`);
    }
    if (col.label !== undefined && (typeof col.label !== 'string' || col.label.length > 100)) {
      return fail('app.err.manifest.invalid', `column.label must be a string <= 100`, cp);
    }
    if (col.format !== undefined && !COLUMN_FORMATS.has(col.format as string)) {
      return fail('app.err.manifest.invalid', `bad column.format`, `${cp}/format`);
    }
    if (col.align !== undefined && !COLUMN_ALIGNS.has(col.align as string)) {
      return fail('app.err.manifest.invalid', `bad column.align`, `${cp}/align`);
    }
    if (col.width !== undefined && (typeof col.width !== 'string' || col.width.length > 32)) {
      return fail('app.err.manifest.invalid', `bad column.width`, cp);
    }
  }
  return null;
}

function checkStringArray(v: unknown, path: string, max: number): ValidationFailure | null {
  if (!Array.isArray(v) || v.length > max) {
    return fail('app.err.manifest.invalid', `${path} must be an array <= ${max}`, path);
  }
  for (const s of v) {
    if (typeof s !== 'string' || s.length > 64) {
      return fail('app.err.manifest.invalid', `${path} items must be strings <= 64`, path);
    }
  }
  return null;
}

function checkSection(sec: unknown, path: string): ValidationFailure | null {
  if (!sec || typeof sec !== 'object' || Array.isArray(sec)) {
    return fail('app.err.manifest.invalid', `section must be an object`, path);
  }
  const s = sec as Record<string, unknown>;
  for (const k of Object.keys(s)) {
    if (!SECTION_MEMBERS.has(k)) {
      return fail('app.err.manifest.invalid', `unknown section member ${k}`, path);
    }
  }
  if (typeof s.id !== 'string' || !SECTION_ID_RE.test(s.id)) {
    return fail('app.err.manifest.invalid', `section.id must match ${SECTION_ID_RE}`, path);
  }
  if (s.label !== undefined && (typeof s.label !== 'string' || s.label.length > 200)) {
    return fail('app.err.manifest.invalid', `section.label invalid`, `${path}/label`);
  }
  if (s.state_path !== undefined) {
    const r = checkDotPath(s.state_path, `${path}/state_path`);
    if (r) return r;
  }
  if (s.layout !== undefined) {
    const r = checkLayout(s.layout, `${path}/layout`);
    if (r) return r;
  }
  if (s.columns !== undefined) {
    const r = checkColumns(s.columns, `${path}/columns`);
    if (r) return r;
  }
  if (s.sortable_by !== undefined) {
    const r = checkStringArray(s.sortable_by, `${path}/sortable_by`, 32);
    if (r) return r;
  }
  if (s.filterable_by !== undefined) {
    const r = checkStringArray(s.filterable_by, `${path}/filterable_by`, 32);
    if (r) return r;
  }
  if (
    s.primary_action !== undefined &&
    (typeof s.primary_action !== 'string' || !ACTION_ID_RE.test(s.primary_action))
  ) {
    return fail(
      'app.err.manifest.invalid',
      `section.primary_action must be an action id`,
      `${path}/primary_action`,
    );
  }
  for (const k of ['item_key', 'item_label'] as const) {
    const v = s[k];
    if (v !== undefined && (typeof v !== 'string' || v.length < 1 || v.length > 64)) {
      return fail('app.err.manifest.invalid', `section.${k} must be a string 1-64`, path);
    }
  }
  if (
    s.empty_message !== undefined &&
    (typeof s.empty_message !== 'string' || s.empty_message.length > 500)
  ) {
    return fail(
      'app.err.manifest.invalid',
      `section.empty_message must be a string <= 500`,
      `${path}/empty_message`,
    );
  }
  return null;
}

function checkComponent(comp: unknown, path: string): ValidationFailure | null {
  if (!comp || typeof comp !== 'object' || Array.isArray(comp)) {
    return fail('app.err.manifest.invalid', `component must be an object`, path);
  }
  const c = comp as Record<string, unknown>;
  for (const k of Object.keys(c)) {
    if (!COMPONENT_MEMBERS.has(k)) {
      return fail('app.err.manifest.invalid', `unknown component member ${k}`, path);
    }
  }
  if (typeof c.type !== 'string' || !COMPONENT_TYPES.has(c.type)) {
    return fail('app.err.manifest.invalid', `component.type not in catalog`, `${path}/type`);
  }
  if (
    c.action_id !== undefined &&
    (typeof c.action_id !== 'string' || !ACTION_ID_RE.test(c.action_id))
  ) {
    return fail(
      'app.err.manifest.invalid',
      `component.action_id must be an action id`,
      `${path}/action_id`,
    );
  }
  if (c.param !== undefined && (typeof c.param !== 'string' || c.param.length > 64)) {
    return fail('app.err.manifest.invalid', `component.param must be <= 64`, `${path}/param`);
  }
  if (c.state_path !== undefined) {
    const r = checkDotPath(c.state_path, `${path}/state_path`);
    if (r) return r;
  }
  if (c.label !== undefined && (typeof c.label !== 'string' || c.label.length > 200)) {
    return fail('app.err.manifest.invalid', `component.label <= 200`, `${path}/label`);
  }
  if (c.variant !== undefined && !COMPONENT_VARIANTS.has(c.variant as string)) {
    return fail('app.err.manifest.invalid', `bad component.variant`, `${path}/variant`);
  }
  if (c.param_map !== undefined) {
    if (typeof c.param_map !== 'object' || c.param_map === null || Array.isArray(c.param_map)) {
      return fail('app.err.manifest.invalid', `param_map must be an object`, `${path}/param_map`);
    }
    for (const v of Object.values(c.param_map)) {
      if (typeof v !== 'string' || v.length > 64) {
        return fail(
          'app.err.manifest.invalid',
          `param_map values must be strings <= 64`,
          `${path}/param_map`,
        );
      }
    }
  }
  if (
    c.url !== undefined &&
    (typeof c.url !== 'string' || c.url.length < 1 || c.url.length > 2048)
  ) {
    return fail('app.err.manifest.invalid', `component.url must be 1-2048 chars`, `${path}/url`);
  }
  if (c.chart_kind !== undefined && !CHART_KINDS.has(c.chart_kind as string)) {
    return fail('app.err.manifest.invalid', `bad component.chart_kind`, `${path}/chart_kind`);
  }
  if (c.tabs !== undefined) {
    if (!Array.isArray(c.tabs) || c.tabs.length > 16) {
      return fail(
        'app.err.manifest.invalid',
        `component.tabs must be an array <= 16`,
        `${path}/tabs`,
      );
    }
    for (let i = 0; i < c.tabs.length; i++) {
      const t = c.tabs[i];
      const tp = `${path}/tabs/${i}`;
      if (!t || typeof t !== 'object' || Array.isArray(t)) {
        return fail('app.err.manifest.invalid', `tab must be an object`, tp);
      }
      for (const k of Object.keys(t)) {
        if (!TAB_MEMBERS.has(k)) {
          return fail('app.err.manifest.invalid', `unknown tab member ${k}`, tp);
        }
      }
      const tab = t as Record<string, unknown>;
      if (
        typeof tab.label !== 'string' ||
        tab.label.length < 1 ||
        tab.label.length > 100 ||
        typeof tab.section !== 'string' ||
        !SECTION_ID_RE.test(tab.section)
      ) {
        return fail('app.err.manifest.invalid', `tab needs label 1-100 and section id`, tp);
      }
    }
  }
  return null;
}

export function validatePresent(present: unknown): ValidationFailure | null {
  if (present === undefined) return null;
  if (!present || typeof present !== 'object' || Array.isArray(present)) {
    return fail('app.err.manifest.invalid', 'present must be an object', '/present');
  }
  const p = present as Record<string, unknown>;
  for (const k of Object.keys(p)) {
    if (!PRESENT_MEMBERS.has(k)) {
      return fail('app.err.manifest.invalid', `unknown present member ${k}`, '/present');
    }
  }
  if (p.layout !== undefined) {
    const r = checkLayout(p.layout, '/present/layout');
    if (r) return r;
  }
  if (p.sections !== undefined) {
    if (!Array.isArray(p.sections) || p.sections.length > 64) {
      return fail(
        'app.err.manifest.invalid',
        'present.sections must be an array <= 64',
        '/present/sections',
      );
    }
    for (let i = 0; i < p.sections.length; i++) {
      const r = checkSection(p.sections[i], `/present/sections/${i}`);
      if (r) return r;
    }
  }
  if (p.components !== undefined) {
    if (typeof p.components !== 'object' || p.components === null || Array.isArray(p.components)) {
      return fail(
        'app.err.manifest.invalid',
        'present.components must be an object',
        '/present/components',
      );
    }
    if (Object.keys(p.components).length > 64) {
      return fail(
        'app.err.manifest.invalid',
        'present.components exceeds 64 entries',
        '/present/components',
      );
    }
    for (const [name, comp] of Object.entries(p.components)) {
      if (!COMPONENT_KEY_RE.test(name)) {
        return fail(
          'app.err.manifest.invalid',
          `component key ${name} must match ${COMPONENT_KEY_RE}`,
          '/present/components',
        );
      }
      const r = checkComponent(comp, `/present/components/${name}`);
      if (r) return r;
    }
  }
  if (p.theme !== undefined) {
    if (typeof p.theme !== 'object' || p.theme === null || Array.isArray(p.theme)) {
      return fail('app.err.manifest.invalid', 'present.theme must be an object', '/present/theme');
    }
    const th = p.theme as Record<string, unknown>;
    for (const k of Object.keys(th)) {
      if (!THEME_MEMBERS.has(k)) {
        return fail('app.err.manifest.invalid', `unknown theme member ${k}`, '/present/theme');
      }
    }
    if (th.palette !== undefined) {
      if (!Array.isArray(th.palette) || th.palette.length > 8) {
        return fail(
          'app.err.manifest.invalid',
          'theme.palette must be an array <= 8',
          '/present/theme/palette',
        );
      }
      for (const c of th.palette) {
        if (typeof c !== 'string' || c.length > 32) {
          return fail(
            'app.err.manifest.invalid',
            'theme.palette items must be strings <= 32',
            '/present/theme/palette',
          );
        }
      }
    }
    if (th.dark !== undefined && typeof th.dark !== 'boolean') {
      return fail(
        'app.err.manifest.invalid',
        'theme.dark must be a boolean',
        '/present/theme/dark',
      );
    }
    for (const k of ['font_display', 'font_body'] as const) {
      const f = th[k];
      if (f !== undefined && (typeof f !== 'string' || f.length < 1 || f.length > 64)) {
        return fail(
          'app.err.manifest.invalid',
          `theme.${k} must be a string 1-64`,
          `/present/theme/${k}`,
        );
      }
    }
  }
  if (p.a11y !== undefined) {
    if (typeof p.a11y !== 'object' || p.a11y === null || Array.isArray(p.a11y)) {
      return fail('app.err.manifest.invalid', 'present.a11y must be an object', '/present/a11y');
    }
    const a = p.a11y as Record<string, unknown>;
    for (const k of Object.keys(a)) {
      if (!A11Y_MEMBERS.has(k)) {
        return fail('app.err.manifest.invalid', `unknown a11y member ${k}`, '/present/a11y');
      }
    }
    if (
      a.page_label !== undefined &&
      (typeof a.page_label !== 'string' || a.page_label.length < 1 || a.page_label.length > 200)
    ) {
      return fail(
        'app.err.manifest.invalid',
        'a11y.page_label must be a string 1-200',
        '/present/a11y/page_label',
      );
    }
    if (a.live_region !== undefined && !LIVE_REGIONS.has(a.live_region as string)) {
      return fail(
        'app.err.manifest.invalid',
        'a11y.live_region not in enum',
        '/present/a11y/live_region',
      );
    }
  }
  if (p.responsive !== undefined) {
    if (typeof p.responsive !== 'object' || p.responsive === null || Array.isArray(p.responsive)) {
      return fail(
        'app.err.manifest.invalid',
        'present.responsive must be an object',
        '/present/responsive',
      );
    }
    const r = p.responsive as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (!RESPONSIVE_MEMBERS.has(k)) {
        return fail(
          'app.err.manifest.invalid',
          `unknown responsive member ${k}`,
          '/present/responsive',
        );
      }
    }
    if (r.breakpoints !== undefined) {
      if (
        typeof r.breakpoints !== 'object' ||
        r.breakpoints === null ||
        Array.isArray(r.breakpoints)
      ) {
        return fail(
          'app.err.manifest.invalid',
          'responsive.breakpoints must be an object',
          '/present/responsive/breakpoints',
        );
      }
      for (const [k, bp] of Object.entries(r.breakpoints)) {
        if (!BREAKPOINT_MEMBERS.has(k)) {
          return fail(
            'app.err.manifest.invalid',
            `unknown breakpoint ${k}`,
            '/present/responsive/breakpoints',
          );
        }
        if (typeof bp !== 'number' || !Number.isInteger(bp) || bp < 0) {
          return fail(
            'app.err.manifest.invalid',
            'breakpoints must be integers >= 0',
            `/present/responsive/breakpoints/${k}`,
          );
        }
      }
    }
  }
  return forbiddenIn(present, '/present');
}

/**
 * Emit-side check for the top-level `meta` block: object + no forbidden keys.
 */
export function validateMeta(meta: unknown): ValidationFailure | null {
  if (meta === undefined) return null;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return fail('app.err.manifest.invalid', 'meta must be an object', '/meta');
  }
  return forbiddenIn(meta, '/meta');
}

/**
 * Validate the action graph of a manifest about to be served.
 * Returns a ValidationFailure on the first problem, null when clean.
 */
export function validateManifestActions(manifest: PageManifest): ValidationFailure | null {
  const actions = manifest.actions ?? {};
  const names = Object.keys(actions);
  if (names.length > MAX_ACTIONS_PER_PAGE) {
    return fail(
      'app.err.action.too_many',
      `Page declares ${names.length} actions; the cap is ${MAX_ACTIONS_PER_PAGE}`,
      '/actions',
    );
  }
  for (const [name, def] of Object.entries(actions)) {
    if (!ACTION_ID_RE.test(name)) {
      return fail('app.err.action.invalid_id', `Illegal action id: ${name}`, `/actions/${name}`);
    }
    if (!def || typeof def !== 'object') {
      return fail('app.err.action.invalid_def', 'action def must be an object', `/actions/${name}`);
    }
    for (const k of Object.keys(def)) {
      if (FORBIDDEN_KEYS.has(k)) {
        return fail('app.err.action.invalid_def', `Forbidden key: ${k}`, `/actions/${name}/${k}`);
      }
      if (!ACTION_DEF_MEMBERS.has(k)) {
        return fail(
          'app.err.action.invalid_def',
          `Unexpected action member: ${k}`,
          `/actions/${name}/${k}`,
        );
      }
    }
    if (typeof def.description !== 'string' || def.description.length === 0) {
      return fail(
        'app.err.action.invalid_def',
        'action requires a description',
        `/actions/${name}/description`,
      );
    }
    if (typeof def.kind !== 'string' || !ACTION_KINDS.has(def.kind)) {
      return fail(
        'app.err.action.invalid_def',
        `Unknown action kind: ${String(def.kind)}`,
        `/actions/${name}/kind`,
      );
    }
    if (def.side_effect !== undefined && !SIDE_EFFECTS.has(def.side_effect)) {
      return fail(
        'app.err.action.invalid_def',
        `Unknown side_effect: ${String(def.side_effect)}`,
        `/actions/${name}/side_effect`,
      );
    }
    for (const [paramName, paramDef] of Object.entries(def.input ?? {})) {
      const err = validateParamDef(paramDef, `/actions/${name}/input/${paramName}`);
      if (err) return err;
      const osErr = validateOptionsSource(paramDef, actions, `/actions/${name}/input/${paramName}`);
      if (osErr) return osErr;
      const os = paramDef?.options_source;
      if (os && typeof os === 'object') {
        for (const k of Object.keys(os)) {
          if (FORBIDDEN_KEYS.has(k) || !OPTIONS_SOURCE_MEMBERS.has(k)) {
            return fail(
              'app.err.action.invalid_def',
              `Unexpected options_source member: ${k}`,
              `/actions/${name}/input/${paramName}/options_source/${k}`,
            );
          }
        }
      }
    }
  }
  return null;
}
