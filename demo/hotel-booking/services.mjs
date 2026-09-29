/**
 * Halvern House — service pages: Halvern Circle loyalty, guest reviews and
 * help/FAQ. Part of buildHotelPages: see pages.mjs for the Map.
 */

import { str, num, obj, arr, table, markdown, action, navAction, doc } from '../lib/nodes.mjs';
import { HB, crumbs, HOUSES } from './common.mjs';

const REVIEWS = [
  {
    id: 'rev-01',
    author: 'Fiona M.',
    house: 'The Observatory',
    score: 10,
    date: '2026-09-02',
    title: 'Faultless service — best bed in Scotland',
    helpful: 214,
  },
  {
    id: 'rev-02',
    author: 'Daniel R.',
    house: 'The Observatory',
    score: 9,
    date: '2026-08-21',
    title: 'Stunning building; thermal suite busy at dusk',
    helpful: 96,
  },
  {
    id: 'rev-03',
    author: 'Priya S.',
    house: 'The Crescent Spa',
    score: 9,
    date: '2026-08-05',
    title: 'The pools alone are worth the train to Bath',
    helpful: 141,
  },
  {
    id: 'rev-04',
    author: 'Tom W.',
    house: 'Tarn Hows Lodge',
    score: 8,
    date: '2026-07-30',
    title: 'Boot room and dog towels — the Lakes done properly',
    helpful: 77,
  },
  {
    id: 'rev-05',
    author: 'Aiko T.',
    house: 'Maison Lumière',
    score: 10,
    date: '2026-07-12',
    title: 'Breakfast in the courtyard was the highlight of Paris',
    helpful: 188,
  },
];

