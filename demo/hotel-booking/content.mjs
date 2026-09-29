/**
 * Halvern House — content pages: destinations (the collection), offers &
 * gift cards, dining & spa, meetings & events. Part of buildHotelPages.
 */

import { str, num, obj, arr, table, media, markdown, action, doc } from '../lib/nodes.mjs';
import { HB, HOTEL_ASSETS, crumbs, HOUSES, DESTINATION_LABELS, gbp } from './common.mjs';

const OFFERS = [
  {
    id: 'autumn-city',
    name: 'Autumn in the city',
    houses: 'The Observatory · Chapter Court',
    detail: 'Two nights, dinner on the first evening, lazy breakfast and a late 2pm checkout.',
    from: 21900,
    book_by: '30 Nov 2026',
  },
  {
    id: 'country-weekender',
    name: 'The country weekender',
    houses: 'Tarn Hows Lodge · Meadow Court · Ben Alder Lodge',
    detail: 'Dinner, bed & breakfast in the fells or the shires — muddy boots welcome.',
    from: 14900,
    book_by: '22 Dec 2026',
  },
  {
    id: 'stay-longer',
    name: 'Stay longer — fourth night free',
    houses: 'All collection houses',
    detail: 'Book four nights at the standard rate and the fourth is on us. Every season.',
    from: 0,
    book_by: 'Always on',
  },
  {
    id: 'spa-dine',
    name: 'Spa & dine',
    houses: 'The Crescent Spa · The Observatory',
    detail: 'Thermal circuit, 60-minute treatment and afternoon tea for two.',
    from: 9900,
    book_by: '31 Jan 2027',
  },
  {
    id: 'paris-rail',
    name: 'Paris by rail',
    houses: 'Maison Lumière',
    detail:
      'Two nights in Le Marais with breakfast — pair it with the Eurostar for a car-free break.',
    from: 38900,
    book_by: '15 Dec 2026',
  },
];

const VENUES = [
  {
    id: 'forth-table',
    name: 'The Forth Table',
    house: 'The Observatory, Edinburgh',
    style: 'Modern Scottish tasting menu',
    hours: 'Dinner Tue–Sat 18:00–22:00',
    dress: 'Smart casual',
  },
  {
    id: 'lantern-bar',
    name: 'The Lantern Bar',
    house: 'The Observatory, Edinburgh',
    style: 'Cocktails, rare whiskies & terrace plates',
    hours: 'Daily 12:00–01:00',
    dress: 'Come as you are',
  },
  {
    id: 'tarn-kitchen',
    name: 'Tarn Kitchen',
    house: 'Tarn Hows Lodge, Lake District',
    style: 'Lakeland larder, lake-view all-day dining',
    hours: 'Daily 07:30–21:30',
    dress: 'Walkers welcome',
  },
  {
    id: 'orangery',
    name: 'The Orangery',
    house: 'Meadow Court, Cotswolds',
    style: 'Afternoon tea & Sunday lunch',
    hours: 'Tea daily 14:00–17:00',
    dress: 'Country house',
  },
  {
    id: 'jardin',
    name: 'Le Jardin',
    house: 'Maison Lumière, Paris',
    style: 'French classics in the courtyard garden',
    hours: 'Daily 12:00–23:00',
    dress: 'Chic',
  },
];

const TREATMENTS = [
  ['Thermal circuit & pools', 'Crescent Spa · Bath', 90, 4500],
  ['Halvern signature massage', 'Every house', 60, 11000],
  ['Hot stone ritual', 'The Observatory · Edinburgh', 75, 12500],
  ['Radiance facial', 'Every house', 60, 9500],
  ['Mud & minerals wrap', 'Crescent Spa · Bath', 60, 10500],
];

