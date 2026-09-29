/**
 * British Airways booking demo — APP page manifests (search & flight selection pages (search → outbound → inbound → fares)).
 * Part of buildBaPages: see pages.mjs for the assembled Map.
 */

import { str, num, money, enumN, obj, arr, table, action, navAction, doc } from '../lib/nodes.mjs';
import { BA, AIRPORTS_FROM, AIRPORTS_TO, CABINS, flightCard } from './common.mjs';

export function buildSearchPages(origin) {
  const pages = new Map();

  /* ---------- 1. home / search ---------- */
  pages.set(
    'home',
    doc({
      id: 'ba_home',
      origin,
      path: '/app/ba/home',
      title: 'British Airways - Book flights',
      version: 'ba-home-1',
      state: {
        notice: str('Extra baggage sale: 20% off prepaid bags until 30 Sep.', 'Notice'),
      },
      present: {
        layout: 'form',
        sections: [],
        components: { notice: { type: 'banner', state_path: 'notice' } },
      },
      actions: {
        // Primary action of a form-layout page carries every field in `input`.
        search_flights: {
          description: 'Search for flights',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
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
              option_labels: {
                lhr: 'London Heathrow',
                lgw: 'London Gatwick',
                lcy: 'London City',
              },
              default: 'lhr',
            },
            to: {
              type: 'enum',
              description: 'To',
              required: true,
              options: AIRPORTS_TO,
              option_labels: {
                jfk: 'New York JFK',
                ewr: 'Newark',
                bos: 'Boston',
                ord: 'Chicago',
                lax: 'Los Angeles',
                sfo: 'San Francisco',
                mia: 'Miami',
                dxb: 'Dubai',
                sin: 'Singapore',
              },
              default: 'jfk',
            },
            depart: {
              type: 'date',
              description: 'Outbound',
              required: true,
              default: '2026-10-12',
            },
            return_date: { type: 'date', description: 'Return', default: '2026-10-19' },
            cabin: {
              type: 'enum',
              description: 'Cabin',
              options: CABINS,
              option_labels: {
                economy: 'Economy (World Traveller)',
                premium_economy: 'Premium economy (World Traveller Plus)',
                business: 'Business (Club World)',
                first: 'First',
              },
              default: 'economy',
            },
            adults: { type: 'number', description: 'Adults (16+)', min: 1, max: 9, default: 1 },
            children: {
              type: 'number',
              description: 'Children (2-15)',
              min: 0,
              max: 8,
              default: 0,
            },
            infants: {
              type: 'number',
              description: 'Infants (under 2)',
              min: 0,
              max: 4,
              default: 0,
            },
            promo_code: { type: 'string', description: 'Promotion code', max_length: 12 },
            direct_only: { type: 'boolean', description: 'Direct flights only' },
            flexible_dates: { type: 'boolean', description: 'My dates are flexible (+-3 days)' },
          },
          output: { navigates_to: BA(origin, 'results') },
        },
      },
      navigation: {
        breadcrumb: [{ label: 'British Airways', url: BA(origin, 'home') }],
      },
    }),
  );

  /* ---------- 2. outbound results ---------- */
  pages.set(
    'results',
    doc({
      id: 'ba_results_out',
      origin,
      path: '/app/ba/results',
      title: 'Choose outbound flight - LHR to JFK',
      version: 'ba-res-1',
      state: {
        summary: obj(
          {
            route: str('London Heathrow (LHR) -> New York JFK'),
            dates: str('Mon 12 Oct 2026, one-way shown'),
            passengers: str('1 adult'),
            cabin: str('Economy (World Traveller)'),
          },
          'Your search',
        ),
        sort_by: enumN(
          'departure',
          ['departure', 'price', 'duration', 'arrival'],
          {
            departure: 'Departure time',
            price: 'Lowest price',
            duration: 'Shortest',
            arrival: 'Arrival time',
          },
          'Sort by',
        ),
        flights: arr(
          [
            flightCard({
              id: 'ba113',
              fn: 'BA113',
              dep: '2026-10-12 08:25',
              arr: '2026-10-12 11:15',
              depT: '5',
              arrT: '7',
              aircraft: 'Airbus A350-1000',
              dur: 470,
              co2: 428,
              stops: 0,
              price: 64200,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba117',
              fn: 'BA117',
              dep: '2026-10-12 11:55',
              arr: '2026-10-12 14:50',
              depT: '5',
              arrT: '7',
              aircraft: 'Boeing 777-300ER',
              dur: 475,
              co2: 512,
              stops: 0,
              price: 68400,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba115',
              fn: 'BA115',
              dep: '2026-10-12 14:30',
              arr: '2026-10-12 17:30',
              depT: '5',
              arrT: '8',
              aircraft: 'Boeing 787-9',
              dur: 480,
              co2: 467,
              stops: 0,
              price: 70100,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba179',
              fn: 'BA179',
              dep: '2026-10-12 18:00',
              arr: '2026-10-12 20:40',
              depT: '5',
              arrT: '7',
              aircraft: 'Airbus A380-800',
              dur: 460,
              co2: 545,
              stops: 0,
              price: 64900,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba0119',
              fn: 'BA119',
              dep: '2026-10-12 20:15',
              arr: '2026-10-12 23:05',
              depT: '5',
              arrT: '7',
              aircraft: 'Boeing 777-200',
              dur: 470,
              co2: 523,
              stops: 0,
              price: 61800,
              fareType: 'economy',
            }),
          ],
          'Outbound flights',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'trip', state_path: 'summary', layout: 'detail', label: 'Your search' },
          {
            id: 'flights',
            state_path: 'flights',
            layout: 'grid',
            columns: [
              { key: 'depart', label: 'Departs' },
              { key: 'arrive', label: 'Arrives' },
              { key: 'dep_terminal', label: 'From T' },
              { key: 'arr_terminal', label: 'To T' },
              { key: 'aircraft', label: 'Aircraft' },
              { key: 'duration_min', label: 'Duration (min)' },
              { key: 'co2_kg', label: 'CO2e (kg)' },
              { key: 'fare_type', label: 'Lowest fare' },
            ],
            item_key: 'id',
            primary_action: 'select_outbound',
            label: 'Outbound - Mon 12 Oct',
          },
        ],
        components: { sort_by: { type: 'button', label: 'Sort', action_id: 'sort_results' } },
      },
      actions: {
        select_outbound: navAction('Select outbound flight', BA(origin, 'return-results')),
        sort_results: action('Sort results', 'mutate', 'safe', {
          input: {
            sort_by: {
              type: 'enum',
              description: 'Sort by',
              options: ['departure', 'price', 'duration', 'arrival'],
              required: true,
            },
          },
          output: { state_diff: true, changes: ['/state/flights', '/state/sort_by'] },
          idempotent: true,
        }),
      },
      navigation: {
        breadcrumb: [
          { label: 'Search', url: BA(origin, 'home') },
          { label: 'Outbound flight', url: BA(origin, 'results') },
        ],
      },
    }),
  );

  /* ---------- 3. return results ---------- */
  pages.set(
    'return-results',
    doc({
      id: 'ba_results_ret',
      origin,
      path: '/app/ba/return-results',
      title: 'Choose return flight - JFK to LHR',
      version: 'ba-ret-1',
      state: {
        summary: obj(
          {
            route: str('New York JFK -> London Heathrow (LHR)'),
            dates: str('Mon 19 Oct 2026, return leg'),
            passengers: str('1 adult'),
            cabin: str('Economy (World Traveller)'),
          },
          'Your search',
        ),
        outbound_selected: obj(
          {
            flight_no: str('BA117'),
            depart: str('Mon 12 Oct 11:55'),
            arrive: str('14:50'),
            price: money(68400, 'GBP'),
          },
          'Selected outbound',
        ),
        flights: arr(
          [
            flightCard({
              id: 'ba112',
              fn: 'BA112',
              dep: '2026-10-19 07:40',
              arr: '2026-10-19 19:15',
              depT: '7',
              arrT: '5',
              aircraft: 'Boeing 777-300ER',
              dur: 395,
              co2: 498,
              stops: 0,
              price: 59000,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba116',
              fn: 'BA116',
              dep: '2026-10-19 12:40',
              arr: '2026-10-20 00:20',
              depT: '8',
              arrT: '5',
              aircraft: 'Boeing 787-9',
              dur: 400,
              co2: 455,
              stops: 0,
              price: 61200,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba178',
              fn: 'BA178',
              dep: '2026-10-19 18:55',
              arr: '2026-10-20 06:40',
              depT: '7',
              arrT: '5',
              aircraft: 'Airbus A380-800',
              dur: 405,
              co2: 531,
              stops: 0,
              price: 66400,
              fareType: 'economy',
            }),
            flightCard({
              id: 'ba182',
              fn: 'BA182',
              dep: '2026-10-19 21:30',
              arr: '2026-10-20 09:15',
              depT: '7',
              arrT: '5',
              aircraft: 'Boeing 777-200',
              dur: 405,
              co2: 519,
              stops: 0,
              price: 57700,
              fareType: 'economy',
            }),
          ],
          'Return flights',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'out', state_path: 'outbound_selected', layout: 'detail', label: 'Outbound' },
          {
            id: 'flights',
            state_path: 'flights',
            layout: 'grid',
            columns: [
              { key: 'depart', label: 'Departs' },
              { key: 'arrive', label: 'Arrives' },
              { key: 'dep_terminal', label: 'From T' },
              { key: 'arr_terminal', label: 'To T' },
              { key: 'aircraft', label: 'Aircraft' },
              { key: 'duration_min', label: 'Duration (min)' },
              { key: 'co2_kg', label: 'CO2e (kg)' },
              { key: 'fare_type', label: 'Lowest fare' },
            ],
            item_key: 'id',
            primary_action: 'select_return',
            label: 'Return - Mon 19 Oct',
          },
        ],
      },
      actions: {
        select_return: navAction('Select return flight', BA(origin, 'fares')),
        change_outbound: navAction('Change outbound flight', BA(origin, 'results')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Search', url: BA(origin, 'home') },
          { label: 'Outbound', url: BA(origin, 'results') },
          { label: 'Return', url: BA(origin, 'return-results') },
        ],
      },
    }),
  );

  /* ---------- 4. fare brands ---------- */
  pages.set(
    'fares',
    doc({
      id: 'ba_fares',
      origin,
      path: '/app/ba/fares',
      title: 'Choose your fare - BA117 + BA182',
      version: 'ba-fare-1',
      state: {
        chosen: obj(
          {
            outbound: str('BA117 - LHR T5 11:55 -> JFK T7 14:50'),
            inbound: str('BA182 - JFK T7 21:30 -> LHR T5 09:15+1'),
            base_price: money(126100, 'GBP'),
          },
          'Your flights',
        ),
        fare_brands: table(
          {
            brand: 'string',
            price_delta: 'number',
            cabin_bag: 'string',
            checked_bags: 'string',
            seat_choice: 'string',
            changes: 'string',
            refunds: 'string',
            avios: 'number',
            tier_points: 'number',
          },
          [
            [
              'economy_basic',
              0,
              '1 x 10kg cabin bag',
              'None (paid)',
              'Paid, from GBP 21',
              'Not permitted',
              'Non-refundable',
              1200,
              20,
            ],
            [
              'economy_standard',
              4500,
              '1 x 10kg cabin bag',
              '1 x 23kg',
              'Free from 24h before',
              'GBP 100 + fare diff',
              'Non-refundable',
              1800,
              40,
            ],
            [
              'economy_flex',
              11800,
              '1 x 10kg cabin bag',
              '2 x 23kg',
              'Free anytime',
              'Free',
              'Fully refundable',
              2600,
              60,
            ],
            [
              'premium_economy',
              38900,
              '1 x 10kg cabin bag',
              '2 x 23kg',
              'Free anytime',
              'GBP 60 + fare diff',
              'Non-refundable',
              3200,
              90,
            ],
            [
              'business_club',
              152400,
              '2 x 16kg cabin bags',
              '2 x 32kg',
              'Free anytime',
              'Free',
              'Fully refundable',
              6800,
              140,
            ],
          ],
          'Compare fares',
        ),
        luggage_note: str('Extra bags: GBP 65 each way online, GBP 75 at the airport.', 'Bags'),
        price_scale: num(2, { label: 'Minor units per major unit' }),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'chosen', state_path: 'chosen', layout: 'detail', label: 'Selected flights' },
          {
            id: 'brands',
            state_path: 'fare_brands',
            layout: 'table',
            columns: [
              { key: 'brand', label: 'Fare' },
              { key: 'price_delta', label: 'Add', format: 'currency', align: 'right' },
              { key: 'cabin_bag', label: 'Cabin bag' },
              { key: 'checked_bags', label: 'Checked bags' },
              { key: 'changes', label: 'Changes' },
              { key: 'refunds', label: 'Refund' },
              { key: 'avios', label: 'Avios', align: 'right' },
              { key: 'tier_points', label: 'Tier pts', align: 'right' },
            ],
            primary_action: 'choose_fare',
            label: 'Fare brands',
          },
        ],
        components: { luggage_note: { type: 'banner', state_path: 'luggage_note' } },
      },
      actions: {
        choose_fare: navAction('Continue with Economy Standard (+GBP 45)', BA(origin, 'seats')),
        choose_fare_business: navAction('Upgrade to Club World (+GBP 1,524)', BA(origin, 'seats')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Search', url: BA(origin, 'home') },
          { label: 'Flights', url: BA(origin, 'results') },
          { label: 'Fare', url: BA(origin, 'fares') },
        ],
      },
    }),
  );

  return pages;
}
