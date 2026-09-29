/**
 * Harness fixture generator.
 *
 * The .harness/fixtures/*.json files are GENERATED artifacts, not hand-written
 * copies. StateNode leaves are built with @agent-page/conformance's node
 * builders (strNode/numNode/enumNode/boolNode) so the skin fixtures share the
 * same node construction as the 142 protocol vectors; composite/labeled nodes
 * use the same shapes with the fixture key order (type, label, value).
 *
 *   node extension/.harness/generate-fixtures.mjs          # write fixtures
 *   node extension/.harness/generate-fixtures.mjs --check  # drift check (used by npm test)
 *
 * Requires `npm run build` first (imports the built conformance package).
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prettier from 'prettier';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, 'fixtures');
const CONFORMANCE_FIXTURES = join(HERE, '../../packages/conformance/dist/server/fixtures.js');

if (!existsSync(CONFORMANCE_FIXTURES)) {
  console.error(
    'generate-fixtures: packages/conformance/dist not built. Run `npm run build` first.',
  );
  process.exit(2);
}

const { strNode, numNode, enumNode, boolNode } = await import(CONFORMANCE_FIXTURES);

/* ---------- local builders for shapes conformance builders don't cover ---------- */
// Key order matches the fixtures on disk: type, label?, then payload keys.
const labeled = (type, label, rest) => ({ type, label, ...rest });
const objNode = (value, label) =>
  label ? labeled('object', label, { value }) : { type: 'object', value };
const arrNode = (value, label) =>
  label ? labeled('array', label, { value }) : { type: 'array', value };
const orderNode = (value, label) => ({ type: 'order', label, value });
const tableNode = (fields, value, pagination, extra = {}) => ({
  type: 'table',
  ...extra,
  fields,
  value,
  pagination,
});
const moneyNode = (value, label) => ({
  type: 'number',
  value,
  unit: 'GBP',
  scale: 2,
  ...(label ? { label } : {}),
});

const ORIGIN = 'http://127.0.0.1:8765'; // baked into fixtures; harness rewrites to serving origin
const img = (name) => strNode(`${ORIGIN}/extension/assets/img/${name}.jpg`);

const STATUS_OPTS = ['in_stock', 'offer', 'unavailable'];

function flight({
  id,
  title,
  image,
  price,
  status = 'in_stock',
  statusOpts = STATUS_OPTS,
  dep,
  arr,
  dur,
  stops,
  extra = {},
}) {
  const value = {
    id: strNode(id),
    title: strNode(title),
    ...(image !== undefined ? { image: typeof image === 'string' ? img(image) : image } : {}),
    price: typeof price === 'number' ? moneyNode(price) : price,
    // a status value outside the enum's vocabulary stays a bare string (fixtures use this
    // to prove the renderer tolerates out-of-schema leaves)
    ...(typeof status === 'string'
      ? { status: statusOpts.includes(status) ? enumNode(status, statusOpts) : status }
      : { status }),
    ...extra,
    airline: strNode('Demo Air'),
    ...(dep !== undefined ? { departure: strNode(dep) } : {}),
    ...(arr !== undefined ? { arrival: strNode(arr) } : {}),
    ...(dur !== undefined ? { duration: numNode(dur) } : {}),
    ...(stops !== undefined ? { stops: numNode(stops) } : {}),
  };
  return { type: 'object', value };
}

function page({ id, url, title, version, xVendor, state, present, actions }) {
  return {
    app: '1.1',
    ...(xVendor ? { x_vendor: xVendor } : {}),
    page: { id, url: `${ORIGIN}${url}`, title, version },
    state,
    ...(present ? { present: expandAlways(present) } : {}),
    actions,
  };
}

// objects that the checked-in fixtures always render expanded even when they
// would fit on one line (present blocks, sections entries)
const FORCE_EXPAND = new Set();
const expandAlways = (v) => {
  FORCE_EXPAND.add(v);
  return v;
};

const gridSection = expandAlways({
  id: 'flights',
  state_path: 'products',
  layout: 'grid',
  item_key: 'id',
  primary_action: 'select_fare',
  label: 'Flights',
});
const selectFare = {
  kind: 'mutate',
  side_effect: 'safe',
  description: 'Select fare',
  input: {},
  output: {},
};

/* ---------- fixtures ---------- */

