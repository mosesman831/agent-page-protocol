/**
 * Multiversal Airways — after-sale pages (manage booking → check-in →
 * boarding pass, flight status, loyalty account).
 * Part of buildMvaPages: see pages.mjs for the assembled Map.
 */

import { str, num, obj, money, file, doc } from '../lib/nodes.mjs';
import { MVA, SEED_BOOKINGS, STATUS_BOARD } from './common.mjs';

const SEED = SEED_BOOKINGS.MV4X8R;

export function buildAftersalePages(origin) {
  const pages = new Map();

  /* ---------- manage booking: lookup ---------- */
  pages.set(
    'manage',
    doc({
      id: 'mva_manage',
      origin,
      path: '/app/mva/manage',
      title: 'Manage booking',
      version: 'mva-mng-1',
      state: {
        help: str(
          'Enter your 6-character reference and last name. Demo booking: MV4X8R / ASHFORD.',
          'Find your booking',
        ),
      },
      present: { layout: 'form', sections: [] },
      actions: {
        find_booking: {
          description: 'Find booking',
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
            surname: { type: 'string', description: 'Last name', required: true, max_length: 40 },
          },
          output: { navigates_to: MVA(origin, 'booking') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Manage', url: MVA(origin, 'manage') },
        ],
      },
    }),
  );

  /* ---------- booking view ---------- */
  pages.set(
    'booking',
    doc({
      id: 'mva_booking',
      origin,
      path: '/app/mva/booking',
      title: `Booking ${SEED.ref} — confirmed`,
      version: 'mva-bkg-1',
      state: {
        booking: obj(
          {
            ref: str(SEED.ref, 'Reference'),
            status: str(SEED.status, 'Status'),
            passenger: str(SEED.pax, 'Passenger'),
            route: str(SEED.route, 'Route'),
            outbound: str(SEED.outbound, 'Outbound'),
            return_leg: str(SEED.return, 'Return'),
            cabin: str(SEED.cabin, 'Cabin'),
            fare: str(SEED.fare, 'Fare'),
            seats: str(`24K (out) · 24A (ret)`, 'Seats'),
            bags: num(SEED.bags, { label: 'Checked bags' }),
            paid: money(SEED.paid, 'GBP'),
          },
          'Booking',
        ),
        options: str('Change seats, add bags, upgrade cabin, or cancel.', 'What you can do'),
      },
      present: {
        layout: 'list',
        sections: [{ id: 'bkg', state_path: 'booking', layout: 'detail', label: 'Details' }],
      },
      actions: {
        change_seat: {
          description: 'Change a seat',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            leg: {
              type: 'enum',
              description: 'Flight',
              options: ['outbound', 'return'],
              required: true,
            },
            seat: {
              type: 'string',
              description: 'New seat (e.g. 26A)',
              required: true,
              pattern: '^[0-9]{2}[A-K]$',
            },
          },
          output: {},
        },
        add_bag: {
          description: 'Add a checked bag (+£38)',
          kind: 'mutate',
          side_effect: 'financial',
          idempotent: true,
          input: {
            bags: {
              type: 'number',
              description: 'Total bags (0–3)',
              required: true,
              min: 0,
              max: 3,
            },
          },
          output: {},
        },
        request_upgrade: {
          description: 'Upgrade to Voyager Plus (£129)',
          kind: 'mutate',
          side_effect: 'financial',
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Confirm upgrade',
            body_template: 'Charge £129.00 to upgrade {param.leg} on booking MV4X8R',
          },
          input: {
            leg: {
              type: 'enum',
              description: 'Flight to upgrade',
              options: ['outbound', 'return'],
              required: true,
            },
          },
          output: {},
        },
        cancel_booking: {
          description: 'Cancel booking',
          kind: 'mutate',
          side_effect: 'destructive',
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Cancel this booking?',
            body_template:
              'Refund £{param.refund_preview ?? "821.00"} to the original card. This cannot be undone.',
          },
          input: {
            reason: {
              type: 'enum',
              description: 'Reason',
              options: ['plans_changed', 'duplicate', 'schedule_change', 'other'],
              required: true,
            },
          },
          output: {},
        },
        go_checkin: {
          description: 'Go to check-in',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'checkin') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Manage', url: MVA(origin, 'manage') },
          { label: SEED.ref, url: MVA(origin, 'booking') },
        ],
      },
    }),
  );

  /* ---------- check-in ---------- */
  pages.set(
    'checkin',
    doc({
      id: 'mva_checkin',
      origin,
      path: '/app/mva/checkin',
      title: 'Online check-in',
      version: 'mva-chk-1',
      state: {
        window: str('Check-in opens 24h before departure and closes 60 min before.', 'Window'),
        flight: obj(
          {
            next: str('MV17 · LHR → JFK · Mon 12 Oct 11:30', 'Next departure'),
            status: str('check_in_open', 'Status'),
          },
          'Your next flight',
        ),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'flt', state_path: 'flight', layout: 'detail', label: 'Next flight' }],
        components: { window: { type: 'banner', state_path: 'window' } },
      },
      actions: {
        check_in: {
          description: 'Check in for MV17',
          kind: 'mutate',
          side_effect: 'identity',
          idempotent: true,
          input: {
            booking_ref: {
              type: 'string',
              description: 'Booking reference',
              required: true,
              pattern: '^[A-Z0-9]{6}$',
            },
            surname: { type: 'string', description: 'Last name', required: true },
            confirm_details: {
              type: 'boolean',
              description: 'My passport and contact details are correct',
              required: true,
            },
            dangerous_goods_ack: {
              type: 'boolean',
              description: 'I am not carrying dangerous goods',
              required: true,
            },
          },
          output: { navigates_to: MVA(origin, 'boarding-pass') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Check-in', url: MVA(origin, 'checkin') },
        ],
      },
    }),
  );

  /* ---------- boarding pass ---------- */
  pages.set(
    'boarding-pass',
    doc({
      id: 'mva_bp',
      origin,
      path: '/app/mva/boarding-pass',
      title: 'Boarding pass — MV17 · Seat 24K',
      version: 'mva-bp-1',
      state: {
        pass: obj(
          {
            passenger: str('ASHFORD/REMY MR', 'Passenger'),
            flight: str('MV17', 'Flight'),
            route: str('LHR → JFK', 'Route'),
            date: str('Mon 12 Oct 2026', 'Date'),
            departs: str('11:30', 'Departs'),
            gate: str('C18 (opens 10:50)', 'Gate'),
            seat: str('24K', 'Seat'),
            zone: str('Zone 3', 'Boarding zone'),
            seq: str('SEQ 0142', 'Sequence'),
          },
          'Boarding pass',
        ),
        documents: obj(
          {
            wallet_pass: file(
              `${origin}/demo/files/mva-boarding-pass.pdf`,
              'Wallet pass (PDF)',
              'application/pdf',
            ),
          },
          'Save',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'bp', state_path: 'pass', layout: 'detail', label: 'Boarding pass' },
          { id: 'docs', state_path: 'documents', layout: 'detail', label: 'Save' },
        ],
      },
      actions: {
        back_to_booking: {
          description: 'Back to booking',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          output: { navigates_to: MVA(origin, 'booking') },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Check-in', url: MVA(origin, 'checkin') },
          { label: 'Boarding pass', url: MVA(origin, 'boarding-pass') },
        ],
      },
    }),
  );

  /* ---------- flight status ---------- */
  pages.set(
    'status',
    doc({
      id: 'mva_status',
      origin,
      path: '/app/mva/status',
      title: 'Flight status',
      version: 'mva-sts-1',
      state: {
        board: STATUS_BOARD,
        looked_up: str('—', 'Last lookup'),
      },
      present: {
        layout: 'list',
        sections: [{ id: 'bd', state_path: 'board', layout: 'table', label: 'Departures' }],
      },
      actions: {
        status_lookup: {
          description: 'Look up a flight',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            flight_no: {
              type: 'string',
              description: 'Flight number (e.g. MV17)',
              required: true,
              pattern: '^MV[0-9]{1,4}$',
            },
            date: { type: 'date', description: 'Date', required: true, default: '2026-10-12' },
          },
          output: {},
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Status', url: MVA(origin, 'status') },
        ],
      },
    }),
  );

  /* ---------- loyalty account ---------- */
  pages.set(
    'account',
    doc({
      id: 'mva_account',
      origin,
      path: '/app/mva/account',
      title: 'Singularity account',
      version: 'mva-acc-1',
      state: {
        member: obj(
          {
            name: str('Guest', 'Member'),
            tier: str('—', 'Tier'),
            points: num(0, { label: 'Points balance' }),
          },
          'Account',
        ),
        hint: str('Sign in to see your tier, points and trips.', 'Hint'),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'mbr', state_path: 'member', layout: 'detail', label: 'Member' }],
      },
      actions: {
        sign_in: {
          description: 'Sign in (demo user)',
          kind: 'mutate',
          side_effect: 'identity',
          idempotent: true,
          input: {
            user: {
              type: 'enum',
              description: 'Account',
              options: ['remy', 'jane'],
              option_labels: { remy: 'Remy Ashford (Gold)', jane: 'Jane Doe (Platinum)' },
              required: true,
            },
          },
          output: {},
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Home', url: MVA(origin, 'home') },
          { label: 'Account', url: MVA(origin, 'account') },
        ],
      },
    }),
  );

  return pages;
}
