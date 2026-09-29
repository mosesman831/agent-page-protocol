/**
 * Halvern House — shared data + helpers for the hotel demo manifests.
 * Part of buildHotelPages: see pages.mjs for the assembled Map.
 *
 * Halvern House Collection is a fictional boutique hotel group used to demo
 * a feature-rich hotel site: search → results → property → rooms → checkout
 * → confirmation, plus manage booking, offers, loyalty, dining, spa,
 * meetings & events, reviews, destinations and help.
 */

import { str, obj, table, media } from '../lib/nodes.mjs';

export const HB = (o, slug) => `${o}/app/hotel/${slug}`;

/** minor units → '£1,005.00' (tables reject money nodes as cells). */
export const gbp = (minor) =>
  `£${(minor / 100).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`;

// Manifest `media` nodes require https URLs (schema) — image assets always
// resolve through the canonical deployed hotel demo host, whatever the local
// origin. The bytes themselves live in demo/files/ beside this code.
export const HOTEL_ASSETS = 'https://demo-hotel-app-eta.vercel.app/demo/files';

/** Breadcrumb trail: home → …trail of {label, slug}. */
export const crumbs = (o, trail) => ({
  breadcrumb: [
    { label: 'Halvern House', url: HB(o, 'home') },
    ...trail.map((t) => ({ label: t.label, url: HB(o, t.slug) })),
  ],
});

export const DESTINATIONS = [
  'edinburgh',
  'bath',
  'lake_district',
  'london',
  'york',
  'highlands',
  'cornwall',
  'cotswolds',
  'paris',
  'amsterdam',
];
export const DESTINATION_LABELS = {
  edinburgh: 'Edinburgh, Scotland',
  bath: 'Bath, England',
  lake_district: 'Lake District, England',
  london: 'London, England',
  york: 'York, England',
  highlands: 'Scottish Highlands',
  cornwall: 'Cornwall, England',
  cotswolds: 'Cotswolds, England',
  paris: 'Paris, France',
  amsterdam: 'Amsterdam, Netherlands',
};

/** The collection — each house gets a card on destinations and a row on
 *  the directory table. `img` is relative to HOTEL_ASSETS. */
export const HOUSES = [
  {
    id: 'observatory',
    name: 'The Observatory',
    city: 'Edinburgh',
    country: 'Scotland',
    stars: 5,
    rating: 9.4,
    nightly: 28900,
    img: 'hotel-hero.jpg',
    tag: 'Flagship house — clock tower on Princes Street',
  },
  {
    id: 'crescent',
    name: 'The Crescent Spa',
    city: 'Bath',
    country: 'England',
    stars: 5,
    rating: 9.2,
    nightly: 26400,
    img: 'hotel-spa.jpg',
    tag: 'Georgian crescent with thermal pools',
  },
  {
    id: 'tarn',
    name: 'Tarn Hows Lodge',
    city: 'Lake District',
    country: 'England',
    stars: 4,
    rating: 9.0,
    nightly: 22600,
    img: 'hotel-lake.jpg',
    tag: 'Lakeland slate manor with a private jetty',
  },
  {
    id: 'mews',
    name: 'Marylebone Mews',
    city: 'London',
    country: 'England',
    stars: 5,
    rating: 9.1,
    nightly: 34200,
    img: 'hotel-suite.jpg',
    tag: 'Quiet mews house, five minutes from Bond Street',
  },
  {
    id: 'lumiere',
    name: 'Maison Lumière',
    city: 'Paris',
    country: 'France',
    stars: 5,
    rating: 9.3,
    nightly: 31800,
    img: 'hotel-paris.jpg',
    tag: 'Le Marais maison with a courtyard garden',
  },
  {
    id: 'canal',
    name: 'The Canal House',
    city: 'Amsterdam',
    country: 'Netherlands',
    stars: 4,
    rating: 8.9,
    nightly: 24100,
    img: 'hotel-canal.jpg',
    tag: 'Twin canal houses on the Herengracht',
  },
];

/** Edinburgh results — flagship house plus hand-picked partner stays, the
 *  way a collection site lists a city. */
export const RESULTS = [
  {
    id: 'observatory',
    name: 'The Observatory — Halvern House',
    stars: 5,
    img: 'hotel-hero',
    area: 'New Town / Princes Street',
    rating: 9.4,
    reviews: 3120,
    distKm: 0.4,
    nightly: 28900,
    total: 86700,
    freeCancel: true,
    breakfast: true,
    badge: 'Flagship house',
  },
  {
    id: 'castle-wynd',
    name: 'Castle Wynd House — Halvern Collection',
    stars: 4,
    img: 'hotel-suite',
    area: 'Old Town',
    rating: 9.0,
    reviews: 2087,
    distKm: 0.6,
    nightly: 17600,
    total: 52800,
    freeCancel: true,
    breakfast: true,
  },
  {
    id: 'forthlight',
    name: 'The Forthlight',
    stars: 4,
    img: 'hotel-forth',
    area: 'West End',
    rating: 8.7,
    reviews: 2654,
    distKm: 1.1,
    nightly: 15400,
    total: 46200,
    freeCancel: true,
    breakfast: false,
  },
  {
    id: 'deans-close',
    name: "The Dean's Close",
    stars: 4,
    img: 'hotel-close',
    area: 'Old Town',
    rating: 8.6,
    reviews: 3902,
    distKm: 0.5,
    nightly: 13100,
    total: 39300,
    freeCancel: false,
    breakfast: true,
  },
  {
    id: 'meadowbank',
    name: 'Meadowbank Mews',
    stars: 3,
    img: 'hotel-mews',
    area: 'New Town',
    rating: 8.5,
    reviews: 5211,
    distKm: 0.8,
    nightly: 9800,
    total: 29400,
    freeCancel: true,
    breakfast: false,
    badge: 'Great value',
  },
  {
    id: 'prestonhall',
    name: 'Prestonhall Manor — Halvern Collection',
    stars: 5,
    img: 'hotel-manor',
    area: 'Prestonfield',
    rating: 9.2,
    reviews: 1188,
    distKm: 3.4,
    nightly: 34200,
    total: 102600,
    freeCancel: false,
    breakfast: true,
    badge: 'Country house',
  },
];