function store() {
  return page({
    id: 'skin-store',
    url: '/harness/store',
    title: 'Demo Store - Flights',
    version: 's-1',
    state: {
      products: arrNode(
        [
          flight({
            id: 'fl-001',
            title: 'London -> Dubai',
            image: 'dxb',
            price: 84500,
            dep: '08:40',
            arr: '19:25',
            dur: 525,
            stops: 0,
          }),
          flight({
            id: 'fl-002',
            title: 'London -> Dubai',
            price: 64000,
            dep: '10:15',
            arr: '21:00',
            dur: 525,
            stops: 0,
          }),
          flight({
            id: 'fl-010',
            title: 'London -> New York',
            image: 'jfk',
            price: 38900,
            status: 'offer',
            dep: '07:05',
            arr: '10:20',
            dur: 495,
            stops: 0,
          }),
          flight({
            id: 'fl-020',
            title: 'London -> Singapore',
            image: 'sin',
            price: 91200,
            dep: '20:35',
            arr: '16:55',
            dur: 740,
            stops: 1,
          }),
        ],
        'Flights',
      ),
    },
    present: { layout: 'list', sections: [gridSection] },
    actions: { select_fare: selectFare },
  });
}

function detail() {
  return page({
    id: 'skin-detail',
    url: '/harness/detail/fl-020',
    title: 'London -> Singapore',
    version: 'd-1',
    state: {
      item: labeled('object', 'Flight', {
        value: {
          id: strNode('fl-020'),
          title: strNode('London -> Singapore'),
          image: img('sin'),
          price: moneyNode(91200),
          status: enumNode('offer', ['offer', 'counter_offer', 'in_stock']),
          airline: strNode('Demo Air'),
          departure: strNode('20:35'),
          arrival: strNode('16:55'),
          duration: numNode(740),
          stops: numNode(1),
        },
      }),
    },
    present: {
      layout: 'detail',
      sections: [
        expandAlways({
          id: 'item',
          state_path: 'item',
          layout: 'detail',
          primary_action: 'accept_offer',
          label: 'Flight',
        }),
      ],
    },
    actions: {
      accept_offer: {
        kind: 'mutate',
        side_effect: 'financial',
        description: 'Accept offer',
        input: {},
        output: {},
      },
      reject_offer: {
        kind: 'mutate',
        side_effect: 'safe',
        description: 'Decline offer',
        input: {},
        output: {},
      },
    },
  });
}

function order(paid) {
  const items = [{ sku: 'fl-002', qty: 1, amount: 64000 }];
  const order = {
    id: 'ord-demo-unpaid',
    status: paid ? 'paid' : 'awaiting_payment',
    currency: 'GBP',
    scale: 2,
    total: 64000,
    items,
    payment: paid ? { status: 'succeeded', psp: 'demo' } : { status: 'unpaid', psp: 'demo' },
    created_at: '2026-09-26T08:00:00Z',
    ...(paid ? { updated_at: '2026-09-26T08:01:12Z' } : {}),
  };
  return page({
    id: 'skin-order',
    url: '/harness/order/ord-demo-unpaid',
    title: 'Order ord-demo-unpaid',
    version: paid ? 'o-2' : 'o-1',
    state: {
      session: objNode({
        status: enumNode('authenticated', [
          'anonymous',
          'pending_mfa',
          'pending_consent',
          'authenticated',
          'expired',
          'locked',
        ]),
        user: strNode('demo'),
        signed_in: boolNode(true),
      }),
      order: orderNode(order, 'Order'),
      order_total: expandAlways(moneyNode(64000, 'Total')),
    },
    present: { layout: 'detail' },
    actions: paid
      ? {
          request_refund: {
            kind: 'mutate',
            side_effect: 'financial',
            description: 'Request refund',
            input: {},
            output: {},
          },
        }
      : {
          start_pay: {
            kind: 'navigate',
            side_effect: 'safe',
            description: 'Pay now',
            input: {},
            output: {},
          },
          cancel_order: {
            kind: 'mutate',
            side_effect: 'destructive',
            description: 'Cancel order',
            input: {},
            output: {},
          },
        },
  });
}

const LONG_TITLE =
  'London -> New York via an extremely roundabout scenic routing that keeps going ' +
  'and going past every sensible waypoint until this title reaches a full three ' +
  'hundred characters of absolutely unreasonable length for a product card that ' +
  'still must not overflow its box';

