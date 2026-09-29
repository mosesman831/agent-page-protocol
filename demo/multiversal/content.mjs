/**
 * Multiversal Airways — content & planning pages: destinations, cabins,
 * baggage, fare finder, travel docs, about. Information-rich manifests whose
 * DOM twin is the glossy marketing surface.
 */

import { str, num, money, obj, arr, media, markdown, table, doc } from '../lib/nodes.mjs';
import { MVA, MVA_ASSETS, AIRPORTS_TO, AIRPORT_LABELS, CABINS, CABIN_LABELS } from './common.mjs';

const MONTHS = ['2026-10', '2026-11', '2026-12'];
const MONTH_LABELS = {
  '2026-10': 'October 2026',
  '2026-11': 'November 2026',
  '2026-12': 'December 2026',
};

const crumbs = (o, label, slug) => ({
  breadcrumb: [
    { label: 'Multiversal Airways', url: MVA(o, 'home') },
    { label, url: MVA(o, slug) },
  ],
});

/** Deterministic fare-calendar: 28 days of lowest fares. */
function fareCalendar(from = '2026-10-01', low = 44900) {
  const rows = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < 28; i++) {
    const day = new Date(d.getTime() + i * 86400000);
    const dow = day.getUTCDay();
    const bump =
      dow === 5 || dow === 0 ? 9400 : dow === 4 ? 4200 : i % 9 === 0 ? -3800 : (i * 1777) % 6100;
    rows.push(
      obj({
        date: str(day.toISOString().slice(0, 10)),
        price: money(Math.max(39900, low + bump), 'GBP'),
      }),
    );
  }
  return arr(rows, 'Lowest fare per day');
}