/** Result card → manifest object node. */
export function hotelCard(h) {
  return obj(
    {
      name: str(h.name, 'Hotel'),
      photo: media([{ url: `${HOTEL_ASSETS}/${h.img}.jpg`, alt: h.name }]),
      stars: str('★'.repeat(h.stars), 'Stars'),
      area: str(h.area, 'Neighbourhood'),
      rating: str(`${h.rating}/10`, 'Guest rating'),
      reviews: str(h.reviews.toLocaleString('en-GB'), 'Reviews'),
      distance_km: str(`${h.distKm} km`, 'From centre'),
      price_night: str(`${gbp(h.nightly)} per night`, 'Nightly'),
      price_total: str(`${gbp(h.total)} for 3 nights`, 'Total'),
      cancellation: str(
        h.freeCancel ? 'Free until 48h before arrival' : 'Payable at booking',
        'Cancellation',
      ),
      breakfast: str(h.breakfast ? 'Included' : 'Available from £28', 'Breakfast'),
      badge: h.badge ? str(h.badge) : { type: 'null' },
    },
    h.name,
  );
}

/** ±3-night flexible-dates ribbon: check-in date → lowest nightly rate. */
export function flexRibbon(baseDate = '2026-11-06', basePrice = 9800) {
  const rows = [];
  const d = new Date(`${baseDate}T00:00:00Z`);
  const jit = [-1800, -3600, 1200, 0, 2100, 3400, -900];
  for (let i = -3; i <= 3; i++) {
    const day = new Date(d.getTime() + i * 86400000);
    rows.push([day.toISOString().slice(0, 10), gbp(basePrice + jit[i + 3])]);
  }
  return table({ check_in: 'date', lowest_nightly: 'string' }, rows, '±3 nights — lowest rate');
}

/** Rooms & rates at The Observatory (the flagship detail page). */
export const ROOM_RATES = [
  ['Classic Queen', 'Queen bed', 2, 'room_only', 'Free until 4 Nov', gbp(25900), gbp(77700)],
  ['Classic Queen', 'Queen bed', 2, 'breakfast', 'Free until 4 Nov', gbp(29100), gbp(87300)],
  ['Deluxe King', 'King bed', 2, 'breakfast', 'Free until 4 Nov', gbp(32900), gbp(98700)],
  ['Superior Twin', '2 single beds', 2, 'room_only', 'Non-refundable', gbp(27500), gbp(82500)],
  [
    'Junior Suite (Castle view)',
    'King + sofa bed',
    3,
    'breakfast',
    'Free until 4 Nov',
    gbp(46500),
    gbp(139500),
  ],
  [
    'The Observatory Suite',
    'Super king + lounge',
    3,
    'breakfast',
    'Free until 4 Nov',
    gbp(72000),
    gbp(216000),
  ],
];

/** Seeded reservations for Manage booking (ref pattern ^[A-Z0-9]{6}$). */
export const SEED_BOOKINGS = {
  HVN4X8: {
    ref: 'HVN4X8',
    surname: 'man',
    guest: 'Moses Man',
    house: 'The Observatory — Halvern House, Edinburgh',
    room: 'Deluxe King — breakfast included',
    checkin: 'Fri 6 Nov 2026 · from 15:00',
    checkout: 'Mon 9 Nov 2026 · until 12:00',
    nights: 3,
    paid: 98700,
    status: 'confirmed',
  },
  HVN9T2: {
    ref: 'HVN9T2',
    surname: 'doe',
    guest: 'Jane Doe',
    house: 'Maison Lumière — Halvern House, Paris',
    room: 'Classic Queen — room only',
    checkin: 'Fri 20 Nov 2026 · from 15:00',
    checkout: 'Mon 23 Nov 2026 · until 12:00',
    nights: 3,
    paid: 95400,
    status: 'confirmed',
  },
};

/** Loyalty programme — Halvern Circle. */
export const TIERS = ['key', 'silver_key', 'gold_key', 'master_key'];
export const TIER_LABELS = {
  key: 'Key',
  silver_key: 'Silver Key',
  gold_key: 'Gold Key',
  master_key: 'Master Key',
};
