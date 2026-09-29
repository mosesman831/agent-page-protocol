/**
 * Hotel booking demo — APP page manifests:
 * search → results → hotel detail → room rates → checkout → confirmation.
 */

import {
  str,
  num,
  money,
  bool,
  datetime,
  obj,
  arr,
  table,
  file,
  geopoint,
  order,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';

const HB = (o, slug) => `${o}/app/hotel/${slug}`;

function hotelCard({
  id,
  name,
  stars,
  area,
  rating,
  reviews,
  distKm,
  nightly,
  total,
  freeCancel,
  badge,
}) {
  return obj(
    {
      id: str(id),
      name: str(name, 'Hotel'),
      stars: num(stars, { label: 'Stars' }),
      area: str(area, 'Neighbourhood'),
      rating: num(rating, { label: 'Guest rating', max: 10 }),
      reviews: num(reviews, { label: 'Reviews' }),
      distance_km: num(distKm, { unit: 'km', label: 'From centre' }),
      price_night: money(nightly, 'GBP'),
      price_total: money(total, 'GBP'),
      free_cancellation: bool(freeCancel, 'Free cancellation'),
      badge: badge ? str(badge) : { type: 'null' },
    },
    name,
  );
}

export function buildHotelPages(origin) {
  const pages = new Map();

  /* ---------- 1. search ---------- */
  pages.set(
    'search',
    doc({
      id: 'hb_search',
      origin,
      path: '/app/hotel/search',
      title: 'HotelHub - Find hotels',
      version: 'hb-search-1',
      state: {
        promo: str('Members save 10%+ on thousands of hotels.', 'Notice'),
      },
      present: {
        layout: 'form',
        sections: [],
        components: { promo: { type: 'banner', state_path: 'promo' } },
      },
      actions: {
        search_hotels: {
          description: 'Search hotels',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            destination: {
              type: 'string',
              description: 'Destination',
              required: true,
              default: 'Edinburgh',
            },
            check_in: {
              type: 'date',
              description: 'Check-in',
              required: true,
              default: '2026-11-06',
            },
            check_out: {
              type: 'date',
              description: 'Check-out',
              required: true,
              default: '2026-11-09',
            },
            rooms: { type: 'number', description: 'Rooms', min: 1, max: 8, default: 1 },
            adults: { type: 'number', description: 'Adults', min: 1, max: 16, default: 2 },
            children: { type: 'number', description: 'Children', min: 0, max: 10, default: 0 },
          },
          output: { navigates_to: HB(origin, 'results') },
        },
      },
      navigation: { breadcrumb: [{ label: 'HotelHub', url: HB(origin, 'search') }] },
    }),
  );

  /* ---------- 2. results ---------- */
  pages.set(
    'results',
    doc({
      id: 'hb_results',
      origin,
      path: '/app/hotel/results',
      title: 'Hotels in Edinburgh - 6-9 Nov, 2 adults',
      version: 'hb-res-1',
      state: {
        summary: obj(
          {
            destination: str('Edinburgh, United Kingdom'),
            dates: str('6 Nov - 9 Nov 2026 (3 nights)'),
            guests: str('1 room, 2 adults'),
          },
          'Search',
        ),
        hotels: arr(
          [
            hotelCard({
              id: 'htl-balmoral',
              name: 'The Balmoral',
              stars: 5,
              area: 'New Town / Princes St',
              rating: 9.1,
              reviews: 4821,
              distKm: 0.4,
              nightly: 31200,
              total: 93600,
              freeCancel: true,
              badge: 'Landmark',
            }),
            hotelCard({
              id: 'htl-scotsman',
              name: 'The Scotsman Hotel',
              stars: 4,
              area: 'Old Town',
              rating: 8.7,
              reviews: 3120,
              distKm: 0.6,
              nightly: 18900,
              total: 56700,
              freeCancel: true,
            }),
            hotelCard({
              id: 'htl-motelone',
              name: 'Motel One Edinburgh-Royal',
              stars: 3,
              area: 'Old Town',
              rating: 8.4,
              reviews: 9012,
              distKm: 0.5,
              nightly: 9600,
              total: 28800,
              freeCancel: false,
              badge: 'Great value',
            }),
            hotelCard({
              id: 'htl-waldorf',
              name: 'Waldorf Astoria - The Caledonian',
              stars: 5,
              area: 'West End',
              rating: 8.9,
              reviews: 2980,
              distKm: 1.1,
              nightly: 27400,
              total: 82200,
              freeCancel: true,
            }),
            hotelCard({
              id: 'htl-apex',
              name: 'Apex Grassmarket Hotel',
              stars: 4,
              area: 'Grassmarket',
              rating: 8.5,
              reviews: 4410,
              distKm: 0.8,
              nightly: 13200,
              total: 39600,
              freeCancel: true,
            }),
            hotelCard({
              id: 'htl-prestonfield',
              name: 'Prestonfield House',
              stars: 5,
              area: 'Prestonfield',
              rating: 9.3,
              reviews: 1540,
              distKm: 3.4,
              nightly: 38800,
              total: 116400,
              freeCancel: false,
              badge: 'Boutique',
            }),
          ],
          'Hotels',
        ),
        results_total: num(214, { label: 'Properties found' }),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'sum', state_path: 'summary', layout: 'detail', label: 'Search' },
          { id: 'flt', layout: 'form', primary_action: 'apply_filters', label: 'Filter' },
          {
            id: 'hotels',
            state_path: 'hotels',
            layout: 'grid',
            columns: [
              { key: 'stars', label: 'Stars' },
              { key: 'rating', label: 'Rating' },
              { key: 'reviews', label: 'Reviews' },
              { key: 'area', label: 'Area' },
              { key: 'distance_km', label: 'km to centre' },
              { key: 'nightly', label: 'Per night' },
              { key: 'free_cancel', label: 'Cancellation' },
            ],
            item_key: 'id',
            primary_action: 'select_hotel',
            label: 'Hotels',
          },
        ],
      },
      actions: {
        select_hotel: navAction('View hotel', HB(origin, 'hotel')),
        apply_filters: action('Apply filters', 'mutate', 'safe', {
          input: {
            min_stars: {
              type: 'enum',
              description: 'Minimum stars',
              options: ['any', '3', '4', '5'],
              option_labels: { any: 'Any', 3: '3+', 4: '4+', 5: '5' },
              default: 'any',
            },
            max_nightly: { type: 'number', description: 'Max price per night (GBP)', min: 0 },
            free_cancellation: { type: 'boolean', description: 'Free cancellation' },
            breakfast_included: { type: 'boolean', description: 'Breakfast included' },
          },
          output: { state_diff: true, changes: ['/state/hotels'] },
          idempotent: true,
        }),
      },
      navigation: {
        breadcrumb: [
          { label: 'Search', url: HB(origin, 'search') },
          { label: 'Results', url: HB(origin, 'results') },
        ],
      },
    }),
  );

  /* ---------- 3. hotel detail ---------- */
  pages.set(
    'hotel',
    doc({
      id: 'hb_hotel',
      origin,
      path: '/app/hotel/hotel',
      title: 'The Balmoral, Edinburgh',
      version: 'hb-htl-1',
      state: {
        hotel: obj(
          {
            name: str('The Balmoral', 'Name'),
            stars: num(5, { label: 'Stars' }),
            rating: num(9.1, { label: 'Guest rating' }),
            reviews: num(4821, { label: 'Reviews' }),
            address: str('1 Princes Street, Edinburgh EH2 2EQ', 'Address'),
            checkin_from: str('15:00', 'Check-in from'),
            checkout_until: str('12:00', 'Check-out until'),
          },
          'The Balmoral',
        ),
        description: obj(
          {
            overview: str(
              'A landmark railway hotel opened in 1902, crowned by its clock tower. Michelin-starred dining at Number One, a spa with lap pool, and kilted doormen on Princes Street.',
            ),
            address: str('1 Princes Street, Edinburgh EH2 2EQ'),
          },
          'About',
        ),
        amenities: arr(
          [
            str('Free Wi-Fi'),
            str('Spa & sauna'),
            str('Indoor pool'),
            str('Gym'),
            str('2 restaurants'),
            str('Bar'),
            str('Room service 24h'),
            str('Valet parking'),
            str('Pet friendly'),
            str('Electric car charging'),
          ],
          'Amenities',
        ),
        location: geopoint(55.9531, -3.1899, 'The Balmoral, Princes Street'),
        reviews_sample: table(
          { author: 'string', score: 'number', date: 'date', title: 'string' },
          [
            ['Fiona M.', 10, '2026-09-02', 'Faultless service, the best bed in Scotland'],
            ['Daniel R.', 9, '2026-08-21', 'Stunning building; pool area busy at peak times'],
            ['Priya S.', 9, '2026-08-05', 'Number One restaurant alone is worth the stay'],
          ],
          'Recent reviews',
        ),
        policies: obj(
          {
            cancellation: str('Free cancellation until 18:00 on 4 Nov 2026', 'Cancellation'),
            deposit: str('No prepayment needed - pay at the hotel', 'Deposit'),
            pets: str('Pets allowed, GBP 30/night', 'Pets'),
            children: str('Children of any age welcome; cots free', 'Children'),
          },
          'Policies',
        ),
        photos: arr(
          [
            file(
              `${origin}/demo/files/balmoral-exterior.jpg`,
              'balmoral-exterior.jpg',
              'image/jpeg',
            ),
            file(`${origin}/demo/files/balmoral-suite.jpg`, 'balmoral-suite.jpg', 'image/jpeg'),
            file(`${origin}/demo/files/balmoral-pool.jpg`, 'balmoral-pool.jpg', 'image/jpeg'),
          ],
          'Photos',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          {
            id: 'hd',
            state_path: 'hotel',
            layout: 'detail',
            primary_action: 'see_rooms',
            label: 'Hotel',
          },
          { id: 'desc', state_path: 'description', layout: 'list', label: 'About' },
          { id: 'amen', state_path: 'amenities', layout: 'list', label: 'Amenities' },
          { id: 'rev', state_path: 'reviews_sample', layout: 'table', label: 'Reviews' },
          { id: 'pol', state_path: 'policies', layout: 'detail', label: 'Policies' },
        ],
      },
      actions: {
        see_rooms: navAction('See rooms & rates', HB(origin, 'rooms')),
        back_results: navAction('Back to results', HB(origin, 'results')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Results', url: HB(origin, 'results') },
          { label: 'The Balmoral', url: HB(origin, 'hotel') },
        ],
      },
    }),
  );

  /* ---------- 4. rooms ---------- */
  pages.set(
    'rooms',
    doc({
      id: 'hb_rooms',
      origin,
      path: '/app/hotel/rooms',
      title: 'Rooms at The Balmoral - 3 nights',
      version: 'hb-rooms-1',
      state: {
        rates: table(
          {
            room: 'string',
            bed: 'string',
            sleeps: 'number',
            board: 'enum',
            cancellation: 'string',
            nightly: 'number',
            total: 'number',
          },
          [
            ['Classic Queen', 'Queen bed', 2, 'room_only', 'Free until 4 Nov', 24900, 74700],
            [
              'Classic Queen + breakfast',
              'Queen bed',
              2,
              'breakfast',
              'Free until 4 Nov',
              28100,
              84300,
            ],
            ['Deluxe King', 'King bed', 2, 'breakfast', 'Free until 4 Nov', 31200, 93600],
            ['Superior Twin', '2 single beds', 2, 'room_only', 'Non-refundable', 26500, 79500],
            [
              'Junior Suite (Castle view)',
              'King + sofa bed',
              3,
              'breakfast',
              'Free until 4 Nov',
              44800,
              134400,
            ],
            [
              'Signature Suite',
              'Super king + lounge',
              3,
              'breakfast',
              'Free until 4 Nov',
              68500,
              205500,
            ],
          ],
          'Rooms & rates',
        ),
        taxes: str(
          'Prices include VAT 20%. City tax GBP 1.50/person/night payable at hotel.',
          'Taxes',
        ),
        price_scale: num(2, { label: 'Minor units per major unit' }),
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
              { key: 'nightly', label: 'Per night', format: 'currency', align: 'right' },
              { key: 'total', label: 'Total (3n)', format: 'currency', align: 'right' },
            ],
            primary_action: 'select_rate',
            label: 'Choose your room',
          },
        ],
        components: { taxes: { type: 'banner', state_path: 'taxes' } },
      },
      actions: {
        select_rate: navAction('Reserve Deluxe King + breakfast', HB(origin, 'checkout')),
        back_hotel: navAction('Back to hotel', HB(origin, 'hotel')),
      },
      navigation: {
        breadcrumb: [
          { label: 'The Balmoral', url: HB(origin, 'hotel') },
          { label: 'Rooms', url: HB(origin, 'rooms') },
        ],
      },
    }),
  );

  /* ---------- 5. checkout ---------- */
  pages.set(
    'checkout',
    doc({
      id: 'hb_checkout',
      origin,
      path: '/app/hotel/checkout',
      title: 'Confirm your stay - The Balmoral',
      version: 'hb-co-1',
      state: {
        stay: obj(
          {
            hotel: str('The Balmoral'),
            room: str('Deluxe King - breakfast included'),
            dates: str('6-9 Nov 2026 (3 nights)'),
            guests: str('2 adults'),
          },
          'Your stay',
        ),
        order: order(
          {
            id: 'HB-8F4Q2M',
            status: 'awaiting_payment',
            currency: 'GBP',
            total: 95400,
            scale: 2,
            items: [
              { sku: 'deluxe_king_bb_3n', qty: 1, amount: 93600 },
              { sku: 'city_tax_est', qty: 3, amount: 600 },
            ],
            payment: { status: 'unpaid', psp: 'stripe' },
          },
          'Total',
        ),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'stay', state_path: 'stay', layout: 'detail', label: 'Stay' }],
      },
      actions: {
        confirm_booking: action('Book now - GBP 954.00', 'mutate', 'financial', {
          input: {
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
                1200: '12:00-15:00',
                1500: '15:00-18:00',
                1800: '18:00-21:00',
                2100: '21:00-00:00',
                late: 'After midnight',
              },
              default: '1500',
            },
            special_requests: {
              type: 'string',
              description: 'Special requests (optional)',
              max_length: 500,
            },
            rewards_no: { type: 'string', description: 'HotelHub Rewards number (optional)' },
            card_number: { type: 'string', description: 'Card number', required: true },
            card_expiry: { type: 'string', description: 'Expiry (MM/YY)', required: true },
            card_cvv: { type: 'string', description: 'Security code', required: true },
            pay_at_property: {
              type: 'boolean',
              description: 'Pay at the property (card held as guarantee)',
            },
          },
          output: { navigates_to: HB(origin, 'confirmation') },
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Confirm booking',
            body_template: 'Book Deluxe King at The Balmoral',
            amount_path: 'order.value.total',
          },
          policy: { secret_params: ['card_number', 'card_cvv'] },
        }),
        back_rooms: navAction('Back to rooms', HB(origin, 'rooms')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Rooms', url: HB(origin, 'rooms') },
          { label: 'Checkout', url: HB(origin, 'checkout') },
        ],
      },
    }),
  );

  /* ---------- 6. confirmation ---------- */
  pages.set(
    'confirmation',
    doc({
      id: 'hb_confirmation',
      origin,
      path: '/app/hotel/confirmation',
      title: 'Booking confirmed - The Balmoral',
      version: 'hb-conf-1',
      state: {
        order: order(
          {
            id: 'HB-8F4Q2M',
            status: 'paid',
            currency: 'GBP',
            total: 95400,
            scale: 2,
            items: [
              { sku: 'deluxe_king_bb_3n', qty: 1, amount: 93600 },
              { sku: 'city_tax_est', qty: 3, amount: 600 },
            ],
            payment: { status: 'succeeded', psp: 'stripe' },
          },
          'Reservation',
        ),
        refs: obj(
          {
            confirmation_code: str('HBX-77QD-2241', 'Confirmation code'),
            pin: str('4417', 'PIN for manage booking'),
            guest: str('J Moss'),
          },
          'Confirmed',
        ),
        stay: obj(
          {
            hotel: str('The Balmoral, 1 Princes Street, Edinburgh EH2 2EQ'),
            room: str('Deluxe King - breakfast included'),
            check_in: datetime('2026-11-06T15:00:00+00:00', 'Check-in'),
            check_out: datetime('2026-11-09T12:00:00+00:00', 'Check-out'),
            cancel_free_until: datetime('2026-11-04T18:00:00+00:00', 'Free cancellation until'),
          },
          'Stay details',
        ),
        directions: geopoint(55.9531, -3.1899, 'The Balmoral'),
        voucher: file(
          `${origin}/demo/files/voucher-HB-8F4Q2M.pdf`,
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
          confirm: { title: 'Cancel booking', body_template: 'Cancel reservation HB-8F4Q2M' },
        }),
        manage: navAction('Manage booking', HB(origin, 'confirmation')),
      },
      navigation: { breadcrumb: [{ label: 'Confirmation', url: HB(origin, 'confirmation') }] },
    }),
  );

  return pages;
}