function extras() {
  return page({
    id: 'skin-extras',
    url: '/harness/extras',
    title: 'Demo Store - Extras',
    version: 'x-1',
    xVendor: { partner: 'grok-demo', notes: 'kept for V-SKIN-6' },
    state: {
      currency: strNode('GBP'),
      price_scale: numNode(2),
      products: arrNode(
        [
          flight({
            id: 'fl-001',
            title: 'London -> Dubai',
            image: 'dxb',
            price: 84500,
            dep: '08:40',
            arr: '19:25',
          }),
          flight({
            id: 'fl-002',
            title: 'London -> Dubai',
            price: 64000,
            dep: '10:15',
            arr: '21:00',
          }),
          flight({
            id: 'fl-010',
            title: LONG_TITLE,
            image: 5,
            // fixture proves the renderer tolerates a money leaf with no unit and an
            // out-of-vocabulary status left as a bare string
            price: { type: 'number', value: 38900, scale: 2 },
            status: 'back_ordered',
            extra: {
              badge: strNode('<img src=x onerror=alert(1)>'),
              rating: numNode(4.5),
              meta: objNode({ a: strNode('b') }),
            },
          }),
          flight({
            id: 'fl-020',
            title: 'London -> Singapore',
            image: 'sin',
            price: 91200,
          }),
        ],
        'Flights',
      ),
      results: tableNode(
        {
          id: 'string',
          airline: 'string',
          flight_no: 'string',
          departure: 'string',
          arrival: 'string',
          duration: 'number',
          price: 'number',
          stops: 'number',
          seats_left: 'number',
        },
        [
          ['fl-001', 'Demo Air', 'DA101', '08:40', '19:25', 525, 84500, 0, 9],
          ['fl-002', 'Demo Air', 'DA105', '10:15', '21:00', 525, 64000, 0, 4],
        ],
        { cursor: null, has_more: false, total: 2 },
        { item_label: 'flight' },
      ),
      more: arrNode(
        [
          objNode({ id: strNode('x-1'), title: strNode('Seat upgrade') }),
          objNode({ id: strNode('x-2'), title: strNode('Lounge pass') }),
        ],
        'More',
      ),
    },
    present: {
      layout: 'list',
      sections: [
        gridSection,
        expandAlways({
          id: 'carousel',
          state_path: 'more',
          layout: 'carousel',
          label: 'More options',
        }),
        expandAlways({
          id: 'results',
          state_path: 'results',
          layout: 'table',
          item_key: 'id',
          primary_action: 'select_flight',
          columns: [
            { key: 'airline', label: 'Airline' },
            { key: 'departure', label: 'Depart' },
            { key: 'arrival', label: 'Arrive' },
            { key: 'price', label: 'Price', format: 'currency', align: 'right' },
            { key: 'stops', label: 'Stops' },
          ],
          label: 'Results',
        }),
      ],
    },
    actions: {
      select_fare: selectFare,
      select_flight: {
        kind: 'mutate',
        side_effect: 'safe',
        description: 'Select flight',
        input: {},
        output: {},
      },
    },
  });
}

const GENERATED = {
  'store.json': store,
  'detail.json': detail,
  'order.json': () => order(false),
  'order-paid.json': () => order(true),
  'extras.json': extras,
};

/* ---------- serializer: mirrors the checked-in files' inline/expanded style ---------- */
// Prettier's JSON printer preserves each object's expanded-or-inline choice and
// only expands inline nodes that exceed printWidth, so emit each node inline
// when it fits in 100 cols (counting indentation), else expanded.
function inlineText(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    return v.length ? `[${v.map(inlineText).join(', ')}]` : '[]';
  }
  const entries = Object.entries(v).map(([k, val]) => `${JSON.stringify(k)}: ${inlineText(val)}`);
  return entries.length ? `{ ${entries.join(', ')} }` : '{}';
}

function emit(v, indent = 0, prefixLen = 0) {
  const one = inlineText(v);
  if (
    v === null ||
    typeof v !== 'object' ||
    (!FORCE_EXPAND.has(v) && indent * 2 + prefixLen + one.length <= 100)
  ) {
    return one;
  }
  const pad = '  '.repeat(indent + 1);
  const padEnd = '  '.repeat(indent);
  if (Array.isArray(v)) {
    return `[\n${v.map((x) => pad + emit(x, indent + 1)).join(',\n')}\n${padEnd}]`;
  }
  return `{\n${Object.entries(v)
    .map(
      ([k, val]) =>
        `${pad}${JSON.stringify(k)}: ${emit(val, indent + 1, JSON.stringify(k).length + 2)}`,
    )
    .join(',\n')}\n${padEnd}}`;
}

export async function renderAll() {
  const prettierConfig = (await prettier.resolveConfig(join(FIXTURES_DIR, 'store.json'))) ?? {};
  const out = new Map();
  for (const [name, make] of Object.entries(GENERATED)) {
    const text = await prettier.format(emit(make()), { ...prettierConfig, parser: 'json' });
    out.set(name, text);
  }
  return out;
}

async function main() {
  const check = process.argv.includes('--check');
  const rendered = await renderAll();
  let drift = 0;
  for (const [name, text] of rendered) {
    const path = join(FIXTURES_DIR, name);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (check) {
      if (current !== text) {
        console.error(`DRIFT ${name} — regenerate with npm run gen:fixtures`);
        drift++;
      }
    } else {
      if (current !== text) {
        writeFileSync(path, text);
        console.log(`wrote fixtures/${name}`);
      } else {
        console.log(`fixtures/${name} up to date`);
      }
    }
  }
  if (check) {
    if (drift) process.exit(1);
    console.log('fixtures: all generated files in sync');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
