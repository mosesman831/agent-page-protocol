/**
 * Multiversal Airways — shared data + helpers for the APP manifests.
 * Part of buildMvaPages: see pages.mjs for the assembled Map.
 *
 * MVA is a fictional full-service carrier (callsign MV) used to demo a
 * feature-rich airline site: fare families, seat maps, ancillaries, manage
 * booking, check-in, flight status, loyalty.
 */

import { str, num, money, obj, arr as arrNode, table } from '../lib/nodes.mjs';

export const MVA = (o, slug) => `${o}/app/mva/${slug}`;

// Manifest `media` nodes require https URLs (schema) — image assets always
// resolve through the canonical deployed demo host, whatever the local origin.
export const MVA_ASSETS = 'https://demo-flight-app.vercel.app/demo/files';

export const AIRPORTS_FROM = ['lhr', 'lgw', 'lcy', 'man', 'edi'];
export const AIRPORTS_TO = ['jfk', 'ewr', 'bos', 'ord', 'lax', 'sfo', 'mia', 'dxb', 'sin', 'nrt'];
export const AIRPORT_LABELS = {
  lhr: 'London Heathrow (LHR)',
  lgw: 'London Gatwick (LGW)',
  lcy: 'London City (LCY)',
  man: 'Manchester (MAN)',
  edi: 'Edinburgh (EDI)',
  jfk: 'New York JFK (JFK)',
  ewr: 'Newark (EWR)',
  bos: 'Boston Logan (BOS)',
  ord: "Chicago O'Hare (ORD)",
  lax: 'Los Angeles (LAX)',
  sfo: 'San Francisco (SFO)',
  mia: 'Miami (MIA)',
  dxb: 'Dubai (DXB)',
  sin: 'Singapore Changi (SIN)',
  nrt: 'Tokyo Narita (NRT)',
};
export const CABINS = ['voyager', 'voyager_plus', 'nebula', 'singularity'];
export const CABIN_LABELS = {
  voyager: 'Voyager (economy)',
  voyager_plus: 'Voyager Plus (premium economy)',
  nebula: 'Nebula (business)',
  singularity: 'Singularity (first)',
};
export const MEAL = ['standard', 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'child'];
export const TITLES = ['mr', 'ms', 'mrs', 'dr', 'miss', 'mx'];
export const COUNTRIES = ['gb', 'us', 'ie', 'de', 'fr', 'ae', 'in', 'jp', 'sg'];

/** Fare families — per-flight tier pricing + perks. */
export const FARES = [
  {
    code: 'saver',
    label: 'Saver',
    mult: 1.0,
    perks: ['Cabin bag only', 'Seat assigned at check-in', 'No changes', 'Non-refundable'],
  },
  {
    code: 'classic',
    label: 'Classic',
    mult: 1.28,
    perks: ['Cabin + 1× 23kg bag', 'Free standard seat', 'Changes for a fee', '50% miles'],
  },
  {
    code: 'flex',
    label: 'Flex',
    mult: 1.62,
    perks: ['Cabin + 2× 23kg bags', 'Any seat free', 'Free changes', 'Refundable', '100% miles'],
  },
];

export const AIRCRAFT = {
  'A350-1000': 'Airbus A350-1000',
  'B777-300ER': 'Boeing 777-300ER',
  'B787-9': 'Boeing 787-9',
  'A380-800': 'Airbus A380-800',
};

/** Flight record → manifest object node. */
export function flightCard({ id, fn, dep, arr, depT, arrT, aircraft, dur, co2, stops, price }) {
  return obj(
    {
      id: str(id),
      flight_no: str(fn, 'Flight'),
      depart: str(dep, 'Departs'),
      arrive: str(arr, 'Arrives'),
      dep_terminal: str(depT, 'Dep. terminal'),
      arr_terminal: str(arrT, 'Arr. terminal'),
      aircraft: str(aircraft, 'Aircraft'),
      duration_min: num(dur, { label: 'Duration (min)' }),
      stops: num(stops, { label: 'Stops' }),
      co2_kg: num(co2, { unit: 'kg', label: 'CO2e / pax' }),
      fares: arrNode(
        FARES.map((f) =>
          obj(
            {
              fare: str(f.code),
              label: str(f.label),
              price: money(Math.round((price * f.mult) / 100) * 100, 'GBP'),
              perks: arrNode(f.perks.map((p) => str(p))),
            },
            f.label,
          ),
        ),
        'Fares',
      ),
      seats_left: num(4, { label: 'Seats left at Saver' }),
      operated_by: str('Multiversal Airways', 'Operated by'),
    },
    fn,
  );
}

