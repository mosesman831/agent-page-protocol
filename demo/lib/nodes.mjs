/**
 * Tiny state-node builders for the demo manifests. Mirrors
 * packages/conformance/src/server/fixtures.ts conventions: every leaf is a
 * typed state node ({ type, value, ... }) and only typed nodes appear in state.
 */

export const str = (value, label) => ({
  type: 'string',
  value,
  ...(label ? { label } : {}),
});

export const num = (value, opts = {}) => ({ type: 'number', value, ...opts });

/** Integer-scaled money: money(84500, 'GBP') renders as £845.00. */
export const money = (value, unit = 'GBP', scale = 2) => ({
  type: 'number',
  value,
  unit,
  scale,
});

export const bool = (value, label) => ({ type: 'boolean', value, ...(label ? { label } : {}) });

export const date = (value, label) => ({ type: 'date', value, ...(label ? { label } : {}) });

export const datetime = (value, label) => ({
  type: 'datetime',
  value,
  ...(label ? { label } : {}),
});

export const enumN = (value, options, option_labels, label) => ({
  type: 'enum',
  value,
  options,
  ...(option_labels ? { option_labels } : {}),
  ...(label ? { label } : {}),
});

export const daterange = (from, to, label) => ({
  type: 'daterange',
  value: { from, to },
  ...(label ? { label } : {}),
});

/** Object node: { key: node }. `label` becomes the section heading. */
export const obj = (value, label) => ({
  type: 'object',
  value,
  ...(label ? { label } : {}),
});

/** Array node: value is an array of item nodes (usually obj()). */
export const arr = (items, label) => ({
  type: 'array',
  value: items,
  ...(label ? { label } : {}),
});

/** Table node: fields map column->type, rows are plain arrays. */
export const table = (fields, rows, label) => ({
  type: 'table',
  fields,
  value: rows,
  ...(label ? { label } : {}),
});

export const file = (url, name, mime, extra = {}) => ({
  type: 'file',
  value: { url, name, mime, ...extra },
});

export const geopoint = (lat, lng, label) => ({
  type: 'geopoint',
  value: { lat, lng, label },
});

export const order = (value, label) => ({ type: 'order', value, ...(label ? { label } : {}) });

/** Full action-def (all schema-required fields). */
export const action = (description, kind, side_effect, extra = {}) => ({
  description,
  kind,
  input: {},
  output: {},
  side_effect,
  idempotent: side_effect === 'safe',
  timeout_ms: 15000,
  ...extra,
});

export const navAction = (description, url, extra = {}) =>
  action(description, 'navigate', 'safe', { output: { navigates_to: url }, ...extra });

/** Assemble a page manifest. */
export const doc = ({ id, origin, path, title, version, state, present, actions, navigation }) => ({
  app: '1.1',
  page: {
    id,
    url: `${origin}${path}`,
    title,
    version,
    language: 'en-GB',
  },
  state,
  ...(present ? { present } : {}),
  ...(actions ? { actions } : {}),
  ...(navigation ? { navigation } : {}),
});

/** SPEC-WEB-NODES node builders (v1.2 web-app element types). */
export const embed = (url, description, opts = {}) => ({
  type: 'embed',
  url,
  description,
  ...opts,
});
export const markdown = (value, label) => ({
  type: 'markdown',
  value,
  ...(label ? { label } : {}),
});
export const media = (items, label) => ({
  type: 'media',
  value: items,
  ...(label ? { label } : {}),
});
export const tree = (items, label) => ({
  type: 'tree',
  value: items,
  ...(label ? { label } : {}),
});
