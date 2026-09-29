/**
 * Multiversal Airways — search & discovery pages (home → outbound → inbound → deals).
 * Part of buildMvaPages: see pages.mjs for the assembled Map.
 */

import { str, obj, arr, media, markdown, table, navAction, doc } from '../lib/nodes.mjs';
import {
  MVA,
  AIRPORTS_FROM,
  AIRPORTS_TO,
  AIRPORT_LABELS,
  CABINS,
  CABIN_LABELS,
  OUTBOUND,
  RETURN,
  flexRibbon,
  flightCard,
  DEALS,
} from './common.mjs';

const searchInput = {
  trip_type: {
    type: 'enum',
    description: 'Trip type',
    options: ['return', 'one_way', 'multi_city'],
    option_labels: { return: 'Return', one_way: 'One way', multi_city: 'Multi-city' },
    default: 'return',
  },
  from: {
    type: 'enum',
    description: 'From',
    required: true,
    options: AIRPORTS_FROM,
    option_labels: AIRPORT_LABELS,
    default: 'lhr',
  },
  to: {
    type: 'enum',
    description: 'To',
    required: true,
    options: AIRPORTS_TO,
    option_labels: AIRPORT_LABELS,
    default: 'jfk',
  },
  depart: { type: 'date', description: 'Outbound', required: true, default: '2026-10-12' },
  return_date: { type: 'date', description: 'Return', default: '2026-10-19' },
  cabin: {
    type: 'enum',
    description: 'Cabin',
    options: CABINS,
    option_labels: CABIN_LABELS,
    default: 'voyager',
  },
  adults: { type: 'number', description: 'Adults (16+)', min: 1, max: 9, default: 1 },
  children: { type: 'number', description: 'Children (2–15)', min: 0, max: 8, default: 0 },
  infants: { type: 'number', description: 'Infants (under 2)', min: 0, max: 4, default: 0 },
  promo_code: { type: 'string', description: 'Promotion code', max_length: 12 },
  direct_only: { type: 'boolean', description: 'Direct flights only' },
  flexible_dates: { type: 'boolean', description: 'My dates are flexible (±3 days)' },
};