export const OUTBOUND = [
  {
    id: 'mv11',
    fn: 'MV11',
    dep: '2026-10-12 07:55',
    arr: '2026-10-12 10:40',
    depT: '3',
    arrT: '7',
    aircraft: 'Airbus A350-1000',
    dur: 465,
    co2: 415,
    stops: 0,
    price: 58900,
  },
  {
    id: 'mv17',
    fn: 'MV17',
    dep: '2026-10-12 11:30',
    arr: '2026-10-12 14:20',
    depT: '3',
    arrT: '7',
    aircraft: 'Boeing 777-300ER',
    dur: 470,
    co2: 498,
    stops: 0,
    price: 64100,
  },
  {
    id: 'mv23',
    fn: 'MV23',
    dep: '2026-10-12 14:15',
    arr: '2026-10-12 17:05',
    depT: '5',
    arrT: '8',
    aircraft: 'Boeing 787-9',
    dur: 470,
    co2: 441,
    stops: 0,
    price: 67200,
  },
  {
    id: 'mv31',
    fn: 'MV31',
    dep: '2026-10-12 17:40',
    arr: '2026-10-12 20:25',
    depT: '3',
    arrT: '7',
    aircraft: 'Airbus A380-800',
    dur: 465,
    co2: 520,
    stops: 0,
    price: 61200,
  },
  {
    id: 'mv45',
    fn: 'MV45',
    dep: '2026-10-12 21:10',
    arr: '2026-10-12 23:55',
    depT: '5',
    arrT: '7',
    aircraft: 'Boeing 777-200',
    dur: 465,
    co2: 507,
    stops: 0,
    price: 56400,
  },
  {
    id: 'mv93',
    fn: 'MV93',
    dep: '2026-10-12 09:20',
    arr: '2026-10-12 15:30',
    depT: '3',
    arrT: '4',
    aircraft: 'Boeing 787-9 (1 stop: Reykjavik)',
    dur: 670,
    co2: 610,
    stops: 1,
    price: 44900,
  },
];

export const RETURN = OUTBOUND.map((f, i) => ({
  ...f,
  id: `${f.id}r`,
  fn: `MV${12 + i * 6}`,
  dep: `2026-10-19 ${f.dep.slice(11)}`,
  arr: `2026-10-19 ${f.arr.slice(11)}`,
}));

/** ±3-day flexible-dates price ribbon: date → lowest Saver fare. */
export function flexRibbon(baseDate = '2026-10-12', basePrice = 56400) {
  const rows = [];
  const d = new Date(`${baseDate}T00:00:00Z`);
  const jit = [-3200, -5100, 1800, 0, 2400, 3900, -1100];
  for (let i = -3; i <= 3; i++) {
    const day = new Date(d.getTime() + i * 86400000);
    rows.push([day.toISOString().slice(0, 10), basePrice + jit[i + 3]]);
  }
  return table({ date: 'string', lowest_fare: 'number' }, rows, '±3 days — lowest fare');
}

/** Seat map: rows for a wide-body economy cabin (3-4-3) + exit rows. */
export function seatMap(cabin = 'voyager') {
  const rows = [];
  const taken = new Set(['20B', '21A', '22F', '24K', '26D', '27E', '30A', '33C', '34K']);
  const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'H', 'J', 'K'];
  for (let r = 20; r <= 44; r++) {
    const exitRow = r === 30;
    const preferred = r >= 20 && r <= 23;
    for (const L of letters) {
      const seat = `${r}${L}`;
      const pos = 'ACDK'.includes(L) ? 'window' : 'BEJ'.includes(L) ? 'aisle' : 'middle';
      const type = exitRow ? 'extra_legroom' : preferred ? 'preferred' : 'standard';
      const price = exitRow
        ? 6400
        : preferred
          ? 3300
          : pos === 'window' || pos === 'aisle'
            ? 2100
            : 0;
      rows.push([
        seat,
        r,
        pos,
        type,
        taken.has(seat) ? 'occupied' : 'available',
        cabin === 'saver' ? price : Math.min(price, type === 'standard' ? 0 : price),
      ]);
    }
  }
  return table(
    {
      seat: 'string',
      row: 'number',
      pos: 'enum',
      seat_type: 'enum',
      status: 'enum',
      price: 'number',
    },
    rows,
    'Voyager cabin — rows 20–44',
  );
}