export function buildContentPages(origin) {
  const pages = new Map();

  /* ---------- destinations ---------- */
  pages.set(
    'destinations',
    doc({
      id: 'mva_destinations',
      origin,
      path: '/app/mva/destinations',
      title: 'Destinations',
      version: 'mva-destinations-1',
      state: {
        gallery: media(
          [
            { url: `${MVA_ASSETS}/mva-tokyo.jpg`, alt: 'Tokyo Narita' },
            { url: `${MVA_ASSETS}/mva-nyc.jpg`, alt: 'New York JFK' },
            { url: `${MVA_ASSETS}/mva-dubai.jpg`, alt: 'Dubai' },
            { url: `${MVA_ASSETS}/mva-singapore.jpg`, alt: 'Singapore' },
          ],
          'Where we fly',
        ),
        network: table(
          {
            destination: 'string',
            code: 'string',
            weekly_flights: 'number',
            aircraft: 'string',
            lowest_fare: 'number',
            terminal: 'string',
          },
          [
            ['New York JFK', 'jfk', 21, 'A350-1000 · B777-300ER', 44900, '7/8'],
            ['Newark', 'ewr', 7, 'B787-9', 46100, 'B4'],
            ['Boston Logan', 'bos', 7, 'B787-9', 47300, 'E'],
            ["Chicago O'Hare", 'ord', 10, 'B777-300ER', 48900, '5'],
            ['Los Angeles', 'lax', 10, 'A380-800', 53400, 'B'],
            ['San Francisco', 'sfo', 7, 'B787-9', 54100, 'I'],
            ['Miami', 'mia', 5, 'B777-200', 51200, 'J'],
            ['Dubai', 'dxb', 14, 'A380-800', 52800, '3'],
            ['Singapore Changi', 'sin', 7, 'A350-1000', 68700, '4'],
            ['Tokyo Narita', 'nrt', 7, 'B787-9', 61200, '1'],
          ],
          'Route network from London',
        ),
        notes: markdown(
          [
            '**Hubs** — London Heathrow T3 is home. Reykjavik and Singapore are our transit portals.',
            '- All routes are dual-timeline certified',
            '- Terminal listed is the London departure terminal',
            '- Award space opens at 07:00 UTC daily, 355 days out',
          ].join('\n'),
          'Route notes',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'gallery', state_path: 'gallery', layout: 'grid', label: 'Where we fly' },
          {
            id: 'network',
            state_path: 'network',
            layout: 'table',
            label: 'Route network',
            columns: [
              { key: 'destination', label: 'Destination' },
              { key: 'weekly_flights', label: 'Flights / week', align: 'center' },
              { key: 'aircraft', label: 'Aircraft' },
              { key: 'lowest_fare', label: 'Lowest return', format: 'currency', align: 'right' },
              { key: 'terminal', label: 'T3/T5', align: 'center' },
            ],
            sortable_by: ['lowest_fare', 'weekly_flights'],
          },
          { id: 'notes', state_path: 'notes', layout: 'detail', label: 'Good to know' },
        ],
      },
      actions: {
        find_fares: {
          description: 'Find fares',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            to: {
              type: 'enum',
              description: 'Destination',
              required: true,
              options: AIRPORTS_TO,
              option_labels: AIRPORT_LABELS,
            },
            month: {
              type: 'enum',
              description: 'Month',
              options: MONTHS,
              option_labels: MONTH_LABELS,
              default: '2026-10',
            },
          },
          output: { navigates_to: MVA(origin, 'fare-finder') },
        },
      },
      navigation: crumbs(origin, 'Destinations', 'destinations'),
    }),
  );

  /* ---------- cabins ---------- */
  pages.set(
    'cabins',
    doc({
      id: 'mva_cabins',
      origin,
      path: '/app/mva/cabins',
      title: 'Our cabins',
      version: 'mva-cabins-1',
      state: {
        cabins: arr(
          [
            obj(
              {
                name: str('Voyager'),
                deck: str('Economy'),
                pitch: num(31, { unit: 'in', label: 'Seat pitch' }),
                width: num(18, { unit: 'in', label: 'Seat width' }),
                perks: arr(
                  ['Meal + drinks included', '11" HD screen', 'USB-C power', 'Free messaging'].map(
                    (s) => str(s),
                  ),
                  'Included',
                ),
              },
              'Voyager (economy)',
            ),
            obj(
              {
                name: str('Voyager Plus'),
                deck: str('Premium economy'),
                pitch: num(38, { unit: 'in', label: 'Seat pitch' }),
                width: num(19.5, { unit: 'in', label: 'Seat width' }),
                perks: arr(
                  [
                    'Bigger recline + leg rest',
                    'Premium meal',
                    'Priority boarding',
                    '2× 23kg bags',
                  ].map((s) => str(s)),
                  'Included',
                ),
              },
              'Voyager Plus (premium economy)',
            ),
            obj(
              {
                name: str('Nebula'),
                deck: str('Business'),
                pitch: num(72, { unit: 'in', label: 'Seat pitch' }),
                width: num(22, { unit: 'in', label: 'Seat width' }),
                perks: arr(
                  [
                    'Fully flat bed',
                    'Dine on demand',
                    'Lounge + fast track',
                    'Doors on every suite',
                  ].map((s) => str(s)),
                  'Included',
                ),
              },
              'Nebula (business)',
            ),
            obj(
              {
                name: str('Singularity'),
                deck: str('First'),
                pitch: num(78, { unit: 'in', label: 'Seat pitch' }),
                width: num(23.5, { unit: 'in', label: 'Seat width' }),
                perks: arr(
                  [
                    'Private suite + wardrobe',
                    'À la carte dining',
                    'Chauffeur + concierge',
                    'Guaranteed window view of two skies',
                  ].map((s) => str(s)),
                  'Included',
                ),
              },
              'Singularity (first)',
            ),
          ],
          'Four cabins',
        ),
        compare: table(
          {
            feature: 'string',
            voyager: 'string',
            voyager_plus: 'string',
            nebula: 'string',
            singularity: 'string',
          },
          [
            ['Seat pitch', '31 in', '38 in', '72 in flat', '78 in suite'],
            ['Checked bags', '0–1', '2', '2', '3'],
            ['Seat selection', 'From £21', 'Free', 'Free', 'Free'],
            ['Lounge', '—', '—', 'Nebula Lounge', 'Singularity Spa'],
            ['Dining', 'Meal included', 'Premium meal', 'Dine on demand', 'À la carte + sommelier'],
            ['Wi-Fi', 'From £11.99', 'From £11.99', 'Free', 'Free'],
            ['Entertainment', '11" HD', '13" HD', '17" 4K', '23" 4K + VR horizon'],
          ],
          'Compare cabins',
        ),
        onboard: markdown(
          [
            '**On board every flight**',
            '- Gate-to-gate Wi-Fi (free in Nebula and above)',
            '- 400+ films, timeline-synced live TV',
            '- Kids kits and quiet zones on every wide-body',
            '- Cabin air refreshed every 2 minutes — across both skies',
          ].join('\n'),
          'The onboard experience',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'cabins', state_path: 'cabins', layout: 'grid', label: 'Four cabins' },
          { id: 'compare', state_path: 'compare', layout: 'table', label: 'Side by side' },
          { id: 'onboard', state_path: 'onboard', layout: 'detail', label: 'On board' },
        ],
      },
      actions: {
        search_flights: {
          description: 'Find flights in this cabin',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            cabin: {
              type: 'enum',
              description: 'Cabin',
              required: true,
              options: CABINS,
              option_labels: CABIN_LABELS,
            },
            to: {
              type: 'enum',
              description: 'To',
              required: true,
              options: AIRPORTS_TO,
              option_labels: AIRPORT_LABELS,
            },
            depart: {
              type: 'date',
              description: 'Outbound',
              required: true,
              default: '2026-10-12',
            },
          },
          output: { navigates_to: MVA(origin, 'results') },
        },
      },
      navigation: crumbs(origin, 'Cabins', 'cabins'),
    }),
  );

  /* ---------- baggage ---------- */
  pages.set(
    'baggage',
    doc({
      id: 'mva_baggage',
      origin,
      path: '/app/mva/baggage',
      title: 'Baggage allowance',
      version: 'mva-baggage-1',
      state: {
        allowance: table(
          {
            cabin: 'string',
            cabin_bag: 'string',
            checked_bags: 'string',
            max_weight: 'string',
          },
          [
            ['Voyager Saver', '1 cabin bag', '0 (add from £38)', '10 kg cabin'],
            ['Voyager Classic', '1 cabin bag', '1 × 23 kg', '10 kg cabin'],
            ['Voyager Flex', '1 cabin bag', '2 × 23 kg', '10 kg cabin'],
            ['Voyager Plus', '1 cabin bag', '2 × 23 kg', '10 kg cabin'],
            ['Nebula', '2 cabin bags', '2 × 32 kg', '18 kg cabin'],
            ['Singularity', '2 cabin bags', '3 × 32 kg', '18 kg cabin'],
          ],
          'Allowance by cabin and fare',
        ),
        fees: table(
          { item: 'string', online: 'number', airport: 'number' },
          [
            ['Extra checked bag (23kg)', 3800, 5500],
            ['Overweight bag (23–32kg)', 6500, 7500],
            ['Sports equipment', 4200, 5000],
            ['Musical instrument (in cabin)', 3000, 3800],
          ],
          'Extra fees — cheaper online',
        ),
        restricted: markdown(
          [
            '**Restricted items**',
            '- Liquids over 100ml in cabin bags',
            '- Hoverboards, loose lithium batteries over 160Wh',
            '- Chronal cells must be declared at check-in (timeline regulation 4.7)',
            '- Pets travel with our cabin crew — see Special assistance',
          ].join('\n'),
          'Restricted items',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'allowance', state_path: 'allowance', layout: 'table', label: 'Your allowance' },
          {
            id: 'fees',
            state_path: 'fees',
            layout: 'table',
            label: 'Excess & extras',
            columns: [
              { key: 'item', label: 'Item' },
              { key: 'online', label: 'Online', format: 'currency', align: 'right' },
              { key: 'airport', label: 'At the airport', format: 'currency', align: 'right' },
            ],
          },
          {
            id: 'restricted',
            state_path: 'restricted',
            layout: 'detail',
            label: 'Restricted items',
          },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Baggage', 'baggage'),
    }),
  );

  /* ---------- fare finder ---------- */
  pages.set(
    'fare-finder',
    doc({
      id: 'mva_farefinder',
      origin,
      path: '/app/mva/fare-finder',
      title: 'Fare finder — lowest prices by day',
      version: 'mva-farefinder-1',
      state: {
        query: obj(
          {
            route: str('London Heathrow (LHR) → New York JFK (JFK)'),
            month: str('October 2026'),
            cabin: str('Voyager (economy)'),
          },
          'Searching',
        ),
        calendar: fareCalendar(),
        tip: markdown(
          '**Tip:** Tuesdays and Wednesdays price lowest in every timeline. The green day is the cheapest this month.',
        ),
      },
      present: {
        layout: 'list',
        sections: [{ id: 'query', state_path: 'query', layout: 'detail', label: 'Searching' }],
        components: {
          cal: { type: 'calendar', state_path: 'calendar', label: 'October — lowest return fare' },
        },
      },
      actions: {
        find_fares: {
          description: 'Search this route & month',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            to: {
              type: 'enum',
              description: 'Destination',
              required: true,
              options: AIRPORTS_TO,
              option_labels: AIRPORT_LABELS,
            },
            month: {
              type: 'enum',
              description: 'Month',
              required: true,
              options: MONTHS,
              option_labels: MONTH_LABELS,
            },
            cabin: {
              type: 'enum',
              description: 'Cabin',
              options: CABINS,
              option_labels: CABIN_LABELS,
              default: 'voyager',
            },
          },
          output: { navigates_to: MVA(origin, 'fare-finder') },
        },
        book_lowest: {
          description: 'Book the cheapest date',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'results') },
        },
      },
      navigation: crumbs(origin, 'Fare finder', 'fare-finder'),
    }),
  );

  /* ---------- travel documents ---------- */
  pages.set(
    'travel-docs',
    doc({
      id: 'mva_traveldocs',
      origin,
      path: '/app/mva/travel-docs',
      title: 'Travel documents & entry rules',
      version: 'mva-traveldocs-1',
      state: {
        rules: table(
          {
            destination: 'string',
            passport_validity: 'string',
            visa: 'string',
            other: 'string',
          },
          [
            ['United States', 'Valid for stay', 'ESTA or visa', 'ESTA 72h before travel'],
            ['UAE', '6 months', 'Visa on arrival (UK/EU)', '—'],
            ['Singapore', '6 months', '90 days visa-free', 'SG Arrival Card'],
            ['Japan', 'Valid for stay', '90 days visa-free', 'Visit Japan Web (optional)'],
            ['United Kingdom', 'Valid for stay', 'ETA for visitors', 'Apply before departure'],
          ],
          'Entry rules (British passport holders)',
        ),
        docs_result: str(
          'Pick a destination and nationality to check your documents.',
          'Your check',
        ),
        disclaimer: markdown(
          'Demo data only — real entry rules change. Always check the destination government site before you fly.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'rules', state_path: 'rules', layout: 'table', label: 'Entry rules' },
          { id: 'result', state_path: 'docs_result', layout: 'detail', label: 'Your result' },
          { id: 'disc', state_path: 'disclaimer', layout: 'detail', label: 'Disclaimer' },
        ],
      },
      actions: {
        check_docs: {
          description: 'Check my documents',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            to: {
              type: 'enum',
              description: 'Destination',
              required: true,
              options: AIRPORTS_TO,
              option_labels: AIRPORT_LABELS,
            },
            nationality: {
              type: 'enum',
              description: 'Passport issued by',
              required: true,
              options: ['gb', 'us', 'ie', 'ae', 'jp', 'sg', 'other'],
              option_labels: {
                gb: 'United Kingdom',
                us: 'United States',
                ie: 'Ireland',
                ae: 'UAE',
                jp: 'Japan',
                sg: 'Singapore',
                other: 'Other',
              },
            },
          },
        },
      },
      navigation: crumbs(origin, 'Travel documents', 'travel-docs'),
    }),
  );

  /* ---------- about ---------- */
  pages.set(
    'about',
    doc({
      id: 'mva_about',
      origin,
      path: '/app/mva/about',
      title: 'About Multiversal Airways',
      version: 'mva-about-1',
      state: {
        story: markdown(
          [
            '**Born between two skies.** Multiversal Airways launched in 2019 with one aircraft and a conviction: travel should feel like the future, not a queue.',
            'Today we fly 92 routes across 8 timelines from our London Heathrow T3 home — flat beds for every long-haul sleeper, honest fares, and a crew that has literally seen tomorrow.',
            '### Fleet',
            'An all-new-generation fleet: A350s and 787s for the long work, A220s for the city hops. Average age 4.1 years, quietest cabins in their class.',
            '### Sustainability',
            'Every ticket plants a tree in two timelines. 40% sustainable fuel on all Heathrow departures by 2027.',
            '### Careers',
            'Pilots, cabin crew, timeline engineers, ground teams — crewhouse@multiversal.example.',
          ].join('\n\n'),
          'Our story',
        ),
        fleet: table(
          { aircraft: 'string', in_fleet: 'number', seats: 'number', role: 'string' },
          [
            ['Airbus A350-1000', 24, 351, 'Long-haul flagship'],
            ['Boeing 777-300ER', 18, 332, 'High-density long-haul'],
            ['Boeing 787-9', 22, 276, 'Thin long routes'],
            ['Airbus A380-800', 8, 484, 'Slot-constrained trunk routes'],
            ['Airbus A220-300', 30, 141, 'Short-haul / city'],
          ],
          'The fleet',
        ),
        facts: obj(
          {
            founded: str('2019', 'Founded'),
            destinations: num(92, { label: 'Destinations' }),
            aircraft: num(102, { label: 'Aircraft' }),
            hubs: str('LHR T3 · Reykjavik · Singapore', 'Hubs'),
            alliance: str('Constellation Alliance', 'Alliance'),
          },
          'At a glance',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'story', state_path: 'story', layout: 'detail', label: 'Our story' },
          { id: 'fleet', state_path: 'fleet', layout: 'table', label: 'Fleet' },
          { id: 'facts', state_path: 'facts', layout: 'detail', label: 'At a glance' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'About', 'about'),
    }),
  );

  return pages;
}
