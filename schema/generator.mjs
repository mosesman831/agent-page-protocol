/**
 * Seeded generative manifest fuzzer.
 *
 * Mutational fuzzing explores the invalid-document space; this explores the
 * VALID space — random manifests that must satisfy every schema rule AND the
 * stricter emit-side semantics (enum value ∈ options, option_labels ⊆
 * options, daterange from≤to, table row length == field count, closed member
 * sets). A generated doc that fails schema is a generator bug — the test
 * asserts validity rather than tolerating invalid output.
 */
const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const int = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const maybe = (rng, p) => rng() < p;

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';
const str = (rng, alphabet, len) =>
  Array.from({ length: len }, () => alphabet[Math.floor(rng() * alphabet.length)]).join('');
const word = (rng, min = 2, max = 10) => str(rng, LOWER, int(rng, min, max));
const snake = (rng) =>
  word(rng, 1, 3) + (maybe(rng, 0.6) ? '_' + str(rng, ALNUM, int(rng, 1, 8)) : '');
const pageId = (rng) =>
  word(rng, 1, 4) +
  (maybe(rng, 0.4) ? pick(rng, ['-', '_']) + str(rng, ALNUM, int(rng, 1, 6)) : '');
const sentence = (rng) => Array.from({ length: int(rng, 2, 6) }, () => word(rng)).join(' ');

const date = (rng) => {
  const m = int(rng, 1, 12);
  const maxD = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${int(rng, 2024, 2027)}-${String(m).padStart(2, '0')}-${String(int(rng, 1, maxD)).padStart(2, '0')}`;
};
const datetime = (rng) =>
  `${date(rng)}T${String(int(rng, 0, 23)).padStart(2, '0')}:${String(int(rng, 0, 59)).padStart(2, '0')}:${String(int(rng, 0, 59)).padStart(2, '0')}Z`;

const NODE_TYPES = [
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
];
const ORDER_STATUSES = [
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
];
const PAYMENT_STATUSES = [
  'unpaid',
  'requires_action',
  'processing',
  'succeeded',
  'failed',
  'cancelled',
];
const TABLE_FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'datetime',
  'enum',
  'file',
  'null',
  'any',
];
const UNITS = ['kg', 'm', 's', 'USD', 'items', 'km_h', 'pct%', 'oz', 'lb', 'cm2'];
const MIME = ['application/pdf', 'image/png', 'text/csv', 'application/json'];

function tableCell(rng, type) {
  switch (type) {
    case 'string':
      return word(rng);
    case 'number':
      return int(rng, -1000, 1000);
    case 'boolean':
      return maybe(rng, 0.5);
    case 'date':
      return date(rng);
    case 'datetime':
      return datetime(rng);
    case 'enum':
      return word(rng);
    case 'file':
      return {
        url: `https://files.local/${word(rng)}.pdf`,
        name: `${word(rng)}.pdf`,
        mime: pick(rng, MIME),
      };
    case 'null':
      return null;
    default:
      return pick(rng, [word(rng), int(rng, 0, 99), null, maybe(rng, 0.5)]);
  }
}

