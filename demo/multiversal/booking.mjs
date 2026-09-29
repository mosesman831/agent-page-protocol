/**
 * Multiversal Airways — booking pages (seats → extras → passengers → review).
 * Part of buildMvaPages: see pages.mjs for the assembled Map.
 */

import { str, num, obj, table, money, enumN, doc } from '../lib/nodes.mjs';
import { MVA, CABIN_LABELS, seatMap, EXTRAS, MEAL, TITLES, COUNTRIES } from './common.mjs';

export function buildBookingPages(origin) {
  const pages = new Map();

  /* ---------- seats ---------- */
  pages.set(
    'seats',
    doc({
      id: 'mva_seats',
      origin,
      path: '/app/mva/seats',
      title: 'Choose seats — MV17 + MV18',
      version: 'mva-seat-1',
      state: {
        leg: obj(
          {
            outbound: str('MV17 · LHR → JFK · Voyager', 'Outbound'),
            inbound: str('MV18 · JFK → LHR · Voyager', 'Return'),
            aircraft: str('Boeing 777-300ER', 'Aircraft'),
          },
          'Your flights',
        ),
        seat_map: seatMap('classic'),
        selected: obj(
          {
            pax1_outbound: str('24K', 'Outbound — Adult 1'),
            pax1_return: str('24A', 'Return — Adult 1'),
          },
          'Selected seats',
        ),
        seat_fees: money(3300, 'GBP'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'leg', state_path: 'leg', layout: 'detail', label: 'Legs' },
          { id: 'map', state_path: 'seat_map', layout: 'table', label: 'Seat map' },
          { id: 'sel', state_path: 'selected', layout: 'detail', label: 'Selected' },
        ],
      },
      actions: {
        select_seat: {
          description: 'Select a seat',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            leg: {
              type: 'enum',
              description: 'For flight',
              options: ['outbound', 'return'],
              option_labels: { outbound: 'Outbound MV17', return: 'Return MV18' },
              required: true,
            },
            seat: {
              type: 'string',
              description: 'Seat (e.g. 24K — see seat map, available only)',
              required: true,
              pattern: '^[0-9]{2}[A-K]$',
            },
          },
          output: {},
        },
        continue_extras: {
          description: 'Continue to extras',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'extras') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Results', url: MVA(origin, 'results-return') },
          { label: 'Seats', url: MVA(origin, 'seats') },
        ],
      },
    }),
  );

  /* ---------- extras ---------- */
  pages.set(
    'extras',
    doc({
      id: 'mva_extras',
      origin,
      path: '/app/mva/extras',
      title: 'Add extras — bags, meals, lounge',
      version: 'mva-ext-1',
      state: {
        catalog: table(
          { extra: 'string', kind: 'enum', price: 'number' },
          EXTRAS.map((e) => [e.label, e.kind, e.unit]),
          'Available extras',
        ),
        chosen: obj(
          {
            bag_23: num(1, { label: 'Checked bags (23kg)' }),
            meal_upgrade: enumN('standard', MEAL, {}, 'Meal'),
            lounge: enumN('no', ['yes', 'no'], {}, 'Nebula Lounge'),
            wifi: enumN('no', ['yes', 'no'], {}, 'Wi-Fi'),
            insurance: enumN('no', ['yes', 'no'], {}, 'Insurance'),
          },
          'Your extras',
        ),
        extras_total: money(3800, 'GBP'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'cat', state_path: 'catalog', layout: 'table', label: 'Catalog' },
          { id: 'sel', state_path: 'chosen', layout: 'detail', label: 'Your extras' },
        ],
      },
      actions: {
        update_extras: {
          description: 'Update extras (total recalculates)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            bag_23: {
              type: 'number',
              description: 'Checked bags 23kg (£38 each)',
              min: 0,
              max: 3,
              default: 1,
            },
            meal_upgrade: {
              type: 'enum',
              description: 'Meal (£14 unless standard)',
              options: MEAL,
              default: 'standard',
            },
            lounge: { type: 'boolean', description: 'Nebula Lounge access (£45)' },
            wifi: { type: 'boolean', description: 'Full-flight Wi-Fi (£11.99)' },
            priority: { type: 'boolean', description: 'Priority boarding (£9)' },
            insurance: { type: 'boolean', description: 'Travel insurance (£22)' },
            offset: { type: 'boolean', description: 'Carbon offset (£4.50)' },
          },
          output: {},
        },
        continue_pax: {
          description: 'Continue to passenger details',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'passengers') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Seats', url: MVA(origin, 'seats') },
          { label: 'Extras', url: MVA(origin, 'extras') },
        ],
      },
    }),
  );

  /* ---------- passengers ---------- */
  pages.set(
    'passengers',
    doc({
      id: 'mva_pax',
      origin,
      path: '/app/mva/passengers',
      title: 'Passenger details',
      version: 'mva-pax-1',
      state: {
        travellers: obj(
          {
            pax1: str('Adult 1 — primary contact', 'Passenger 1'),
          },
          'Travellers',
        ),
        reminder: str('Names must match the travel document exactly.', 'Reminder'),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'trav', state_path: 'travellers', layout: 'detail', label: 'Travellers' }],
        components: { reminder: { type: 'banner', state_path: 'reminder' } },
      },
      actions: {
        save_passengers: {
          description: 'Save passengers and review booking',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            pax1_title: {
              type: 'enum',
              description: 'Title',
              options: TITLES,
              required: true,
              default: 'mr',
            },
            pax1_first: {
              type: 'string',
              description: 'First name',
              required: true,
              max_length: 40,
            },
            pax1_last: { type: 'string', description: 'Last name', required: true, max_length: 40 },
            pax1_dob: { type: 'date', description: 'Date of birth', required: true },
            pax1_passport: {
              type: 'string',
              description: 'Passport number',
              required: true,
              pattern: '^[A-Z0-9]{6,9}$',
            },
            pax1_nationality: {
              type: 'enum',
              description: 'Nationality',
              options: COUNTRIES,
              required: true,
              default: 'gb',
            },
            pax1_meal: {
              type: 'enum',
              description: 'Dietary meal (standard included)',
              options: MEAL,
              default: 'standard',
            },
            contact_email: {
              type: 'string',
              description: 'Email',
              required: true,
              pattern: '^[^@\\s]+@[^@\\s]+$',
            },
            contact_phone: {
              type: 'string',
              description: 'Mobile (with country code)',
              required: true,
              max_length: 16,
            },
            ff_number: {
              type: 'string',
              description: 'Singularity number (optional)',
              max_length: 10,
            },
          },
          output: { navigates_to: MVA(origin, 'review') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Extras', url: MVA(origin, 'extras') },
          { label: 'Passengers', url: MVA(origin, 'passengers') },
        ],
      },
    }),
  );

  /* ---------- review ---------- */
  pages.set(
    'review',
    doc({
      id: 'mva_review',
      origin,
      path: '/app/mva/review',
      title: 'Review your trip — £912.99',
      version: 'mva-rev-1',
      state: {
        itinerary: table(
          {
            leg: 'string',
            flight: 'string',
            departs: 'string',
            arrives: 'string',
            cabin: 'string',
          },
          [
            [
              'Outbound',
              'MV17 · B777-300ER',
              'Mon 12 Oct 11:30 LHR T3',
              'Mon 12 Oct 14:20 JFK T7',
              CABIN_LABELS.voyager,
            ],
            [
              'Return',
              'MV18 · B777-200',
              'Mon 19 Oct 21:30 JFK T7',
              'Tue 20 Oct 09:15 LHR T3',
              CABIN_LABELS.voyager,
            ],
          ],
          'Itinerary',
        ),
        party: obj(
          {
            passenger: str('Mr Moses Man', 'Adult 1'),
            seats: str('24K (out) · 24A (ret)', 'Seats'),
            meal: str('Standard', 'Meal'),
            contact: str('mo***@*** (hidden)', 'Contact'),
          },
          'Party',
        ),
        totals: table(
          { item: 'string', amount: 'number' },
          [
            ['Fare — Classic ×1', 82100],
            ['Seats', 3300],
            ['Extras', 3800],
            ['Taxes & carrier charges', 9900 - 3800],
            ['Total', 91299],
          ],
          'Price breakdown',
        ),
        fare_rules: str(
          'Classic: changes £95 + fare difference; refunds to voucher. Seat and bag fees non-refundable.',
          'Fare rules',
        ),
        checklist: num(7, { label: 'Step 7 of 8 — Review', min: 1, max: 8 }),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'itn', state_path: 'itinerary', layout: 'table', label: 'Itinerary' },
          { id: 'party', state_path: 'party', layout: 'detail', label: 'Party' },
          { id: 'tot', state_path: 'totals', layout: 'table', label: 'Price' },
        ],
        components: {
          checklist: { type: 'stepper', state_path: 'checklist', label: 'Booking progress' },
        },
      },
      actions: {
        proceed_to_pay: {
          description: 'Proceed to secure payment',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            accept_rules: {
              type: 'boolean',
              description: 'I have read the fare rules and Conditions of Carriage',
              required: true,
            },
          },
          output: { navigates_to: MVA(origin, 'payment') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Passengers', url: MVA(origin, 'passengers') },
          { label: 'Review', url: MVA(origin, 'review') },
        ],
      },
    }),
  );

  return pages;
}