/** Ancillaries catalog — drives extras page + recompute. */
export const EXTRAS = [
  { id: 'bag_23', label: 'Checked bag (23kg)', kind: 'quantity', unit: 3800, max: 3 },
  { id: 'meal_upgrade', label: 'Premium meal', kind: 'enum', options: MEAL, unit: 1400 },
  { id: 'lounge', label: 'Nebula Lounge access', kind: 'boolean', unit: 4500 },
  { id: 'wifi', label: 'Full-flight Wi-Fi', kind: 'boolean', unit: 1199 },
  { id: 'priority', label: 'Priority boarding + security', kind: 'boolean', unit: 900 },
  { id: 'insurance', label: 'Travel insurance', kind: 'boolean', unit: 2200 },
  { id: 'offset', label: 'Carbon offset', kind: 'boolean', unit: 450 },
];

/** Seeded bookings for Manage Booking / Check-in demos. */
export const SEED_BOOKINGS = {
  MV4X8R: {
    ref: 'MV4X8R',
    surname: 'man',
    pax: 'Moses Man (Adult)',
    route: 'London Heathrow (LHR) → New York JFK (JFK)',
    outbound: 'MV17 · Mon 12 Oct 2026 · 11:30 → 14:20',
    return: 'MV18 · Mon 19 Oct 2026 · 21:30 → 09:15+1',
    cabin: 'Voyager (economy)',
    fare: 'Classic',
    seats: { outbound: '24K', return: '24A' },
    bags: 1,
    status: 'confirmed',
    paid: 82100,
    points: 1240,
  },
  MV9T2Q: {
    ref: 'MV9T2Q',
    surname: 'doe',
    pax: 'Jane Doe (Adult)',
    route: 'London Heathrow (LHR) → Tokyo Narita (NRT)',
    outbound: 'MV55 · Fri 16 Oct 2026 · 13:05 → 09:40+1',
    return: 'MV56 · Fri 23 Oct 2026 · 11:25 → 15:55',
    cabin: 'Nebula (business)',
    fare: 'Flex',
    seats: { outbound: '11K', return: '11A' },
    bags: 2,
    status: 'confirmed',
    paid: 312400,
    points: 8600,
  },
};

export const STATUS_BOARD = table(
  {
    flight: 'string',
    route: 'string',
    sched: 'string',
    est: 'string',
    status: 'enum',
    gate: 'string',
  },
  [
    ['MV11', 'LHR → JFK', '07:55', '07:55', 'on_time', 'B32'],
    ['MV17', 'LHR → JFK', '11:30', '11:45', 'delayed', 'C18'],
    ['MV23', 'LHR → JFK', '14:15', '14:15', 'on_time', 'C05'],
    ['MV31', 'LHR → JFK', '17:40', '—', 'boarding', 'A09'],
    ['MV55', 'LHR → NRT', '13:05', '13:05', 'on_time', 'D21'],
    ['MV45', 'LHR → JFK', '21:10', '—', 'scheduled', '—'],
  ],
  "Today's departures",
);

export const DEALS = [
  {
    id: 'deal_tokyo',
    dest: 'Tokyo Narita',
    img: `${MVA_ASSETS}/mva-tokyo.jpg`,
    price: 61200,
    blurb: 'Cherry-season saver fares — Nebula from £2,140.',
    code: 'nrt',
  },
  {
    id: 'deal_nyc',
    dest: 'New York JFK',
    img: `${MVA_ASSETS}/mva-nyc.jpg`,
    price: 44900,
    blurb: 'Fall city break — Voyager from £449 return.',
    code: 'jfk',
  },
  {
    id: 'deal_dubai',
    dest: 'Dubai',
    img: `${MVA_ASSETS}/mva-dubai.jpg`,
    price: 52800,
    blurb: 'Sun guaranteed. Lounge bundle from £89.',
    code: 'dxb',
  },
  {
    id: 'deal_singapore',
    dest: 'Singapore',
    img: `${MVA_ASSETS}/mva-singapore.jpg`,
    price: 68700,
    blurb: 'Two-stop award space opening daily at 07:00.',
    code: 'sin',
  },
];
