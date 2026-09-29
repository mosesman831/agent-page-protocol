/**
 * Halvern House — landing page + post-booking pages (manage lookup →
 * booking detail). Part of buildHotelPages: see pages.mjs for the Map.
 */

import {
  str,
  num,
  money,
  obj,
  arr,
  geopoint,
  media,
  markdown,
  action,
  navAction,
  doc,
} from '../lib/nodes.mjs';
import { HB, HOTEL_ASSETS, crumbs, HOUSES } from './common.mjs';
import { searchInput } from './flow.mjs';

export function buildHomePages(origin) {
  const pages = new Map();

  /* ---------- home ---------- */
  pages.set(
    'home',
    doc({
      id: 'hb_home',
      origin,
      path: '/app/hotel/home',
      title: 'Halvern House — boutique hotels & hideaways',
      version: 'hb-home-1',
      state: {
        notice: str(
          'Autumn in the city: two nights, dinner on the first evening and a lazy breakfast — from £219pp.',
          'Seasonal offer',
        ),
        collection: media(
          HOUSES.map((h) => ({
            url: `${HOTEL_ASSETS}/${h.img}`,
            alt: `${h.name} — ${h.city}`,
          })),
          'The collection',
        ),
        why: markdown(
          [
            '**Why book direct with Halvern House**',
            '- Best rate promise — find it cheaper and we refund the difference',
            '- Halvern Circle members save 10% and collect keys towards free nights',
            '- Flexible cancellation on most rates until 48h before arrival',
            '- Every house is inspected twice a year by our own tasters',
          ].join('\n'),
          'Why Halvern',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'col', state_path: 'collection', layout: 'detail', label: 'The collection' },
          { id: 'why', state_path: 'why', layout: 'detail', label: 'Why book direct' },
        ],
        components: { notice: { type: 'banner', state_path: 'notice' } },
      },
      actions: {
        search_hotels: {
          description: 'Check availability',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: searchInput,
          output: { navigates_to: HB(origin, 'results') },
        },
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Home', slug: 'home' }]),
        related: [
          { label: 'Offers', url: HB(origin, 'deals'), rel: 'related' },
          { label: 'Dining & spa', url: HB(origin, 'dining'), rel: 'related' },
          { label: 'Halvern Circle', url: HB(origin, 'loyalty'), rel: 'related' },
          { label: 'Manage booking', url: HB(origin, 'manage'), rel: 'related' },
        ],
      },
    }),
  );

  /* ---------- manage booking (lookup) ---------- */
  pages.set(
    'manage',
    doc({
      id: 'hb_manage',
      origin,
      path: '/app/hotel/manage',
      title: 'Manage booking',
      version: 'hb-manage-1',
      state: {
        notice: str(
          'Find your booking to change dates, add breakfast, upgrade your room or cancel.',
          'What you can do',
        ),
        hint: obj(
          {
            where: str(
              'Your six-letter reference is on the confirmation email and voucher.',
              'Where is my reference?',
            ),
            demo: str('Demo booking: HVN4X8 · surname “ashford” (also HVN9T2 · “doe”).', 'Try it'),
          },
          'Hints',
        ),
      },
      present: {
        layout: 'form',
        sections: [{ id: 'hint', state_path: 'hint', layout: 'detail', label: 'Hints' }],
        components: { notice: { type: 'banner', state_path: 'notice' } },
      },
      actions: {
        find_booking: action('Find my booking', 'mutate', 'safe', {
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
              description: 'Lead guest last name',
              required: true,
              max_length: 40,
            },
          },
          output: { navigates_to: HB(origin, 'booking') },
          idempotent: true,
        }),
        new_search: navAction('Start a new search', HB(origin, 'search')),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Manage booking', slug: 'manage' }]),
      },
    }),
  );

  /* ---------- booking detail (post-lookup) ---------- */
  pages.set(
    'booking',
    doc({
      id: 'hb_booking',
      origin,
      path: '/app/hotel/booking',
      title: 'Booking HVN4X8 — The Observatory',
      version: 'hb-booking-1',
      state: {
        booking: obj(
          {
            ref: str('HVN4X8', 'Reference'),
            status: str('confirmed', 'Status'),
            house: str('The Observatory — Halvern House, Edinburgh', 'House'),
            room: str('Deluxe King — breakfast included', 'Room'),
            guests: str('Remy Ashford + 1', 'Guests'),
            checkin: str('Fri 6 Nov 2026 · from 15:00', 'Check-in'),
            checkout: str('Mon 9 Nov 2026 · until 12:00', 'Check-out'),
            extras: str('—', 'Extras'),
            paid: money(100500, 'GBP', 2),
          },
          'Reservation HVN4X8',
        ),
        arrival: obj(
          {
            parking: str('Valet parking at the door — £38/day', 'Parking'),
            station: str('Waverley station is a 4-minute walk', 'Arriving by train'),
            early: str(
              'Early check-in from 12:00 for Circle members, subject to availability',
              'Early check-in',
            ),
          },
          'Getting there',
        ),
        location: geopoint(55.9531, -3.1899, 'The Observatory'),
        dining_credit: num(2500, {
          label: 'Forth Table credit included',
          unit: 'GBP',
          scale: 2,
        }),
        messages: arr(
          [
            obj(
              {
                from: str('Concierge', 'From'),
                topic: str('arrival', 'Topic'),
                text: str(
                  'Welcome back, Mr Man — shall we reserve the window table at The Forth Table on Saturday?',
                  'Message',
                ),
                reply: str('', 'Reply'),
              },
              'Concierge — 1 Sep',
            ),
          ],
          'Concierge messages',
        ),
      },
      present: {
        layout: 'detail',
        sections: [
          { id: 'bk', state_path: 'booking', layout: 'detail', label: 'Your booking' },
          { id: 'arr', state_path: 'arrival', layout: 'detail', label: 'Getting there' },
          { id: 'msgs', state_path: 'messages', layout: 'grid', label: 'Concierge' },
        ],
        components: {
          credit: { type: 'price', state_path: 'dining_credit', label: 'Forth Table credit' },
        },
      },
      actions: {
        add_breakfast: action('Add breakfast for all nights', 'mutate', 'financial', {
          input: {
            guests: {
              type: 'number',
              description: 'Guests having breakfast',
              min: 1,
              max: 4,
              default: 2,
            },
          },
          output: {},
          idempotent: true,
        }),
        request_upgrade: action('Request a room upgrade', 'mutate', 'safe', {
          input: {
            to: {
              type: 'enum',
              description: 'Upgrade to',
              options: ['junior_suite', 'observatory_suite'],
              option_labels: {
                junior_suite: 'Junior Suite (Castle view) +£68/night',
                observatory_suite: 'The Observatory Suite +£195/night',
              },
              default: 'junior_suite',
            },
          },
          output: {},
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Request upgrade',
            body_template: 'Upgrade booking HVN4X8 to {param.to} — subject to availability',
          },
        }),
        contact_house: action('Message the house', 'mutate', 'safe', {
          input: {
            topic: {
              type: 'enum',
              description: 'Topic',
              options: ['arrival', 'dietary', 'occasion', 'accessibility', 'other'],
              option_labels: {
                arrival: 'Arrival time & transfers',
                dietary: 'Dietary requirements',
                occasion: 'A special occasion',
                accessibility: 'Accessibility needs',
                other: 'Something else',
              },
              default: 'arrival',
            },
            message: { type: 'string', description: 'Message', required: true, max_length: 500 },
          },
          output: {},
          idempotent: true,
        }),
        cancel_booking: action('Cancel this booking', 'mutate', 'destructive', {
          input: {},
          output: {},
          idempotent: true,
          requires_confirmation: true,
          confirm: {
            title: 'Cancel booking',
            body_template: 'Cancel reservation HVN4X8 — free until 18:00 on 4 Nov 2026',
          },
        }),
        back_manage: navAction('Look up another booking', HB(origin, 'manage')),
      },
      navigation: {
        ...crumbs(origin, [
          { label: 'Manage booking', slug: 'manage' },
          { label: 'HVN4X8', slug: 'booking' },
        ]),
      },
    }),
  );

  return pages;
}