const SPACES = [
  {
    id: 'railway',
    name: 'The Railway Suite',
    house: 'The Observatory, Edinburgh',
    theatre: 180,
    dinner: 120,
    boardroom: 40,
    sqm: 210,
  },
  {
    id: 'clock',
    name: 'The Clock Room',
    house: 'The Observatory, Edinburgh',
    theatre: 60,
    dinner: 36,
    boardroom: 24,
    sqm: 84,
  },
  {
    id: 'long-barn',
    name: 'The Long Barn',
    house: 'Meadow Court, Cotswolds',
    theatre: 160,
    dinner: 140,
    boardroom: 30,
    sqm: 190,
  },
  {
    id: 'garden-room',
    name: 'The Garden Room',
    house: 'Meadow Court, Cotswolds',
    theatre: 30,
    dinner: 20,
    boardroom: 18,
    sqm: 52,
  },
  {
    id: 'conservatory',
    name: 'The Conservatory',
    house: 'Tarn Hows Lodge, Lake District',
    theatre: 40,
    dinner: 30,
    boardroom: 16,
    sqm: 60,
  },
];

export function buildContentPages(origin) {
  const pages = new Map();

  /* ---------- destinations / the collection ---------- */
  pages.set(
    'destinations',
    doc({
      id: 'hb_destinations',
      origin,
      path: '/app/hotel/destinations',
      title: 'The collection — destinations & houses',
      version: 'hb-dest-1',
      state: {
        houses: arr(
          HOUSES.map((h) =>
            obj(
              {
                name: str(h.name, 'House'),
                city: str(`${h.city}, ${h.country}`, 'Where'),
                stars: str('★'.repeat(h.stars), 'Stars'),
                rating: str(`${h.rating}/10`, 'Guest rating'),
                nightly: str(`${gbp(h.nightly)} per night`, 'From'),
                tag: str(h.tag, 'Known for'),
                photo: media([{ url: `${HOTEL_ASSETS}/${h.img}`, alt: `${h.name}, ${h.city}` }]),
              },
              h.name,
            ),
          ),
          'Houses',
        ),
        guide: markdown(
          [
            '**Where we live**',
            'Each Halvern house keeps its own character — we collect houses, not copies.',
            '',
            '**City houses** — Edinburgh, London, York, Paris, Amsterdam. Steps from the action, quiet behind the door.',
            '**Country houses** — the Lakes, the Highlands, the Cotswolds, Cornwall. Fires, wellies and long lunches.',
            '**Spa houses** — Bath and Edinburgh hold the thermal suites.',
          ].join('\n'),
          'The collection',
        ),
        featured: str(
          'New this season — The Canal House, Amsterdam: twin canal houses on the Herengracht.',
          'Featured',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'houses', state_path: 'houses', layout: 'grid', label: 'The houses' },
          { id: 'guide', state_path: 'guide', layout: 'detail', label: 'Where we live' },
        ],
        components: { featured: { type: 'banner', state_path: 'featured' } },
      },
      actions: {
        plan_stay: {
          description: 'Check availability at a destination',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            destination: {
              type: 'enum',
              description: 'Destination',
              required: true,
              options: Object.keys(DESTINATION_LABELS),
              option_labels: DESTINATION_LABELS,
              default: 'edinburgh',
            },
            check_in: { type: 'date', description: 'Check-in', default: '2026-11-06' },
            nights: { type: 'number', description: 'Nights', min: 1, max: 30, default: 3 },
          },
          output: { navigates_to: HB(origin, 'results') },
        },
      },
      navigation: {
        ...crumbs(origin, [{ label: 'The collection', slug: 'destinations' }]),
        related: [{ label: 'Offers', url: HB(origin, 'deals'), rel: 'related' }],
      },
    }),
  );

  /* ---------- deals & gift cards ---------- */
  pages.set(
    'deals',
    doc({
      id: 'hb_deals',
      origin,
      path: '/app/hotel/deals',
      title: 'Offers & gift cards',
      version: 'hb-deals-1',
      state: {
        offers: arr(
          OFFERS.map((d) =>
            obj(
              {
                name: str(d.name, 'Offer'),
                houses: str(d.houses, 'At'),
                detail: str(d.detail, 'Includes'),
                from: str(`${gbp(d.from)} per person`, 'From'),
                book_by: str(d.book_by, 'Book by'),
              },
              d.name,
            ),
          ),
          'Current offers',
        ),
        gift_cards: obj(
          {
            note: str(
              'Halvern House gift cards spend like cash at every house — rooms, dinner, spa.',
              'Gift cards',
            ),
            delivery: str('Instant e-card or a boxed card by post (£3.50)', 'Delivery'),
            validity: str('18 months from issue', 'Valid for'),
          },
          'Gift cards',
        ),
        subscribed: str('Not subscribed yet.', 'Newsletter'),
        gift_status: str('No gift cards ordered yet.', 'Your gift cards'),
        smallprint: str(
          'Offers are per person based on two sharing; “from” prices vary by house and date.',
          'Small print',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'offers', state_path: 'offers', layout: 'grid', label: 'Current offers' },
          { id: 'gift', state_path: 'gift_cards', layout: 'detail', label: 'Gift cards' },
          { id: 'gstat', state_path: 'gift_status', layout: 'detail', label: 'Your gift cards' },
          { id: 'news', state_path: 'subscribed', layout: 'detail', label: 'Newsletter' },
        ],
        components: { smallprint: { type: 'banner', state_path: 'smallprint' } },
      },
      actions: {
        book_offer: {
          description: 'Book an offer',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            offer: {
              type: 'enum',
              description: 'Offer',
              required: true,
              options: OFFERS.map((d) => d.id),
              option_labels: Object.fromEntries(OFFERS.map((d) => [d.id, d.name])),
              default: 'autumn-city',
            },
          },
          output: { navigates_to: HB(origin, 'results') },
        },
        buy_gift_card: action('Buy a gift card', 'mutate', 'financial', {
          input: {
            amount: {
              type: 'enum',
              description: 'Amount',
              required: true,
              options: ['50', '100', '200', '500'],
              option_labels: { 50: '£50', 100: '£100', 200: '£200', 500: '£500' },
              default: '100',
            },
            delivery: {
              type: 'enum',
              description: 'Delivery',
              options: ['ecard', 'boxed'],
              option_labels: { ecard: 'Instant e-card', boxed: 'Boxed card by post' },
              default: 'ecard',
            },
            recipient_email: {
              type: 'string',
              description: 'Recipient email (e-cards)',
              pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            },
          },
          output: {},
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Buy gift card',
            body_template: 'Buy a £{param.amount} Halvern House gift card ({param.delivery})',
          },
        }),
        subscribe: action('Get the offers email', 'mutate', 'safe', {
          input: {
            email: {
              type: 'string',
              description: 'Email address',
              required: true,
              pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            },
          },
          output: {},
          idempotent: true,
        }),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Offers & gift cards', slug: 'deals' }]),
      },
    }),
  );

  /* ---------- dining & spa ---------- */
  pages.set(
    'dining',
    doc({
      id: 'hb_dining',
      origin,
      path: '/app/hotel/dining',
      title: 'Dining, spa & wellbeing',
      version: 'hb-dining-1',
      state: {
        venues: arr(
          VENUES.map((v) =>
            obj(
              {
                name: str(v.name, 'Venue'),
                house: str(v.house, 'At'),
                style: str(v.style, 'Style'),
                hours: str(v.hours, 'Hours'),
                dress: str(v.dress, 'Dress'),
              },
              v.name,
            ),
          ),
          'Restaurants & bars',
        ),
        treatments: table(
          { treatment: 'string', where: 'string', minutes: 'number', price: 'string' },
          TREATMENTS.map(([t, w, m, p]) => [t, w, m, gbp(p)]),
          'Spa menu',
        ),
        spa_note: str(
          'Thermal suites are resident-only at The Crescent Spa; day guests welcome elsewhere.',
          'Spa access',
        ),
        table_status: str('No table requests yet.', 'Table requests'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'venues', state_path: 'venues', layout: 'grid', label: 'Restaurants & bars' },
          {
            id: 'spa',
            state_path: 'treatments',
            layout: 'table',
            columns: [
              { key: 'treatment', label: 'Treatment' },
              { key: 'where', label: 'Where' },
              { key: 'minutes', label: 'Minutes', align: 'right' },
              { key: 'price', label: 'Price', align: 'right' },
            ],
            label: 'The spa menu',
          },
          { id: 'tstat', state_path: 'table_status', layout: 'detail', label: 'Table requests' },
        ],
        components: { spa_note: { type: 'banner', state_path: 'spa_note' } },
      },
      actions: {
        request_table: action('Request a table', 'mutate', 'safe', {
          input: {
            venue: {
              type: 'enum',
              description: 'Venue',
              required: true,
              options: VENUES.map((v) => v.id),
              option_labels: Object.fromEntries(VENUES.map((v) => [v.id, v.name])),
              default: 'forth-table',
            },
            date: { type: 'date', description: 'Date', required: true, default: '2026-11-07' },
            time: {
              type: 'enum',
              description: 'Time',
              options: ['1200', '1300', '1800', '1900', '2000', '2100'],
              option_labels: {
                1200: '12:00',
                1300: '13:00',
                1800: '18:00',
                1900: '19:00',
                2000: '20:00',
                2100: '21:00',
              },
              default: '1900',
            },
            party: { type: 'number', description: 'Guests', min: 1, max: 12, default: 2 },
            occasion: { type: 'string', description: 'Occasion (optional)', max_length: 80 },
          },
          output: {},
          idempotent: true,
        }),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Dining & spa', slug: 'dining' }]),
        related: [{ label: 'Offers', url: HB(origin, 'deals'), rel: 'related' }],
      },
    }),
  );

  /* ---------- meetings & events ---------- */
  pages.set(
    'events',
    doc({
      id: 'hb_events',
      origin,
      path: '/app/hotel/events',
      title: 'Meetings, weddings & events',
      version: 'hb-events-1',
      state: {
        spaces: arr(
          SPACES.map((s) =>
            obj(
              {
                name: str(s.name, 'Space'),
                house: str(s.house, 'At'),
                theatre: num(s.theatre, { label: 'Theatre' }),
                dinner: num(s.dinner, { label: 'Dinner' }),
                boardroom: num(s.boardroom, { label: 'Boardroom' }),
                sqm: str(`${s.sqm} m²`, 'Size'),
              },
              s.name,
            ),
          ),
          'Event spaces',
        ),
        day_rates: table(
          { package: 'string', includes: 'string', per_person: 'string' },
          [
            ['Day delegate', 'Room, coffee, lunch & stationery', gbp(5900)],
            ['24-hour delegate', 'Day delegate + dinner, bed & breakfast', gbp(18900)],
            ['Wedding breakfast', 'Three courses, wine & toast drinks', gbp(8900)],
          ],
          'Delegate packages',
        ),
        quote_status: str('No quote requested yet.', 'Your quote'),
        planner_note: str(
          'A dedicated events planner is assigned to every booking over 20 guests.',
          'Planning',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'spaces', state_path: 'spaces', layout: 'grid', label: 'Event spaces' },
          {
            id: 'rates',
            state_path: 'day_rates',
            layout: 'table',
            columns: [
              { key: 'package', label: 'Package' },
              { key: 'includes', label: 'Includes' },
              { key: 'per_person', label: 'Per person', align: 'right' },
            ],
            label: 'Delegate packages',
          },
          { id: 'qstat', state_path: 'quote_status', layout: 'detail', label: 'Your quote' },
        ],
        components: { planner_note: { type: 'banner', state_path: 'planner_note' } },
      },
      actions: {
        request_quote: action('Request an event quote', 'mutate', 'safe', {
          input: {
            event_type: {
              type: 'enum',
              description: 'Event type',
              options: ['meeting', 'conference', 'wedding', 'dinner', 'retreat'],
              option_labels: {
                meeting: 'Meeting',
                conference: 'Conference',
                wedding: 'Wedding',
                dinner: 'Private dinner',
                retreat: 'Company retreat',
              },
              default: 'meeting',
            },
            guests: { type: 'number', description: 'Guests', min: 2, max: 180, default: 24 },
            date: { type: 'date', description: 'Preferred date', default: '2027-03-12' },
            overnight: { type: 'boolean', description: 'Bedrooms needed' },
            contact_name: { type: 'string', description: 'Your name', required: true },
            email: {
              type: 'string',
              description: 'Email',
              required: true,
              pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            },
          },
          output: {},
          idempotent: true,
        }),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Meetings & events', slug: 'events' }]),
      },
    }),
  );

  return pages;
}
