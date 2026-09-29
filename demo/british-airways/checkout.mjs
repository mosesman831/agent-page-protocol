/**
 * British Airways booking demo — APP page manifests (booking & payment pages (seats → passengers → pay → PNR)).
 * Part of buildBaPages: see pages.mjs for the assembled Map.
 */

import {
  str,
  num,
  money,
  datetime,
  enumN,
  obj,
  arr,
  table,
  file,
  order,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';
import { BA, MEAL, TITLES, COUNTRIES } from './common.mjs';

export function buildCheckoutPages(origin) {
  const pages = new Map();

  /* ---------- 5. seats ---------- */
  pages.set(
    'seats',
    doc({
      id: 'ba_seats',
      origin,
      path: '/app/ba/seats',
      title: 'Choose seats - BA117',
      version: 'ba-seat-1',
      state: {
        leg: obj(
          {
            route: str('LHR -> JFK'),
            flight: str('BA117'),
            aircraft: str('Boeing 777-300ER'),
            cabin: str('Economy (World Traveller)'),
          },
          'Leg',
        ),
        passenger: enumN('pax1', ['pax1'], { pax1: 'Adult 1' }, 'Seat for'),
        price_scale: num(2, { label: 'Minor units per major unit' }),
        seat_map: table(
          {
            seat: 'string',
            row: 'number',
            pos: 'enum',
            seat_type: 'enum',
            status: 'enum',
            price: 'number',
          },
          [
            ['20A', 20, 'window', 'standard', 'occupied', 0],
            ['20B', 20, 'middle', 'standard', 'occupied', 0],
            ['20C', 20, 'aisle', 'standard', 'available', 2100],
            ['20D', 20, 'aisle', 'standard', 'available', 2100],
            ['20E', 20, 'middle', 'standard', 'occupied', 0],
            ['20K', 20, 'window', 'standard', 'available', 2100],
            ['23A', 23, 'window', 'extra_legroom', 'available', 6400],
            ['23C', 23, 'aisle', 'extra_legroom', 'available', 6400],
            ['23H', 23, 'aisle', 'extra_legroom', 'occupied', 0],
            ['23K', 23, 'window', 'extra_legroom', 'available', 6400],
            ['31A', 31, 'window', 'preferred', 'available', 3300],
            ['31C', 31, 'aisle', 'preferred', 'available', 3300],
            ['31K', 31, 'window', 'preferred', 'available', 3300],
            ['41D', 41, 'aisle', 'standard', 'available', 0],
            ['41E', 41, 'middle', 'standard', 'available', 0],
            ['41F', 41, 'middle', 'standard', 'available', 0],
            ['41K', 41, 'window', 'standard', 'available', 0],
          ],
          'Economy cabin - rows 20-41',
        ),
        selected: obj(
          {
            pax1_outbound: str('23K', 'Outbound seat (Adult 1)'),
            pax1_return: str('Not selected', 'Return seat (Adult 1)'),
            seat_cost_total: money(6400, 'GBP', 2),
          },
          'Seat selection',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'leg', state_path: 'leg', layout: 'detail', label: 'Flight' },
          {
            id: 'map',
            state_path: 'seat_map',
            layout: 'table',
            columns: [
              { key: 'seat', label: 'Seat' },
              { key: 'row', label: 'Row' },
              { key: 'pos', label: 'Position' },
              { key: 'seat_type', label: 'Type' },
              { key: 'status', label: 'Status' },
              { key: 'price', label: 'Price', format: 'currency', align: 'right' },
            ],
            primary_action: 'pick_seat',
            label: 'Seat map',
          },
          { id: 'sel', state_path: 'selected', layout: 'detail', label: 'Your seats' },
        ],
      },
      actions: {
        pick_seat: action('Pick seat', 'mutate', 'safe', {
          input: {
            seat: {
              type: 'string',
              description: 'Seat',
              required: true,
              pattern: '^[0-9]{1,2}[A-K]$',
            },
          },
          output: { state_diff: true, changes: ['/state/selected', '/state/seat_map'] },
          idempotent: true,
        }),
        continue_passengers: navAction('Continue to passenger details', BA(origin, 'passengers')),
        skip_seats: navAction('Skip seat selection', BA(origin, 'passengers')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Fare', url: BA(origin, 'fares') },
          { label: 'Seats', url: BA(origin, 'seats') },
        ],
      },
    }),
  );

  /* ---------- 6. passengers ---------- */
  pages.set(
    'passengers',
    doc({
      id: 'ba_passengers',
      origin,
      path: '/app/ba/passengers',
      title: 'Passenger details',
      version: 'ba-pax-1',
      state: {
        flight_summary: str(
          'BA117 LHR->JFK 11:55 + BA182 JFK->LHR 21:30 - Economy Standard - 1 adult',
          'Trip',
        ),
      },
      present: { layout: 'form', sections: [] },
      actions: {
        save_passengers: {
          description: 'Save passenger details and continue to payment',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            title: {
              type: 'enum',
              description: 'Title',
              options: TITLES,
              option_labels: {
                mr: 'Mr',
                ms: 'Ms',
                mrs: 'Mrs',
                dr: 'Dr',
                miss: 'Miss',
              },
              default: 'mr',
            },
            given_name: { type: 'string', description: 'First name', required: true },
            family_name: { type: 'string', description: 'Last name', required: true },
            dob: { type: 'date', description: 'Date of birth', required: true },
            nationality: {
              type: 'enum',
              description: 'Nationality',
              options: COUNTRIES,
              option_labels: {
                gb: 'United Kingdom',
                us: 'United States',
                ie: 'Ireland',
                de: 'Germany',
                fr: 'France',
                ae: 'UAE',
                in: 'India',
              },
              default: 'gb',
            },
            passport_no: { type: 'string', description: 'Passport number', required: true },
            passport_expiry: { type: 'date', description: 'Passport expiry', required: true },
            issuing_country: {
              type: 'enum',
              description: 'Issuing country',
              options: COUNTRIES,
              option_labels: {
                gb: 'United Kingdom',
                us: 'United States',
                ie: 'Ireland',
                de: 'Germany',
                fr: 'France',
                ae: 'UAE',
                in: 'India',
              },
              default: 'gb',
            },
            exec_club: { type: 'string', description: 'Executive Club number (optional)' },
            meal: {
              type: 'enum',
              description: 'Meal preference',
              options: MEAL,
              default: 'standard',
            },
            wheelchair: { type: 'boolean', description: 'Wheelchair assistance required' },
            medical_device: { type: 'boolean', description: 'Carrying a medical device' },
            email: { type: 'string', description: 'Email', required: true },
            phone: { type: 'string', description: 'Mobile', required: true },
            emergency_name: { type: 'string', description: 'Emergency contact name' },
            emergency_phone: { type: 'string', description: 'Emergency contact phone' },
          },
          output: { navigates_to: BA(origin, 'payment') },
        },
        back_seats: navAction('Back to seats', BA(origin, 'seats')),
      },
      navigation: {
        breadcrumb: [
          { label: 'Seats', url: BA(origin, 'seats') },
          { label: 'Passengers', url: BA(origin, 'passengers') },
        ],
      },
    }),
  );

  /* ---------- 7. payment ---------- */
  pages.set(
    'payment',
    doc({
      id: 'ba_payment',
      origin,
      path: '/app/ba/payment',
      title: 'Pay - GBP 1,397.00',
      version: 'ba-pay-1',
      state: {
        order: order(
          {
            id: 'BA-T3KL9X',
            status: 'awaiting_payment',
            currency: 'GBP',
            total: 139700,
            scale: 2,
            items: [
              { sku: 'fare_eco_std_return', qty: 1, amount: 130600 },
              { sku: 'seat_23k_extra_legroom', qty: 1, amount: 6400 },
              { sku: 'checked_bag_23kg_ret', qty: 1, amount: 6500 },
              { sku: 'carbon_offset', qty: 1, amount: 1200 },
            ],
            payment: { status: 'unpaid', psp: 'stripe' },
          },
          'Order summary',
        ),
        total_due: money(139700, 'GBP', 2),
        breakdown: table(
          { line: 'string', amount: 'number' },
          [
            ['Base fare (return, 1 adult)', 126100],
            ['Taxes, fees & carrier charges', 4500],
            ['Seat 23K extra legroom', 6400],
            ['Extra checked bag 23kg', 6500],
            ['Carbon offset', 1200],
          ],
          'Price breakdown',
        ),
        price_scale: num(2, { label: 'Minor units per major unit' }),
        rewards: obj(
          {
            avios_earned: num(1800, { label: 'Avios earned' }),
            tier_points: num(40, { label: 'Tier points earned' }),
          },
          'You will earn',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          {
            id: 'sum',
            state_path: 'breakdown',
            layout: 'table',
            columns: [
              { key: 'line', label: 'Item' },
              { key: 'amount', label: 'Amount', format: 'currency', align: 'right' },
            ],
            label: 'Price breakdown',
          },
          { id: 'earn', state_path: 'rewards', layout: 'detail', label: 'You will earn' },
        ],
      },
      actions: {
        pay: action('Pay GBP 1,397.00', 'mutate', 'financial', {
          input: {
            card_number: {
              type: 'string',
              description: 'Card number',
              required: true,
              pattern: '^[0-9]{12,19}$',
            },
            expiry: {
              type: 'string',
              description: 'Expiry (MM/YY)',
              required: true,
              pattern: '^(0[1-9]|1[0-2])/[0-9]{2}$',
            },
            cvv: {
              type: 'string',
              description: 'Security code (CVV)',
              required: true,
              min_length: 3,
              max_length: 4,
            },
            name_on_card: { type: 'string', description: 'Name on card', required: true },
            billing_country: {
              type: 'enum',
              description: 'Billing country',
              options: COUNTRIES,
              option_labels: {
                gb: 'United Kingdom',
                us: 'United States',
                ie: 'Ireland',
                de: 'Germany',
                fr: 'France',
                ae: 'UAE',
                in: 'India',
              },
              default: 'gb',
            },
            billing_postcode: { type: 'string', description: 'Postcode', required: true },
            accept_terms: {
              type: 'boolean',
              description: 'I accept the Conditions of Carriage and fare rules',
              required: true,
            },
          },
          output: { navigates_to: BA(origin, 'confirmation') },
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Confirm payment',
            body_template: 'Charge cardholder {param.name_on_card} for order BA-T3KL9X',
            amount_path: 'total_due',
          },
          policy: {
            secret_params: ['card_number', 'cvv'],
            max_financial: { amount: 139700, currency: 'GBP' },
          },
        }),
        apply_avios: action('Pay part with Avios', 'mutate', 'financial', {
          input: {
            avios_amount: {
              type: 'number',
              description: 'Avios to redeem',
              required: true,
              min: 1250,
              max: 1800,
            },
          },
          output: { state_diff: true, changes: ['/state/order', '/state/breakdown'] },
          idempotent: false,
        }),
      },
      navigation: {
        breadcrumb: [
          { label: 'Passengers', url: BA(origin, 'passengers') },
          { label: 'Payment', url: BA(origin, 'payment') },
        ],
      },
    }),
  );

  /* ---------- 8. confirmation ---------- */
  pages.set(
    'confirmation',
    doc({
      id: 'ba_confirmation',
      origin,
      path: '/app/ba/confirmation',
      title: 'Booking confirmed - T3KL9X',
      version: 'ba-conf-1',
      state: {
        order: order(
          {
            id: 'BA-T3KL9X',
            status: 'paid',
            currency: 'GBP',
            total: 139700,
            scale: 2,
            items: [
              { sku: 'fare_eco_std_return', qty: 1, amount: 130600 },
              { sku: 'seat_23k_extra_legroom', qty: 1, amount: 6400 },
              { sku: 'checked_bag_23kg_ret', qty: 1, amount: 6500 },
              { sku: 'carbon_offset', qty: 1, amount: 1200 },
            ],
            payment: { status: 'succeeded', psp: 'stripe' },
          },
          'Booking',
        ),
        pnr: obj(
          {
            booking_reference: str('T3KL9X', 'Booking reference'),
            status: enumN('confirmed', ['confirmed', 'on_hold', 'cancelled'], undefined, 'Status'),
            issued: str('26 Sep 2026', 'Ticket issued'),
          },
          'Booking reference',
        ),
        e_tickets: arr([str('125-4029917733', 'E-ticket - Adult 1')], 'E-tickets'),
        add_bag_price: money(6500, 'GBP', 2),
        segments: arr(
          [
            obj(
              {
                flight_no: str('BA117'),
                route: str('London Heathrow T5 -> New York JFK T7'),
                depart: datetime('2026-10-12T11:55:00+01:00', 'Depart'),
                arrive: datetime('2026-10-12T14:50:00-04:00', 'Arrive'),
                seat: str('23K', 'Seat'),
                class: str('Economy (World Traveller)'),
                status: enumN('confirmed', ['confirmed', 'waitlisted', 'cancelled']),
              },
              'Outbound',
            ),
            obj(
              {
                flight_no: str('BA182'),
                route: str('New York JFK T7 -> London Heathrow T5'),
                depart: datetime('2026-10-19T21:30:00-04:00', 'Depart'),
                arrive: datetime('2026-10-20T09:15:00+01:00', 'Arrive'),
                seat: str('41A', 'Seat'),
                class: str('Economy (World Traveller)'),
                status: enumN('confirmed', ['confirmed', 'waitlisted', 'cancelled']),
              },
              'Return',
            ),
          ],
          'Flights',
        ),
        checkin: obj(
          {
            opens: datetime('2026-10-11T11:55:00+01:00', 'Online check-in opens'),
            bag_drop: str('T5 Zone B, desks 11-18', 'Bag drop'),
            gate_info: str('Gates announced ~60 min before departure', 'Gates'),
          },
          'Check-in',
        ),
        ticket_pdf: file(
          `${origin}/demo/files/eticket-T3KL9X.pdf`,
          'eticket-T3KL9X.pdf',
          'application/pdf',
          { size: 184320 },
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'conf', state_path: 'pnr', layout: 'detail', label: 'Confirmed' },
          {
            id: 'segments',
            state_path: 'segments',
            layout: 'grid',
            item_key: 'flight_no',
            label: 'Your flights',
          },
          { id: 'checkin', state_path: 'checkin', layout: 'detail', label: 'Check-in' },
        ],
      },
      actions: {
        check_in: action('Check in online (opens 11 Oct)', 'mutate', 'safe', {
          input: {},
          output: { navigates_to: BA(origin, 'confirmation') },
          idempotent: true,
        }),
        manage_booking: navAction('Manage my booking', BA(origin, 'confirmation')),
        add_hold_bag: action('Add a checked bag (GBP 65)', 'mutate', 'financial', {
          input: {},
          output: { state_diff: true, changes: ['/state/order'] },
          idempotent: false,
          requires_confirmation: true,
          confirm: {
            title: 'Add bag',
            body_template: 'Add one 23kg bag for GBP 65',
            amount_path: 'add_bag_price',
          },
        }),
      },
      navigation: {
        breadcrumb: [{ label: 'Confirmation', url: BA(origin, 'confirmation') }],
      },
    }),
  );

  return pages;
}
