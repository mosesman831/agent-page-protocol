/** Sample flight inventory matching SPEC Appendix D.2. Prices are GBP minor units (scale=2). */

export const ORIGINS = ['LHR', 'LGW', 'STN', 'LTN'] as const;
export const DESTINATIONS = ['DXB', 'JFK', 'SIN', 'HKG'] as const;

export type Origin = (typeof ORIGINS)[number];
export type Destination = (typeof DESTINATIONS)[number];

export const AIRPORT_LABELS: Record<string, string> = {
  LHR: 'London (LHR)',
  LGW: 'London (LGW)',
  STN: 'London (STN)',
  LTN: 'London (LTN)',
  DXB: 'Dubai (DXB)',
  JFK: 'New York (JFK)',
  SIN: 'Singapore (SIN)',
  HKG: 'Hong Kong (HKG)',
};

/** Column order matches TABLE_FIELDS keys. */
export const TABLE_FIELDS = {
  id: 'string',
  airline: 'string',
  flight_no: 'string',
  departure: 'string',
  arrival: 'string',
  duration: 'number',
  price: 'number',
  stops: 'number',
  seats_left: 'number',
} as const;

export type FlightRow = [
  string, // id
  string, // airline
  string, // flight_no
  string, // departure
  string, // arrival
  number, // duration (minutes)
  number, // price (minor units)
  number, // stops
  number, // seats_left
];

export interface FlightRecord {
  id: string;
  origin: Origin;
  destination: Destination;
  date: string;
  airline: string;
  flight_no: string;
  departure: string;
  arrival: string;
  duration: number;
  /** GBP minor units (pence), scale=2 */
  price: number;
  stops: number;
  seats_left: number;
}

/** Canonical D.2 sample set for LHR→DXB on 2026-08-15, plus a few extras for other routes. */
export const FLIGHTS: FlightRecord[] = [
  {
    id: 'fl-001',
    origin: 'LHR',
    destination: 'DXB',
    date: '2026-08-15',
    airline: 'Emirates',
    flight_no: 'EK001',
    departure: '14:30',
    arrival: '23:45',
    duration: 435,
    price: 84500,
    stops: 0,
    seats_left: 12,
  },
  {
    id: 'fl-002',
    origin: 'LHR',
    destination: 'DXB',
    date: '2026-08-15',
    airline: 'Emirates',
    flight_no: 'EK002',
    departure: '09:15',
    arrival: '18:40',
    duration: 445,
    price: 64000,
    stops: 0,
    seats_left: 4,
  },
  {
    id: 'fl-010',
    origin: 'LGW',
    destination: 'JFK',
    date: '2026-08-15',
    airline: 'Virgin Atlantic',
    flight_no: 'VS003',
    departure: '11:00',
    arrival: '14:30',
    duration: 450,
    price: 38900,
    stops: 0,
    seats_left: 15,
  },
  {
    id: 'fl-020',
    origin: 'LHR',
    destination: 'SIN',
    date: '2026-08-20',
    airline: 'Singapore Airlines',
    flight_no: 'SQ317',
    departure: '22:05',
    arrival: '18:40',
    duration: 755,
    price: 91200,
    stops: 0,
    seats_left: 6,
  },
];

export function toRow(f: FlightRecord): FlightRow {
  return [
    f.id,
    f.airline,
    f.flight_no,
    f.departure,
    f.arrival,
    f.duration,
    f.price,
    f.stops,
    f.seats_left,
  ];
}

export function findFlights(origin: string, destination: string, date: string): FlightRecord[] {
  return FLIGHTS.filter(
    (f) => f.origin === origin && f.destination === destination && f.date === date,
  );
}

export function findFlightById(id: string): FlightRecord | undefined {
  return FLIGHTS.find((f) => f.id === id);
}

export function sortFlights(
  flights: FlightRecord[],
  sortBy: 'price' | 'duration' | 'departure',
): FlightRecord[] {
  const copy = [...flights];
  copy.sort((a, b) => {
    if (sortBy === 'price') return a.price - b.price;
    if (sortBy === 'duration') return a.duration - b.duration;
    return a.departure.localeCompare(b.departure);
  });
  return copy;
}

export function filterFlights(
  flights: FlightRecord[],
  opts: {
    airline?: string;
    max_price?: number;
    max_stops?: number;
  },
): FlightRecord[] {
  return flights.filter((f) => {
    if (opts.airline && !f.airline.toLowerCase().includes(String(opts.airline).toLowerCase())) {
      return false;
    }
    if (opts.max_price !== undefined && f.price > Number(opts.max_price)) {
      return false;
    }
    if (opts.max_stops !== undefined && f.stops > Number(opts.max_stops)) {
      return false;
    }
    return true;
  });
}
