/**
 * Halvern House — booking funnel pages:
 * search → results → property (The Observatory) → rooms → checkout →
 * confirmation. Part of buildHotelPages: see pages.mjs for the Map.
 */

import {
  str,
  num,
  datetime,
  obj,
  arr,
  table,
  file,
  geopoint,
  order,
  media,
  markdown,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';
import {
  HB,
  HOTEL_ASSETS,
  crumbs,
  DESTINATIONS,
  DESTINATION_LABELS,
  RESULTS,
  hotelCard,
  flexRibbon,
  ROOM_RATES,
} from './common.mjs';

/** Search widget inputs — shared by the home hero form and the search page. */
export const searchInput = {
  destination: {
    type: 'enum',
    description: 'Destination',
    required: true,
    options: DESTINATIONS,
    option_labels: DESTINATION_LABELS,
    default: 'edinburgh',
  },
  check_in: { type: 'date', description: 'Check-in', required: true, default: '2026-11-06' },
  check_out: { type: 'date', description: 'Check-out', required: true, default: '2026-11-09' },
  rooms: { type: 'number', description: 'Rooms', min: 1, max: 8, default: 1 },
  adults: { type: 'number', description: 'Adults (18+)', min: 1, max: 16, default: 2 },
  children: { type: 'number', description: 'Children (0–17)', min: 0, max: 10, default: 0 },
  promo_code: { type: 'string', description: 'Corporate / promo code', max_length: 16 },
  flexible_dates: { type: 'boolean', description: 'My dates are flexible (±3 nights)' },
};

export function buildFlowPages(origin) {
  const pages = new Map();

  /* ---------- search ---------- */
  pages.set(
    'search',
    doc({
      id: 'hb_search',
      origin,
      path: '/app/hotel/search',
      title: 'Find your stay',
      version: 'hb-search-1',
      state: {
        promo: str(
          'Halvern Circle members save 10% at every house — joining is free.',
          'Member rate',
        ),
        flexible: obj(
          {
            hint: str('Tick “my dates are flexible” to see the ±3-night price ribbon on results.'),
            best_rate: str(
              'Book direct for the best available rate — we refund the difference if you find cheaper.',
              'Best rate promise',
            ),
          },
          'Search tips',
        ),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'tips', state_path: 'flexible', layout: 'detail', label: 'Search tips' }],
        components: { promo: { type: 'banner', state_path: 'promo' } },
      },
      actions: {
        search_hotels: {
          description: 'Search stays',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: searchInput,
          output: { navigates_to: HB(origin, 'results') },
        },
        find_booking: navAction('Manage an existing booking', HB(origin, 'manage')),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Find a stay', slug: 'search' }]),
        related: [
          { label: 'Offers', url: HB(origin, 'deals'), rel: 'related' },
          { label: 'Our houses', url: HB(origin, 'destinations'), rel: 'related' },
        ],
      },
    }),
  );

  /* ---------- results ---------- */
  pages.set(
    'results',
    doc({
      id: 'hb_results',
      origin,
      path: '/app/hotel/results',
      title: 'Edinburgh — 6–9 Nov, 2 adults',
      version: 'hb-res-1',
      state: {
        summary: obj(
          {
            destination: str('Edinburgh, United Kingdom'),
            dates: str('6 Nov – 9 Nov 2026 (3 nights)'),
            guests: str('1 room, 2 adults'),
          },
          'Your search',
        ),
        ribbon: flexRibbon('2026-11-06', 9800),
        sort_by: str('recommended', 'Sorted by'),
        hotels: arr(RESULTS.map(hotelCard), 'Stays in Edinburgh'),
        results_total: num(214, { label: 'Properties found' }),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'sum', state_path: 'summary', layout: 'detail', label: 'Your search' },
          {
            id: 'ribbon',
            state_path: 'ribbon',
            layout: 'table',
            label: '±3 nights — lowest rate',
            columns: [
              { key: 'check_in', label: 'Check-in' },
              { key: 'lowest_nightly', label: 'Lowest nightly', align: 'right' },
            ],
          },
          { id: 'flt', layout: 'form', primary_action: 'apply_filters', label: 'Filter & sort' },
          {
            id: 'hotels',
            state_path: 'hotels',
            layout: 'grid',
            item_key: 'id',
            primary_action: 'select_hotel',
            label: 'Stays',
          },
        ],
      },
      actions: {
        select_hotel: {
          description: 'View this stay',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            hotel_id: {
              type: 'enum',
              description: 'Stay',
              required: true,
              options: RESULTS.map((h) => h.id),
              option_labels: Object.fromEntries(
                RESULTS.map((h) => [h.id, `${h.name} · £${h.nightly / 100}/night`]),
              ),
              default: 'observatory',
            },
          },
          output: { navigates_to: HB(origin, 'hotel') },
        },
        apply_filters: {
          description: 'Apply filters',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            sort_by: {
              type: 'enum',
              description: 'Sort by',
              options: ['recommended', 'price_low', 'price_high', 'rating', 'distance'],
              option_labels: {
                recommended: 'Recommended',
                price_low: 'Price — low to high',
                price_high: 'Price — high to low',
                rating: 'Guest rating',
                distance: 'Distance to centre',
              },
              default: 'recommended',
            },
            min_stars: {
              type: 'enum',
              description: 'Minimum stars',
              options: ['any', '3', '4', '5'],
              option_labels: { any: 'Any', 3: '3+', 4: '4+', 5: '5' },
              default: 'any',
            },
            max_nightly: {
              type: 'number',
              description: 'Max price per night (GBP)',
              min: 0,
            },
            free_cancellation: { type: 'boolean', description: 'Free cancellation' },
            breakfast_included: { type: 'boolean', description: 'Breakfast included' },
            collection_only: { type: 'boolean', description: 'Halvern Collection houses only' },
          },
          output: { state_diff: true, changes: ['/state/hotels'] },
        },
        new_search: navAction('Change search', HB(origin, 'search')),
      },
      navigation: {
        ...crumbs(origin, [
          { label: 'Find a stay', slug: 'search' },
          { label: 'Edinburgh', slug: 'results' },
        ]),
      },
    }),
  );

  /* ---------- hotel detail ---------- */
  pages.set(
    'hotel',
    doc({
      id: 'hb_hotel',
      origin,
      path: '/app/hotel/hotel',
      title: 'The Observatory, Edinburgh',
      version: 'hb-htl-1',
      state: {
        hotel: obj(
          {
            name: str('The Observatory', 'Name'),
            collection: str('Halvern House — flagship', 'Collection'),
            stars: str('★★★★★', 'Stars'),
            rating: str('9.4/10', 'Guest rating'),
            reviews: str('3,120', 'Reviews'),
            address: str('1 Princes Street, Edinburgh EH2 2EQ', 'Address'),
            checkin_from: str('15:00', 'Check-in from'),
            checkout_until: str('12:00', 'Check-out until'),
          },
          'The Observatory',
        ),
        gallery: media(
          [
            {
              url: `${HOTEL_ASSETS}/hotel-hero.jpg`,
              alt: 'The house at dusk, Princes Street',
            },
            {
              url: `${HOTEL_ASSETS}/hotel-suite.jpg`,
              alt: 'Castle-view suite',
            },
            {
              url: `${HOTEL_ASSETS}/hotel-dining.jpg`,
              alt: 'The Forth Table restaurant',
            },
            {
              url: `${HOTEL_ASSETS}/hotel-spa.jpg`,
              alt: 'Thermal suite',
            },
          ],
          'Gallery',
        ),
        description: obj(
          {
            overview: str(
              'The Halvern flagship: a Georgian railway hotel crowned by its clock tower on Princes Street. Candlelit dining at The Forth Table, a thermal suite under the arches, and kilted doormen who remember your name.',
              'Overview',
            ),
            neighbourhood: str(
              'New Town — steps from Waverley station, the National Gallery and the Christmas market; Castle views from the west-facing rooms.',
              'Neighbourhood',
            ),
          },
          'About',
        ),
        amenities: obj(
          {
            list: markdown(
              [
                'Thermal suite & plunge pool',
                'The Forth Table restaurant',
                'The Lantern Bar & terrace',
                'Free Wi-Fi',
                'Gym & studio',
                '24h room service',
                'Valet parking £38/day',
                'Pet friendly',
                'EV charging',
                'Concierge',
              ]
                .map((a) => `- ${a}`)
                .join('\n'),
              'On site',
            ),
          },
          'Amenities',
        ),
        location: geopoint(55.9531, -3.1899, 'The Observatory, Princes Street'),
        reviews_sample: table(
          { author: 'string', score: 'number', date: 'date', title: 'string' },
          [
            ['Fiona M.', 10, '2026-09-02', 'Faultless service — best bed in Scotland'],
            ['Daniel R.', 9, '2026-08-21', 'Stunning building; thermal suite busy at dusk'],
            ['Priya S.', 9, '2026-08-05', 'The Forth Table alone is worth the stay'],
          ],
          'Recent reviews',
        ),
        policies: obj(
          {
            cancellation: str('Free cancellation until 18:00 on 4 Nov 2026', 'Cancellation'),
            deposit: str('No prepayment needed — pay at the house', 'Deposit'),
            pets: str('Dogs welcome, £30/night (bed & bowls provided)', 'Pets'),
            children: str(
              'Children of any age welcome; cots & interconnecting rooms free',
              'Family',
            ),
            resident_tax: str('Edinburgh visitor levy — included in rates shown', 'City levy'),
          },
          'Policies',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'gal', state_path: 'gallery', layout: 'detail', label: 'Gallery' },
          {
            id: 'hd',
            state_path: 'hotel',
            layout: 'detail',
            primary_action: 'see_rooms',
            label: 'The house',
          },
          { id: 'desc', state_path: 'description', layout: 'detail', label: 'About' },
          { id: 'amen', state_path: 'amenities', layout: 'list', label: 'Amenities' },
          { id: 'rev', state_path: 'reviews_sample', layout: 'table', label: 'Recent reviews' },
          { id: 'pol', state_path: 'policies', layout: 'detail', label: 'Good to know' },
        ],
      },
      actions: {
        see_rooms: navAction('See rooms & rates', HB(origin, 'rooms')),
        back_results: navAction('Back to results', HB(origin, 'results')),
        all_reviews: navAction('Read all 3,120 reviews', HB(origin, 'reviews')),
      },
      navigation: {
        ...crumbs(origin, [
          { label: 'Edinburgh', slug: 'results' },
          { label: 'The Observatory', slug: 'hotel' },
        ]),
        related: [
          { label: 'Dining & spa', url: HB(origin, 'dining'), rel: 'related' },
          { label: 'Offers', url: HB(origin, 'deals'), rel: 'related' },
        ],
      },
    }),
  );

  /* ---------- rooms & rates ---------- */
  pages.set(
    'rooms',
    doc({
      id: 'hb_rooms',
      origin,
      path: '/app/hotel/rooms',
      title: 'Rooms at The Observatory — 3 nights',
      version: 'hb-rooms-1',
      state: {
        rates: table(
          {
            room: 'string',
            bed: 'string',
            sleeps: 'number',
            board: 'enum',
            cancellation: 'string',
            nightly: 'string',
            total: 'string',
          },
          ROOM_RATES,
          'Rooms & rates',
        ),
        taxes: str(
          'Rates include VAT and the Edinburgh visitor levy. Halvern Circle members save 10%.',
          'Taxes & fees',
        ),
        member_note: str(
          'Sign in or join free at checkout for member rates — saves £98.70 on this stay.',
          'Member rate',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'rates',
            state_path: 'rates',
            layout: 'table',
            columns: [
              { key: 'room', label: 'Room' },
              { key: 'bed', label: 'Beds' },
              { key: 'sleeps', label: 'Sleeps', align: 'right' },
              { key: 'board', label: 'Board' },
              { key: 'cancellation', label: 'Cancellation' },
              { key: 'nightly', label: 'Per night', align: 'right' },
              { key: 'total', label: 'Total (3n)', align: 'right' },
            ],
            primary_action: 'select_rate',
            label: 'Choose your room',
          },
        ],
        components: { taxes: { type: 'banner', state_path: 'taxes' } },
      },
      actions: {
        select_rate: navAction('Reserve Deluxe King + breakfast', HB(origin, 'checkout')),
        back_hotel: navAction('Back to the house', HB(origin, 'hotel')),
      },
      navigation: {
        ...crumbs(origin, [
          { label: 'Edinburgh', slug: 'results' },
          { label: 'The Observatory', slug: 'hotel' },
          { label: 'Rooms', slug: 'rooms' },
        ]),
      },
    }),
  );

  /* ---------- checkout ---------- */
  pages.set(
    'checkout',
    doc({
      id: 'hb_checkout',
      origin,
      path: '/app/hotel/checkout',
      title: 'Confirm your stay — The Observatory',
      version: 'hb-co-1',
      state: {
        stay: obj(
          {
            hotel: str('The Observatory — Halvern House'),
            room: str('Deluxe King — breakfast included'),
            dates: str('6–9 Nov 2026 (3 nights)'),
            guests: str('2 adults'),
          },
          'Your stay',
        ),
        order: order(
          {
            id: 'HVN-8F4Q2M',
            status: 'awaiting_payment',
            currency: 'GBP',
            total: 100500,
            scale: 2,
            items: [
              { sku: 'deluxe_king_bb_3n', qty: 1, amount: 98700 },
              { sku: 'visitor_levy', qty: 3, amount: 600 },
            ],
            payment: { status: 'unpaid', psp: 'stripe' },
          },
          'Total',
        ),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'stay', state_path: 'stay', layout: 'detail', label: 'Your stay' }],
      },
      actions: {
        confirm_booking: action('Book now — £1,005.00', 'mutate', 'financial', {
          input: {
            title: {
              type: 'enum',
              description: 'Title',
              options: ['mr', 'ms', 'mrs', 'dr', 'miss', 'mx'],
              option_labels: {
                mr: 'Mr',
                ms: 'Ms',
                mrs: 'Mrs',
                dr: 'Dr',
                miss: 'Miss',
                mx: 'Mx',
              },
              default: 'ms',
            },
            first_name: { type: 'string', description: 'First name', required: true },
            last_name: { type: 'string', description: 'Last name', required: true },
            email: {
              type: 'string',
              description: 'Email',
              required: true,
              pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            },
            phone: { type: 'string', description: 'Phone', required: true },
            arrival_time: {
              type: 'enum',
              description: 'Estimated arrival',
              options: ['1200', '1500', '1800', '2100', 'late'],
              option_labels: {
                1200: '12:00–15:00',
                1500: '15:00–18:00',
                1800: '18:00–21:00',
                2100: '21:00–00:00',
                late: 'After midnight',
              },
              default: '1500',
            },
            special_requests: {
              type: 'string',
              description: 'Special requests (optional)',
              max_length: 500,
            },
            circle_no: {
              type: 'string',
              description: 'Halvern Circle number (optional — earns keys)',
              max_length: 12,
            },
            card_number: { type: 'string', description: 'Card number', required: true },
            card_expiry: { type: 'string', description: 'Expiry (MM/YY)', required: true },
            card_cvv: { type: 'string', description: 'Security code', required: true },
            pay_at_property: {
              type: 'boolean',
              description: 'Pay at the house (card held as guarantee)',
            },
          },
          output: { navigates_to: HB(origin, 'confirmation') },
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Confirm booking',
            body_template: 'Book Deluxe King at The Observatory',
            amount_path: 'order.value.total',
          },
          policy: { secret_params: ['card_number', 'card_cvv'] },
        }),
        back_rooms: navAction('Back to rooms', HB(origin, 'rooms')),
      },
      navigation: {
        ...crumbs(origin, [
          { label: 'Rooms', slug: 'rooms' },
          { label: 'Checkout', slug: 'checkout' },
        ]),
      },
    }),
  );

  /* ---------- confirmation ---------- */
  pages.set(
    'confirmation',
    doc({
      id: 'hb_confirmation',
      origin,
      path: '/app/hotel/confirmation',
      title: 'Booking confirmed — The Observatory',
      version: 'hb-conf-1',
      state: {
        order: order(
          {
            id: 'HVN-8F4Q2M',
            status: 'paid',
            currency: 'GBP',
            total: 100500,
            scale: 2,
            items: [
              { sku: 'deluxe_king_bb_3n', qty: 1, amount: 98700 },
              { sku: 'visitor_levy', qty: 3, amount: 600 },
            ],
            payment: { status: 'succeeded', psp: 'stripe' },
          },
          'Reservation',
        ),
        refs: obj(
          {
            confirmation_code: str('HVN-77QD-2241', 'Confirmation code'),
            pin: str('4417', 'PIN for manage booking'),
            guest: str('J Moss'),
          },
          'Confirmed',
        ),
        stay: obj(
          {
            hotel: str('The Observatory, 1 Princes Street, Edinburgh EH2 2EQ'),
            room: str('Deluxe King — breakfast included'),
            check_in: datetime('2026-11-06T15:00:00+00:00', 'Check-in'),
            check_out: datetime('2026-11-09T12:00:00+00:00', 'Check-out'),
            cancel_free_until: datetime('2026-11-04T18:00:00+00:00', 'Free cancellation until'),
          },
          'Stay details',
        ),
        directions: geopoint(55.9531, -3.1899, 'The Observatory'),
        voucher: file(
          `${origin}/demo/files/voucher-HVN-8F4Q2M.pdf`,
          'voucher.pdf',
          'application/pdf',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'code', state_path: 'refs', layout: 'detail', label: 'Confirmed' },
          { id: 'stay', state_path: 'stay', layout: 'detail', label: 'Your stay' },
        ],
      },
      actions: {
        cancel_booking: action('Cancel booking (free until 4 Nov)', 'mutate', 'destructive', {
          input: {},
          output: { navigates_to: HB(origin, 'confirmation') },
          idempotent: true,
          requires_confirmation: true,
          confirm: { title: 'Cancel booking', body_template: 'Cancel reservation HVN-8F4Q2M' },
        }),
        manage: navAction('Manage booking', HB(origin, 'manage')),
        book_another: navAction('Book another stay', HB(origin, 'home')),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Confirmation', slug: 'confirmation' }]),
      },
    }),
  );

  return pages;
}