export function buildServicePages(origin) {
  const pages = new Map();

  /* ---------- Halvern Circle (loyalty) ---------- */
  pages.set(
    'loyalty',
    doc({
      id: 'hb_loyalty',
      origin,
      path: '/app/hotel/loyalty',
      title: 'Halvern Circle — the loyalty programme',
      version: 'hb-loyal-1',
      state: {
        tiers: table(
          { tier: 'enum', stays_year: 'string', perks: 'string' },
          [
            ['key', 'Free to join', 'Member rates (−10%), free Wi-Fi, welcome dram'],
            [
              'silver_key',
              '4+ stays / year',
              'Early check-in, 10% off dining, upgrade when available',
            ],
            [
              'gold_key',
              '10+ stays / year',
              'Guaranteed upgrade, afternoon tea for two, 2pm checkout',
            ],
            [
              'master_key',
              '20+ stays / year',
              'Suite upgrade, spa access, dedicated concierge, transfers',
            ],
          ],
          'Halvern Circle tiers',
        ),
        how: markdown(
          [
            '**How it works**',
            '- Collect a **key** for every night — 10 keys become a free night',
            '- Member rates appear automatically once you join',
            '- Keys never expire while you stay once in 24 months',
            '- Works at every house in the collection, on dining and on spa',
          ].join('\n'),
          'How keys work',
        ),
        member: obj(
          {
            status: str('Not yet a member', 'Status'),
            member_no: str('—', 'Member number'),
            keys: num(0, { label: 'Keys collected' }),
          },
          'Your membership',
        ),
        join_status: str('Join free — it takes a minute.', 'Join'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'tiers', state_path: 'tiers', layout: 'table', label: 'The four keys' },
          { id: 'how', state_path: 'how', layout: 'detail', label: 'How it works' },
          { id: 'member', state_path: 'member', layout: 'card', label: 'Your membership' },
          { id: 'join', state_path: 'join_status', layout: 'detail', label: 'Join' },
        ],
      },
      actions: {
        join_circle: action('Join Halvern Circle — free', 'mutate', 'safe', {
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
            home_house: {
              type: 'enum',
              description: 'Favourite house',
              options: HOUSES.map((h) => h.id),
              option_labels: Object.fromEntries(HOUSES.map((h) => [h.id, `${h.name}, ${h.city}`])),
              default: 'observatory',
            },
            marketing: { type: 'boolean', description: 'Email me offers (optional)' },
          },
          output: {},
          idempotent: true,
        }),
        already_member: navAction('Manage booking with your member rate', HB(origin, 'manage')),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Halvern Circle', slug: 'loyalty' }]),
      },
    }),
  );

  /* ---------- guest reviews ---------- */
  pages.set(
    'reviews',
    doc({
      id: 'hb_reviews',
      origin,
      path: '/app/hotel/reviews',
      title: 'Guest reviews',
      version: 'hb-rev-1',
      state: {
        summary: obj(
          {
            overall: num(9.4, { label: 'Overall', max: 10 }),
            count: num(18412, { label: 'Verified reviews' }),
            recommended: str('96%', 'Would recommend'),
          },
          'Across the collection',
        ),
        breakdown: table(
          { category: 'string', score: 'number' },
          [
            ['Service', 9.6],
            ['Rooms', 9.3],
            ['Dining', 9.4],
            ['Location', 9.5],
            ['Value', 8.9],
          ],
          'By category',
        ),
        reviews: arr(
          REVIEWS.map((r) =>
            obj(
              {
                id: str(r.id, 'Ref'),
                title: str(r.title, 'Review'),
                author: str(`${r.author} — ${r.house}`, 'Guest'),
                score: str(`${r.score}/10`, 'Score'),
                date: str(r.date, 'Stayed'),
                helpful: num(r.helpful, { label: 'Helpful votes' }),
              },
              r.title,
            ),
          ),
          'Latest reviews',
        ),
        review_status: str('Stayed with us? Tell the world.', 'Your review'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'sum', state_path: 'summary', layout: 'dashboard', label: 'Across the collection' },
          {
            id: 'cat',
            state_path: 'breakdown',
            layout: 'table',
            columns: [
              { key: 'category', label: 'Category' },
              { key: 'score', label: 'Score', format: 'number', align: 'right' },
            ],
            label: 'By category',
          },
          { id: 'list', state_path: 'reviews', layout: 'grid', label: 'Latest reviews' },
          { id: 'rstat', state_path: 'review_status', layout: 'detail', label: 'Your review' },
        ],
      },
      actions: {
        vote_helpful: action('Vote a review helpful', 'mutate', 'safe', {
          input: {
            review_id: {
              type: 'enum',
              description: 'Review',
              required: true,
              options: REVIEWS.map((r) => r.id),
              option_labels: Object.fromEntries(
                REVIEWS.map((r) => [r.id, `${r.author}: “${r.title.slice(0, 40)}…”`]),
              ),
              default: 'rev-01',
            },
          },
          output: {},
          idempotent: true,
        }),
        write_review: action('Write a review', 'mutate', 'safe', {
          input: {
            house: {
              type: 'enum',
              description: 'House',
              required: true,
              options: HOUSES.map((h) => h.id),
              option_labels: Object.fromEntries(HOUSES.map((h) => [h.id, h.name])),
              default: 'observatory',
            },
            score: {
              type: 'enum',
              description: 'Score (10 = exceptional)',
              required: true,
              options: ['10', '9', '8', '7', '6', '5'],
              option_labels: {
                10: '10 — exceptional',
                9: '9 — wonderful',
                8: '8 — excellent',
                7: '7 — good',
                6: '6 — fair',
                5: '5 — disappointing',
              },
              default: '10',
            },
            title: { type: 'string', description: 'Headline', required: true, max_length: 80 },
            body: { type: 'string', description: 'Your review', required: true, max_length: 1000 },
            stayed: { type: 'date', description: 'When did you stay?', required: true },
          },
          output: {},
          idempotent: true,
        }),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Guest reviews', slug: 'reviews' }]),
      },
    }),
  );

  /* ---------- help & FAQ ---------- */
  pages.set(
    'help',
    doc({
      id: 'hb_help',
      origin,
      path: '/app/hotel/help',
      title: 'Help & contact',
      version: 'hb-help-1',
      state: {
        faq: markdown(
          [
            '**Booking & cancellation**',
            '- Most rates cancel free until 48h before arrival — your confirmation email has the exact time',
            '- The six-letter reference is on your confirmation and voucher (e.g. HVN4X8)',
            '- Non-refundable rates can usually move dates once, free, with 72h notice',
            '',
            '**During your stay**',
            '- Check-in from 15:00, checkout until 12:00 (2pm for Gold Key and above)',
            '- Dogs stay for £30/night at every house — bed, bowls and a treat on arrival',
            '- Spa access is included for suite guests; book treatments ahead in season',
            '',
            '**Payment**',
            '- We take all major cards, Apple Pay and Halvern House gift cards',
            '- Pay-at-property rates still hold your card as a guarantee',
          ].join('\n'),
          'Frequently asked',
        ),
        contact: obj(
          {
            reservations: str('0800 048 4242 (free, 24/7)', 'Reservations'),
            email: str('stays@halvernhouse.example', 'Email'),
            accessibility: str('access@halvernhouse.example', 'Accessibility desk'),
            post: str('Halvern House, 1 Princes Street, Edinburgh EH2 2EQ', 'Write to us'),
          },
          'Talk to a person',
        ),
        contact_status: str('We reply within a day — usually faster.', 'Message us'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'faq', state_path: 'faq', layout: 'detail', label: 'Frequently asked' },
          { id: 'contact', state_path: 'contact', layout: 'detail', label: 'Talk to a person' },
          { id: 'cstat', state_path: 'contact_status', layout: 'detail', label: 'Message us' },
        ],
      },
      actions: {
        contact_us: action('Send us a message', 'mutate', 'safe', {
          input: {
            topic: {
              type: 'enum',
              description: 'Topic',
              options: ['booking', 'billing', 'feedback', 'accessibility', 'press', 'other'],
              option_labels: {
                booking: 'A booking',
                billing: 'Billing',
                feedback: 'Feedback on a stay',
                accessibility: 'Accessibility',
                press: 'Press & media',
                other: 'Something else',
              },
              default: 'booking',
            },
            booking_ref: {
              type: 'string',
              description: 'Booking reference (optional)',
              min_length: 6,
              max_length: 6,
              pattern: '^[A-Z0-9]{6}$',
            },
            email: {
              type: 'string',
              description: 'Your email',
              required: true,
              pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',
            },
            message: { type: 'string', description: 'Message', required: true, max_length: 800 },
          },
          output: {},
          idempotent: true,
        }),
      },
      navigation: {
        ...crumbs(origin, [{ label: 'Help & contact', slug: 'help' }]),
      },
    }),
  );

  return pages;
}