function node(rng, depth) {
  const pool = depth >= 2 ? NODE_TYPES.filter((t) => t !== 'array' && t !== 'object') : NODE_TYPES;
  const type = pick(rng, pool);
  const n = { type };
  if (maybe(rng, 0.3)) n.label = sentence(rng);
  switch (type) {
    case 'string':
      n.value = sentence(rng);
      if (maybe(rng, 0.15)) n.secret = true;
      break;
    case 'number':
      n.value = maybe(rng, 0.7) ? int(rng, -10000, 10000) : Math.round(rng() * 10000) / 100;
      if (maybe(rng, 0.2)) n.unit = pick(rng, UNITS);
      if (maybe(rng, 0.15)) {
        n.scale = int(rng, 0, 4);
        n.value = int(rng, 0, 99999);
      }
      if (maybe(rng, 0.1)) n.min = int(rng, -100, -1);
      if (maybe(rng, 0.1)) n.max = int(rng, 1, 1000);
      if (n.min !== undefined && n.value < n.min) n.value = n.min;
      if (n.max !== undefined && n.value > n.max) n.value = n.max;
      break;
    case 'boolean':
      n.value = maybe(rng, 0.5);
      break;
    case 'null':
      break;
    case 'date':
      n.value = date(rng);
      break;
    case 'datetime':
      n.value = datetime(rng);
      break;
    case 'enum': {
      const opts = [...new Set(Array.from({ length: int(rng, 1, 5) }, () => word(rng)))];
      n.options = opts;
      n.value = pick(rng, opts);
      if (maybe(rng, 0.3)) {
        n.option_labels = {};
        for (const o of opts) if (maybe(rng, 0.5)) n.option_labels[o] = sentence(rng);
      }
      break;
    }
    case 'array': {
      const len = int(rng, 0, 4);
      n.value = Array.from({ length: len }, () => node(rng, depth + 1));
      if (maybe(rng, 0.3)) n.item_label = word(rng);
      if (maybe(rng, 0.3)) {
        const cursor = maybe(rng, 0.7) ? `cur_${str(rng, ALNUM, 8)}` : null;
        let has_more = maybe(rng, 0.5);
        // Emit-side invariant (§5.2, TV-04): cursor null + has_more true is
        // contradictory — servers normalize before emit, so generated docs
        // must already be normalized.
        if (cursor === null && has_more) has_more = false;
        n.pagination = {
          cursor,
          has_more,
          total: maybe(rng, 0.7) ? len + int(rng, 0, 50) : null,
        };
      }
      break;
    }
    case 'object': {
      n.value = {};
      for (let i = 0, c = int(rng, 1, 3); i < c; i++) n.value[snake(rng)] = node(rng, depth + 1);
      break;
    }
    case 'file':
      n.value = {
        url: `https://files.local/${word(rng)}.pdf`,
        name: `${word(rng)}.pdf`,
        mime: pick(rng, MIME),
        ...(maybe(rng, 0.3) ? { size: int(rng, 1, 1e6) } : {}),
      };
      break;
    case 'table': {
      const fieldKeys = [...new Set(Array.from({ length: int(rng, 1, 3) }, () => snake(rng)))];
      const fieldTypes = fieldKeys.map(() => pick(rng, TABLE_FIELD_TYPES));
      n.fields = Object.fromEntries(fieldKeys.map((k, i) => [k, fieldTypes[i]]));
      n.value = Array.from({ length: int(rng, 0, 3) }, () =>
        fieldTypes.map((t) => tableCell(rng, t)),
      );
      break;
    }
    case 'geopoint':
      n.value = {
        lat: Math.round((rng() * 180 - 90) * 1e5) / 1e5,
        lng: Math.round((rng() * 360 - 180) * 1e5) / 1e5,
      };
      if (maybe(rng, 0.3)) n.value.accuracy_m = Math.round(rng() * 1000);
      if (maybe(rng, 0.2)) n.value.label = sentence(rng);
      break;
    case 'quantity':
      n.value = { value: int(rng, 0, 1000), unit: pick(rng, UNITS) };
      if (maybe(rng, 0.2)) {
        n.scale = int(rng, 0, 3);
        n.value.value = int(rng, 0, 1000);
      }
      break;
    case 'order': {
      n.value = {
        id: `ord_${str(rng, ALNUM, 8)}`,
        status: pick(rng, ORDER_STATUSES),
      };
      if (maybe(rng, 0.7)) {
        n.value.total = int(rng, 1, 100000);
        n.value.scale = 2;
        n.value.currency = 'GBP';
      }
      if (maybe(rng, 0.5)) {
        n.value.items = Array.from({ length: int(rng, 0, 2) }, () => ({
          sku: `SKU-${str(rng, ALNUM, 5)}`,
          qty: int(rng, 1, 5),
          amount: int(rng, 1, 50000),
        }));
      }
      if (maybe(rng, 0.4)) {
        n.value.payment = {
          status: pick(rng, PAYMENT_STATUSES),
          ...(maybe(rng, 0.5) ? { psp: word(rng) } : {}),
        };
      }
      if (maybe(rng, 0.5)) n.value.created_at = datetime(rng);
      break;
    }
    case 'daterange': {
      const a = date(rng);
      const b = date(rng);
      n.value = a <= b ? { from: a, to: b } : { from: b, to: a };
      break;
    }
    case 'datetimerange': {
      const a = datetime(rng);
      const b = datetime(rng);
      n.value = a <= b ? { from: a, to: b } : { from: b, to: a };
      break;
    }
    case 'embed': {
      n.url = `https://${word(rng)}.example.com/${str(rng, ALNUM, 6)}`;
      n.description = sentence(rng);
      if (maybe(rng, 0.4)) {
        n.sandbox = [
          ...new Set(
            Array.from({ length: int(rng, 1, 3) }, () =>
              pick(rng, ['scripts', 'forms', 'popups', 'same-origin']),
            ),
          ),
        ];
      }
      if (maybe(rng, 0.3)) n.height = int(rng, 100, 600);
      break;
    }
    case 'markdown': {
      n.value = `## ${sentence(rng)}\n\n- ${sentence(rng)}\n- **${word(rng)}** ${sentence(rng)}`;
      break;
    }
    case 'media': {
      n.value = Array.from({ length: int(rng, 1, 4) }, () => ({
        url: `https://${word(rng)}.example.com/${str(rng, ALNUM, 8)}.png`,
        ...(maybe(rng, 0.5) ? { alt: sentence(rng) } : {}),
        ...(maybe(rng, 0.4) ? { kind: pick(rng, ['image', 'video', 'audio']) } : {}),
      }));
      break;
    }
    case 'tree': {
      const treeItem = (depth) => ({
        id: `${word(rng)}_${str(rng, ALNUM, 4)}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
        label: sentence(rng).slice(0, 64) || 'node',
        ...(depth < 3 && maybe(rng, 0.5)
          ? { children: Array.from({ length: int(rng, 1, 3) }, () => treeItem(depth + 1)) }
          : {}),
      });
      n.value = Array.from({ length: int(rng, 1, 4) }, () => treeItem(1));
      break;
    }
  }
  return n;
}

const PARAM_TYPES = [
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
];

function paramDef(rng) {
  const p = { type: pick(rng, PARAM_TYPES) };
  if (maybe(rng, 0.4)) p.description = sentence(rng);
  if (maybe(rng, 0.3)) p.required = maybe(rng, 0.7);
  if (p.type === 'enum')
    p.options = [...new Set(Array.from({ length: int(rng, 1, 4) }, () => word(rng)))];
  if (p.type === 'array')
    p.item_type = {
      type: pick(
        rng,
        PARAM_TYPES.filter((t) => t !== 'array'),
      ),
    };
  if (maybe(rng, 0.1)) p.default = p.type === 'number' ? int(rng, 0, 99) : word(rng);
  return p;
}

function actionDef(rng) {
  const a = {
    description: sentence(rng),
    kind: pick(rng, ['query', 'mutate', 'navigate', 'confirm', 'delegate']),
  };
  if (maybe(rng, 0.5)) a.side_effect = pick(rng, ['safe', 'destructive', 'financial', 'identity']);
  const paramCount = int(rng, 0, 3);
  if (paramCount > 0) {
    a.input = {};
    for (let i = 0; i < paramCount; i++) a.input[snake(rng)] = paramDef(rng);
  }
  if (maybe(rng, 0.2)) a.idempotent = true;
  if (maybe(rng, 0.2)) a.requires_confirmation = true;
  if (maybe(rng, 0.15)) a.param_mode = pick(rng, ['strict', 'lenient']);
  if (maybe(rng, 0.15)) a.confirm = { title: sentence(rng), body_template: sentence(rng) };
  return a;
}

const LAYOUTS = ['list', 'grid', 'detail', 'form', 'dashboard', 'chat', 'table', 'card'];
const COMPONENT_TYPES = [
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
];
const NAV_RELS = ['up', 'next', 'prev', 'related', 'alternate'];

function genPresent(rng, actionIds) {
  const p = { layout: pick(rng, LAYOUTS) };
  const secCount = int(rng, 0, 3);
  if (secCount) {
    p.sections = Array.from({ length: secCount }, () => {
      const s = { id: pageId(rng) };
      if (maybe(rng, 0.5)) s.label = sentence(rng);
      if (maybe(rng, 0.4)) s.layout = pick(rng, LAYOUTS);
      if (maybe(rng, 0.3))
        s.columns = Array.from({ length: int(rng, 1, 3) }, () => {
          const c = { key: snake(rng) };
          if (maybe(rng, 0.4)) c.label = word(rng, 2, 8);
          if (maybe(rng, 0.3))
            c.format = pick(rng, [
              'number',
              'currency',
              'date',
              'datetime',
              'percent',
              'duration_min',
            ]);
          if (maybe(rng, 0.3)) c.align = pick(rng, ['left', 'center', 'right']);
          return c;
        });
      if (actionIds.length && maybe(rng, 0.3)) s.primary_action = pick(rng, actionIds);
      return s;
    });
  }
  if (maybe(rng, 0.5)) {
    p.components = {};
    for (let i = 0, c = int(rng, 1, 3); i < c; i++) {
      const comp = { type: pick(rng, COMPONENT_TYPES) };
      if (maybe(rng, 0.4)) comp.label = word(rng, 2, 8);
      if (maybe(rng, 0.3)) comp.variant = pick(rng, ['primary', 'secondary', 'danger', 'ghost']);
      if (actionIds.length && maybe(rng, 0.4)) comp.action_id = pick(rng, actionIds);
      if (comp.type === 'chart') comp.chart_kind = pick(rng, ['line', 'bar', 'pie']);
      p.components[snake(rng)] = comp;
    }
  }
  return p;
}

/** Generate one schema-valid (by construction) manifest for a seed. */
export function generateManifest(seed) {
  const rng = mulberry32(seed);
  const id = pageId(rng);
  const doc = {
    app: pick(rng, ['1.0', '1.1']),
    page: {
      id,
      url: `http://127.0.0.1:8788/gen/${id}`,
      version: `v${int(rng, 1, 99)}`,
      title: sentence(rng),
    },
    state: {},
  };
  for (let i = 0, c = int(rng, 1, 6); i < c; i++) doc.state[snake(rng)] = node(rng, 0);
  if (maybe(rng, 0.8)) {
    doc.actions = {};
    for (let i = 0, c = int(rng, 1, 4); i < c; i++) doc.actions[snake(rng)] = actionDef(rng);
  }
  const actionIds = Object.keys(doc.actions ?? {});
  if (maybe(rng, 0.8)) doc.present = genPresent(rng, actionIds);
  if (maybe(rng, 0.4)) {
    doc.navigation = {};
    const navItem = () => {
      const it = { label: word(rng, 1, 12), url: `http://127.0.0.1:8788/gen/${pageId(rng)}` };
      if (maybe(rng, 0.5)) it.page_id = `pg_${str(rng, ALNUM, 5)}`;
      if (maybe(rng, 0.5)) it.rel = pick(rng, NAV_RELS);
      return it;
    };
    if (maybe(rng, 0.7))
      doc.navigation.breadcrumb = Array.from({ length: int(rng, 1, 3) }, navItem);
    if (maybe(rng, 0.5)) doc.navigation.related = Array.from({ length: int(rng, 1, 2) }, navItem);
    if (maybe(rng, 0.3))
      doc.navigation.anchors = Array.from({ length: int(rng, 1, 2) }, () => ({
        id: snake(rng),
        label: word(rng, 1, 12),
        pointer: `/state/${snake(rng)}`,
      }));
  }
  if (maybe(rng, 0.3)) doc.meta = { generated_by: 'genfuzz', seed: int(rng, 0, 1e9) };
  return doc;
}

export { mulberry32 };
