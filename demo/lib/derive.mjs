/**
 * Query-derived state for demo pages whose content is a function of the
 * request — search results and booking lookups.
 *
 * Serverless instances re-seed their in-memory worlds independently, so
 * per-instance "last search" state flickers or goes stale whenever a request
 * lands on a different instance. Pages rebuilt from URL params render the
 * same answer on every instance — the parameters ARE the state.
 */
import { str, num, money, obj, arr } from './nodes.mjs';
import {
  AIRPORT_LABELS,
  CABIN_LABELS,
  flightCard,
  SEED_BOOKINGS as MVA_BOOKINGS,
} from '../multiversal/common.mjs';
import {
  RESULTS as HOTEL_RESULTS,
  hotelCard,
  SEED_BOOKINGS as HOTEL_BOOKINGS,
  flexRibbon,
} from '../hotel-booking/common.mjs';

const hashStr = (s) => {
  let h = 2166136261;
  for (const c of String(s)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};
const rngFor = (seed) => {
  let a = hashStr(seed);
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
};
const hm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const AIRCRAFT = [
  'Airbus A350-1000',
  'Boeing 777-300ER',
  'Boeing 787-9',
  'Airbus A380-800',
  'Boeing 777-200',
];
const airportName = (code) =>
  AIRPORT_LABELS[String(code ?? '').toLowerCase()] ?? String(code ?? '').toUpperCase();
const paxLabel = (adults, children) =>
  `${Number(adults ?? 1)} adult${Number(adults ?? 1) > 1 ? 's' : ''}${Number(children) > 0 ? `, ${children} child${Number(children) > 1 ? 'ren' : ''}` : ''}`;

/** Deterministic plausible flight list for any route+date. */
export function flightsFor({ from = 'lhr', to = 'jfk', date = '2026-10-12' } = {}) {
  const rand = rngFor(`${from}>${to}@${date}`);
  const count = 5 + Math.floor(rand() * 3);
  const flights = [];
  for (let i = 0; i < count; i++) {
    const depM = 6 * 60 + Math.floor(rand() * 840);
    const dur = 380 + Math.floor(rand() * 220);
    const fn = `MV${100 + i * 13 + Math.floor(rand() * 9)}`;
    flights.push({
      id: fn.toLowerCase(),
      fn,
      dep: `${date} ${hm(depM)}`,
      arr: `${date} ${hm(depM + dur)}`,
      depT: String(1 + Math.floor(rand() * 5)),
      arrT: String(1 + Math.floor(rand() * 9)),
      aircraft: AIRCRAFT[Math.floor(rand() * AIRCRAFT.length)],
      dur,
      co2: 350 + Math.floor(rand() * 300),
      stops: rand() < 0.85 ? 0 : 1,
      price: (420 + Math.floor(rand() * 480)) * 100,
    });
  }
  return flights;
}

const flightSelectOptions = (flights) => ({
  options: flights.map((f) => f.id),
  option_labels: Object.fromEntries(
    flights.map((f) => [f.id, `${f.fn} · ${f.dep.slice(11)} → ${f.arr.slice(11)}`]),
  ),
});

function deriveMvaResults(m, q) {
  const to = String(q.to ?? '').toLowerCase();
  if (!to) return;
  const from = String(q.from ?? 'lhr').toLowerCase();
  const depart = String(q.depart ?? (q.month ? `${q.month}-12` : '2026-10-12'));
  const ret = String(q.return ?? q.return_date ?? '');
  const isReturn = m.page.url.includes('results-return');
  const date = isReturn && ret ? ret : depart;
  const flights = flightsFor({ from: isReturn ? to : from, to: isReturn ? from : to, date });
  m.state.flights = arr(flights.map(flightCard), 'Flights — pick a fare');
  if (m.state.summary?.value) {
    const s = m.state.summary.value;
    s.route = str(`${airportName(isReturn ? to : from)} → ${airportName(isReturn ? from : to)}`);
    s.dates = str(ret ? `${depart} – ${ret}` : `${date}`);
    s.passengers = str(paxLabel(q.adults, q.children));
    if (q.cabin) s.cabin = str(CABIN_LABELS[String(q.cabin)] ?? String(q.cabin));
  }
  const selKey = Object.keys(m.actions ?? {}).find((k) => m.actions[k]?.input?.flight_id?.options);
  if (selKey) Object.assign(m.actions[selKey].input.flight_id, flightSelectOptions(flights));
  m.page.title = `${airportName(to)} — ${date}`;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function deriveMvaFareFinder(m, q) {
  const to = String(q.to ?? '').toLowerCase();
  const month = String(q.month ?? '2026-10');
  if (!to) return;
  const rand = rngFor(`fare:${to}@${month}`);
  const low = 42000 + Math.floor(rand() * 12000);
  const d = new Date(`${month}-01T00:00:00Z`);
  const rows = [];
  for (let i = 0; i < 28; i++) {
    const day = new Date(d.getTime() + i * 86400000);
    const dow = day.getUTCDay();
    const bump =
      dow === 5 || dow === 0
        ? 9400
        : dow === 4
          ? 4200
          : i % 9 === 0
            ? -3800
            : Math.floor(rand() * 6100);
    rows.push(
      obj({
        date: str(day.toISOString().slice(0, 10)),
        price: money(Math.max(39900, low + bump), 'GBP'),
      }),
    );
  }
  m.state.calendar = arr(rows, 'Lowest fare per day');
  if (m.state.query?.value) {
    const s = m.state.query.value;
    s.route = str(`${airportName(q.from ?? 'lhr')} → ${airportName(to)}`);
    const [y, mo] = month.split('-').map(Number);
    s.month = str(`${MONTH_NAMES[(mo ?? 10) - 1] ?? month} ${y ?? 2026}`);
    if (q.cabin) s.cabin = str(CABIN_LABELS[String(q.cabin)] ?? String(q.cabin));
  }
  m.page.title = `Fare finder — ${airportName(to)} in ${month}`;
}

function deriveHotelResults(m, q) {
  const dest = String(q.destination ?? '').trim();
  if (!dest) return;
  const needle = dest.toLowerCase();
  const matches = HOTEL_RESULTS.filter((h) => `${h.name} ${h.area}`.toLowerCase().includes(needle));
  const list = matches.length ? matches : HOTEL_RESULTS;
  m.state.hotels = arr(list.map(hotelCard), `Stays matching “${dest}”`);
  m.state.results_total = num(list.length, { label: 'Properties found' });
  if (m.state.summary?.value) {
    const s = m.state.summary.value;
    s.destination = str(dest);
    if (q.check_in || q.check_out) s.dates = str(`${q.check_in ?? ''} – ${q.check_out ?? ''}`);
    if (q.adults || q.rooms)
      s.guests = str(
        `${q.rooms ?? 1} room${Number(q.rooms) > 1 ? 's' : ''}, ${q.adults ?? 2} adult${Number(q.adults) > 1 ? 's' : ''}`,
      );
  }
  if (q.check_in && m.state.ribbon) {
    const mid = list[Math.floor(list.length / 2)];
    m.state.ribbon = flexRibbon(String(q.check_in), mid?.nightly ?? 9800);
  }
  m.page.title = `${dest} — ${q.check_in ?? ''} to ${q.check_out ?? ''}`;
}

function deriveMvaBooking(m, q) {
  const ref = String(q.booking_ref ?? '').toUpperCase();
  const b = MVA_BOOKINGS[ref];
  if (!b) return;
  if (q.surname && String(q.surname).toLowerCase() !== b.surname.toLowerCase()) return;
  const s = m.state.booking?.value;
  if (!s) return;
  s.ref = str(b.ref, 'Reference');
  s.status = str(b.status, 'Status');
  s.passenger = str(b.pax, 'Passenger');
  s.route = str(b.route, 'Route');
  s.outbound = str(b.outbound, 'Outbound');
  s.return_leg = str(b.return, 'Return');
  s.cabin = str(b.cabin, 'Cabin');
  s.fare = str(b.fare, 'Fare');
  s.seats = str(`${b.seats.outbound} (out) · ${b.seats.return} (ret)`, 'Seats');
  s.bags = num(b.bags, { label: 'Checked bags' });
  s.paid = money(b.paid, 'GBP');
  m.page.title = `Booking ${b.ref} — ${b.status}`;
}

function deriveHotelBooking(m, q) {
  const ref = String(q.booking_ref ?? '').toUpperCase();
  const b = HOTEL_BOOKINGS[ref];
  if (!b) return;
  if (q.surname && String(q.surname).toLowerCase() !== b.surname.toLowerCase()) return;
  const s = m.state.booking?.value;
  if (!s) return;
  s.ref = str(b.ref, 'Reference');
  s.status = str(b.status, 'Status');
  s.house = str(b.house, 'House');
  s.room = str(b.room, 'Room');
  s.guests = str(b.guest, 'Guests');
  s.checkin = str(b.checkin, 'Check-in');
  s.checkout = str(b.checkout, 'Check-out');
  s.paid = money(b.paid, 'GBP');
  m.page.title = `Booking ${b.ref} — ${b.house.split('—')[0].trim()}`;
}

/**
 * Return `manifest` with any query-derived state applied (same object — the
 * caller hands us a fresh clone).
 * @param {object} manifest
 * @param {Object<string, unknown>} query request query params
 */
export function deriveManifest(manifest, query = {}) {
  if (!manifest?.page?.url || !query || Object.keys(query).length === 0) return manifest;
  const { pathname } = new URL(manifest.page.url);
  if (pathname === '/app/mva/results' || pathname === '/app/mva/results-return')
    deriveMvaResults(manifest, query);
  else if (pathname === '/app/mva/fare-finder') deriveMvaFareFinder(manifest, query);
  else if (pathname === '/app/hotel/results') deriveHotelResults(manifest, query);
  else if (pathname === '/app/mva/booking') deriveMvaBooking(manifest, query);
  else if (pathname === '/app/hotel/booking') deriveHotelBooking(manifest, query);
  return manifest;
}
