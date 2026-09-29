/**
 * Multiversal Airways — payment & confirmation pages.
 * Part of buildMvaPages: see pages.mjs for the assembled Map.
 */

import { str, num, obj, money, file, doc } from '../lib/nodes.mjs';
import { MVA, COUNTRIES } from './common.mjs';

export function buildPayPages(origin) {
  const pages = new Map();

  /* ---------- payment ---------- */
  pages.set(
    'payment',
    doc({
      id: 'mva_payment',
      origin,
      path: '/app/mva/payment',
      title: 'Pay — £912.99',
      version: 'mva-pay-1',
      state: {
        total_due: money(91299, 'GBP'),
        order: obj(
          {
            route: str('LHR ⇄ JFK', 'Route'),
            flights: str('MV17 · MV18', 'Flights'),
            passenger: str('Mr Remy Ashford', 'Lead passenger'),
            status: str('awaiting_payment', 'Status'),
          },
          'Order',
        ),
        hold: str('Your fare is held for 15:00 while you pay.', 'Fare hold'),
        payment: obj({ status: str('unpaid'), psp: str('stripe (sandbox)') }, 'Payment'),
        rewards: obj(
          {
            points_earned: num(1240, { label: 'Singularity points on this trip' }),
            tier_progress: str('64% to Platinum', 'Tier progress'),
          },
          'You will earn',
        ),
      },
      present: {
        layout: 'form',
        sections: [
          { id: 'ord', state_path: 'order', layout: 'detail', label: 'Order' },
          { id: 'earn', state_path: 'rewards', layout: 'detail', label: 'Rewards' },
        ],
        components: { hold: { type: 'banner', state_path: 'hold' } },
      },
      actions: {
        pay: {
          description: 'Pay £912.99',
          kind: 'mutate',
          side_effect: 'financial',
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Confirm payment',
            body_template: 'Charge {param.name_on_card} £912.99 for booking MV-T4X8',
            amount_path: 'total_due',
          },
          policy: {
            secret_params: ['card_number', 'cvv'],
            max_financial: { amount: 91299, currency: 'GBP' },
          },
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
              description: 'CVV',
              required: true,
              min_length: 3,
              max_length: 4,
            },
            name_on_card: { type: 'string', description: 'Name on card', required: true },
            billing_country: {
              type: 'enum',
              description: 'Billing country',
              options: COUNTRIES,
              default: 'gb',
              required: true,
            },
            billing_postcode: { type: 'string', description: 'Postcode', required: true },
            accept_terms: {
              type: 'boolean',
              description: 'I accept the Conditions of Carriage',
              required: true,
            },
          },
          output: { navigates_to: MVA(origin, 'confirmation') },
        },
        apply_points: {
          description: 'Pay part with Singularity points',
          kind: 'mutate',
          side_effect: 'financial',
          idempotent: true,
          input: {
            points_amount: {
              type: 'number',
              description: 'Points to redeem (1,000 = £10)',
              required: true,
              min: 1000,
              max: 50000,
            },
          },
          output: {},
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Review', url: MVA(origin, 'review') },
          { label: 'Payment', url: MVA(origin, 'payment') },
        ],
      },
    }),
  );

  /* ---------- confirmation ---------- */
  pages.set(
    'confirmation',
    doc({
      id: 'mva_confirmation',
      origin,
      path: '/app/mva/confirmation',
      title: 'Booking confirmed — MV8T2Q',
      version: 'mva-conf-1',
      state: {
        booking: obj(
          {
            ref: str('MV8T2Q', 'Booking reference'),
            status: str('confirmed', 'Status'),
            passenger: str('Mr Remy Ashford', 'Lead passenger'),
            route: str('LHR ⇄ JFK', 'Route'),
            outbound: str('MV17 · Mon 12 Oct 11:30 → 14:20', 'Outbound'),
            return_leg: str('MV18 · Mon 19 Oct 21:30 → 09:15+1', 'Return'),
            seats: str('24K (out) · 24A (ret)', 'Seats'),
            paid: money(91299, 'GBP'),
          },
          'Booking',
        ),
        documents: obj(
          {
            eticket: file(
              `${origin}/demo/files/mva-eticket.pdf`,
              'E-ticket receipt (PDF)',
              'application/pdf',
            ),
            itinerary_ics: file(
              `${origin}/demo/files/mva-itinerary.ics`,
              'Add to calendar (.ics)',
              'text/calendar',
            ),
          },
          'Documents',
        ),
        next_steps: str('Check-in opens 24h before departure — we will email you.', 'Next'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'bkg', state_path: 'booking', layout: 'detail', label: 'Confirmed' },
          { id: 'docs', state_path: 'documents', layout: 'detail', label: 'Documents' },
        ],
      },
      actions: {
        manage_booking: {
          description: 'Manage this booking',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'booking') },
        },
        check_in_now: {
          description: 'Go to check-in',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'checkin') },
        },
        book_another: {
          description: 'Book another flight',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'home') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Confirmed', url: MVA(origin, 'confirmation') },
        ],
      },
    }),
  );

  return pages;
}