export function buildSearchPages(origin) {
  const pages = new Map();

  /* ---------- home ---------- */
  pages.set(
    'home',
    doc({
      id: 'mva_home',
      origin,
      path: '/app/mva/home',
      title: 'Multiversal Airways — Book flights',
      version: 'mva-home-1',
      state: {
        notice: str('Autumn sale: Nebula upgrades from £129 — ends 30 Sep.', 'Notice'),
        deals: media(
          DEALS.map((d) => ({ url: d.img, alt: `${d.dest} — ${d.blurb}` })),
          'This week across the multiverse',
        ),
        why: markdown(
          [
            '**Why fly Multiversal**',
            '- Flat beds in Nebula on every long-haul aircraft',
            '- Free Wi-Fi for Singularity members on all routes',
            '- Every ticket plants a tree in two timelines',
          ].join('\n'),
          'About us',
        ),
      },
      present: {
        layout: 'form',
        sections: [
          { id: 'deals', state_path: 'deals', layout: 'detail', label: 'Deals' },
          { id: 'why', state_path: 'why', layout: 'detail', label: 'Why MVA' },
        ],
        components: { notice: { type: 'banner', state_path: 'notice' } },
      },
      actions: {
        search_flights: {
          description: 'Search flights',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: searchInput,
          output: { navigates_to: MVA(origin, 'results') },
        },
        find_booking: {
          description: 'Manage booking',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            booking_ref: {
              type: 'string',
              description: 'Booking reference',
              required: true,
              min_length: 6,
              max_length: 6,
              pattern: '^[A-Z0-9]{6}$',
            },
            surname: {
              type: 'string',
              description: 'Last name',
              required: true,
              max_length: 40,
            },
          },
          output: { navigates_to: MVA(origin, 'booking') },
        },
      },
      navigation: {
        breadcrumb: [{ label: 'Multiversal Airways', url: MVA(origin, 'home') }],
        related: [
          { label: 'Deals', url: MVA(origin, 'deals'), rel: 'related' },
          { label: 'Flight status', url: MVA(origin, 'status'), rel: 'related' },
          { label: 'Check in', url: MVA(origin, 'checkin'), rel: 'related' },
          { label: 'Sign in', url: MVA(origin, 'account'), rel: 'related' },
        ],
      },
    }),
  );

  /* ---------- outbound results ---------- */
  const resultsDoc = (slug, id, title, flights, nextSlug, version) =>
    doc({
      id,
      origin,
      path: `/app/mva/${slug}`,
      title,
      version,
      state: {
        summary: obj(
          {
            route: str('London Heathrow (LHR) → New York JFK (JFK)'),
            dates: str('12 Oct – 19 Oct 2026'),
            passengers: str('1 adult'),
            cabin: str('Voyager (economy)'),
          },
          'Your search',
        ),
        ribbon: flexRibbon(),
        sort_by: str('departure', 'Sorted by'),
        flights: arr(flights.map(flightCard), 'Flights — pick a fare'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'trip', state_path: 'summary', layout: 'detail', label: 'Your search' },
          { id: 'ribbon', state_path: 'ribbon', layout: 'table', label: '±3 days' },
          { id: 'flights', state_path: 'flights', layout: 'grid', label: 'Flights' },
        ],
      },
      actions: {
        sort_results: {
          description: 'Sort or filter results',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            sort_by: {
              type: 'enum',
              description: 'Sort by',
              options: ['departure', 'price', 'duration', 'arrival'],
              option_labels: {
                departure: 'Departure time',
                price: 'Lowest price',
                duration: 'Shortest',
                arrival: 'Arrival time',
              },
              default: 'departure',
            },
            direct_only: { type: 'boolean', description: 'Direct flights only' },
          },
          output: {},
        },
        select_outbound: {
          description: 'Choose outbound flight + fare',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            flight_id: {
              type: 'enum',
              description: 'Flight',
              required: true,
              options: flights.map((f) => f.id),
              option_labels: Object.fromEntries(
                flights.map((f) => [f.id, `${f.fn} · ${f.dep.slice(11)} → ${f.arr.slice(11)}`]),
              ),
            },
            fare: {
              type: 'enum',
              description: 'Fare',
              required: true,
              options: ['saver', 'classic', 'flex'],
              option_labels: { saver: 'Saver', classic: 'Classic', flex: 'Flex' },
              default: 'classic',
            },
          },
          output: { navigates_to: MVA(origin, nextSlug) },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Results', url: MVA(origin, slug) },
        ],
      },
    });

  pages.set(
    'results',
    resultsDoc(
      'results',
      'mva_results_out',
      'Choose outbound — LHR to JFK',
      OUTBOUND,
      'results-return',
      'mva-res-1',
    ),
  );
  pages.set(
    'results-return',
    resultsDoc(
      'results-return',
      'mva_results_ret',
      'Choose return — JFK to LHR',
      RETURN,
      'seats',
      'mva-resr-1',
    ),
  );

  /* ---------- deals ---------- */
  pages.set(
    'deals',
    doc({
      id: 'mva_deals',
      origin,
      path: '/app/mva/deals',
      title: 'Deals across the multiverse',
      version: 'mva-deals-1',
      state: {
        deals: media(
          DEALS.map((d) => ({ url: d.img, alt: `${d.dest} — ${d.blurb}` })),
          'Destinations on sale',
        ),
        detail: table(
          { destination: 'string', from: 'number', sale_ends: 'string', code: 'string' },
          DEALS.map((d) => [d.dest, d.price, '2026-09-30', d.id]),
          'Fare detail',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'gallery', state_path: 'deals', layout: 'detail', label: 'On sale' },
          { id: 'detail', state_path: 'detail', layout: 'table', label: 'Detail' },
        ],
      },
      actions: {
        book_deal: {
          description: 'Book a deal (prefills the search)',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            deal: {
              type: 'enum',
              description: 'Deal',
              required: true,
              options: DEALS.map((d) => d.id),
              option_labels: Object.fromEntries(
                DEALS.map((d) => [d.id, `${d.dest} — from £${d.price / 100}`]),
              ),
            },
          },
          output: { navigates_to: MVA(origin, 'results') },
        },
        new_search: navAction('Start a fresh search', MVA(origin, 'home')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Deals', url: MVA(origin, 'deals') },
        ],
      },
    }),
  );

  return pages;
}
