/**
 * Multiversal Airways — service & support pages: assistance, disruption,
 * loyalty, lounges, partners, help, travel extras, group bookings.
 */

import { str, money, obj, arr, media, markdown, table, doc } from '../lib/nodes.mjs';
import { MVA, MVA_ASSETS, TITLES } from './common.mjs';

const crumbs = (o, label, slug) => ({
  breadcrumb: [
    { label: 'Multiversal Airways', url: MVA(o, 'home') },
    { label, url: MVA(o, slug) },
  ],
});

export function buildServicePages(origin) {
  const pages = new Map();

  /* ---------- special assistance ---------- */
  pages.set(
    'assistance',
    doc({
      id: 'mva_assistance',
      origin,
      path: '/app/mva/assistance',
      title: 'Special assistance',
      version: 'mva-assistance-1',
      state: {
        services: arr(
          [
            obj(
              {
                service: str('Mobility & wheelchairs'),
                detail: str(
                  'WCHR/WCHS/WCHC handling at every airport we serve — tell us 48h ahead and we have the chair waiting.',
                ),
                icon: str('♿'),
              },
              'Mobility',
            ),
            obj(
              {
                service: str('Travelling with children'),
                detail: str(
                  'Unaccompanied minors from age 5, bassinets on all wide-bodies, kids eat first.',
                ),
                icon: str('🧸'),
              },
              'Children',
            ),
            obj(
              {
                service: str('Medical & medication'),
                detail: str(
                  'Cool storage for medication, oxygen with advance notice, medical clearance forms in-app.',
                ),
                icon: str('➕'),
              },
              'Medical',
            ),
            obj(
              {
                service: str('Pets & assistance animals'),
                detail: str(
                  'Trained assistance dogs fly free in the cabin; pets travel pressurised and warm in the hold.',
                ),
                icon: str('🐕'),
              },
              'Animals',
            ),
            obj(
              {
                service: str('Sensory & hidden disabilities'),
                detail: str(
                  'Sunflower lanyards recognised, quiet rooms at LHR T3, cabin briefings on request.',
                ),
                icon: str('🌻'),
              },
              'Sensory',
            ),
          ],
          'How we help',
        ),
        request_logged: str('No assistance requests yet on this booking.', 'Status'),
        promise: markdown(
          '**Our promise:** assistance requests made 48+ hours before departure are confirmed in writing within 24h. Free of charge, always.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'services', state_path: 'services', layout: 'grid', label: 'How we help' },
          { id: 'status', state_path: 'request_logged', layout: 'detail', label: 'Status' },
          { id: 'promise', state_path: 'promise', layout: 'detail', label: 'Our promise' },
        ],
      },
      actions: {
        request_assistance: {
          description: 'Request assistance',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          input: {
            booking_ref: {
              type: 'string',
              description: 'Booking reference',
              pattern: '^[A-Z0-9]{6}$',
              max_length: 6,
            },
            type: {
              type: 'enum',
              description: 'Type',
              required: true,
              options: ['mobility', 'unaccompanied_minor', 'medical', 'animal', 'sensory'],
              option_labels: {
                mobility: 'Mobility & wheelchairs',
                unaccompanied_minor: 'Unaccompanied minor',
                medical: 'Medical',
                animal: 'Assistance animal / pet',
                sensory: 'Sensory & hidden disabilities',
              },
            },
            details: { type: 'string', description: 'Anything we should know', max_length: 500 },
          },
        },
      },
      navigation: crumbs(origin, 'Special assistance', 'assistance'),
    }),
  );

  /* ---------- delays & disruption ---------- */
  pages.set(
    'disruption',
    doc({
      id: 'mva_disruption',
      origin,
      path: '/app/mva/disruption',
      title: 'Delays, cancellations & refunds',
      version: 'mva-disruption-1',
      state: {
        rights: table(
          {
            journey: 'string',
            delay: 'string',
            compensation: 'number',
          },
          [
            ['Any route', '3h+ arrival delay (our fault)', 22000],
            ['Any route', 'Cancellation <14 days notice', 35000],
            ['Long-haul 3,500km+', '4h+ arrival delay', 52000],
            ['Denied boarding', 'Any', 52000],
          ],
          'Compensation rules',
        ),
        rules: markdown(
          [
            '**If your flight is disrupted we will:**',
            '- Rebook you on the next Multiversal or partner flight, free',
            '- Hotel + meals for overnight delays',
            '- Full refund within 7 days if you choose not to travel',
            '- Weather/airport disruption: care still applies, compensation does not',
          ].join('\n'),
          'What to expect',
        ),
        claim_status: str('No active claims.', 'Your claims'),
      },
      present: {
        layout: 'list',
        sections: [
          {
            id: 'rights',
            state_path: 'rights',
            layout: 'table',
            label: 'Your rights',
            columns: [
              { key: 'journey', label: 'Situation' },
              { key: 'delay', label: 'Trigger' },
              { key: 'compensation', label: 'Compensation', format: 'currency', align: 'right' },
            ],
          },
          { id: 'rules', state_path: 'rules', layout: 'detail', label: 'What to expect' },
          { id: 'claims', state_path: 'claim_status', layout: 'detail', label: 'Your claims' },
        ],
      },
      actions: {
        claim_refund: {
          description: 'Request refund or compensation',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          input: {
            booking_ref: {
              type: 'string',
              description: 'Booking reference',
              required: true,
              pattern: '^[A-Z0-9]{6}$',
              max_length: 6,
            },
            surname: { type: 'string', description: 'Last name', required: true, max_length: 40 },
            claim_type: {
              type: 'enum',
              description: 'Request',
              required: true,
              options: ['refund', 'compensation'],
              option_labels: {
                refund: 'Refund to original payment',
                compensation: 'Delay/cancellation compensation',
              },
            },
            flight_no: { type: 'string', description: 'Flight number (e.g. MV11)', max_length: 6 },
          },
        },
      },
      navigation: crumbs(origin, 'Disruption', 'disruption'),
    }),
  );

  /* ---------- loyalty ---------- */
  pages.set(
    'loyalty',
    doc({
      id: 'mva_loyalty',
      origin,
      path: '/app/mva/loyalty',
      title: 'Singularity Rewards',
      version: 'mva-loyalty-1',
      state: {
        tiers: table(
          {
            tier: 'string',
            points: 'string',
            bags: 'string',
            seats: 'string',
            lounge: 'string',
            upgrades: 'string',
          },
          [
            ['Blue', 'Free to join', 'Standard', 'From £21', '—', '—'],
            ['Silver', '25,000 pts / yr', '+1 bag', 'Free standard', '—', 'Last-3-days priority'],
            [
              'Gold',
              '60,000 pts / yr',
              '+1 bag',
              'Free any',
              'Nebula Lounge',
              '7-day upgrade window',
            ],
            [
              'Platinum',
              '120,000 pts / yr',
              '+2 bags',
              'Free any + companions',
              'Singularity Spa',
              'Guaranteed space, 30 days',
            ],
          ],
          'Tiers & benefits',
        ),
        earning: markdown(
          [
            '**Earn everywhere:**',
            '- 6 pts per £1 flying Multiversal',
            '- 3 pts per £1 with hotels, cars and retail partners',
            '- Points never expire while you fly once a year',
            '- Family pooling: combine points across 6 accounts',
          ].join('\n'),
          'Earning points',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'tiers', state_path: 'tiers', layout: 'table', label: 'Tiers' },
          { id: 'earn', state_path: 'earning', layout: 'detail', label: 'Earning' },
        ],
      },
      actions: {
        join_singularity: {
          description: 'Join Singularity Rewards — free',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: false,
          input: {
            title: { type: 'enum', description: 'Title', options: TITLES },
            first_name: {
              type: 'string',
              description: 'First name',
              required: true,
              max_length: 40,
            },
            last_name: { type: 'string', description: 'Last name', required: true, max_length: 40 },
            email: { type: 'string', description: 'Email', required: true, max_length: 80 },
            dob: { type: 'date', description: 'Date of birth' },
          },
          output: { navigates_to: MVA(origin, 'account') },
        },
        sign_in: {
          description: 'Sign in',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            user: {
              type: 'enum',
              description: 'Demo account',
              options: ['remy', 'jane'],
              option_labels: { remy: 'Remy Ashford', jane: 'Jane Doe' },
            },
          },
        },
      },
      navigation: crumbs(origin, 'Singularity Rewards', 'loyalty'),
    }),
  );

  /* ---------- lounges ---------- */
  pages.set(
    'lounges',
    doc({
      id: 'mva_lounges',
      origin,
      path: '/app/mva/lounges',
      title: 'Lounges',
      version: 'mva-lounges-1',
      state: {
        lounges: arr(
          [
            obj(
              {
                name: str('Singularity Spa — LHR T3'),
                image: media([{ url: `${MVA_ASSETS}/mva-lounge.jpg`, alt: 'Singularity Spa' }]),
                access: str('Singularity cabin · Platinum members'),
                hours: str('05:00 – 23:00'),
                highlights: arr(
                  ['Cinema room', 'À la carte dining', 'Sleep pods', 'Showers'].map((s) => str(s)),
                  'Highlights',
                ),
              },
              'Singularity Spa',
            ),
            obj(
              {
                name: str('Nebula Lounge — LHR T3'),
                image: media([{ url: `${MVA_ASSETS}/mva-hero.jpg`, alt: 'Nebula Lounge' }]),
                access: str('Nebula cabin · Gold members · day pass £45'),
                hours: str('05:00 – 23:00'),
                highlights: arr(
                  ['Buffet + bar', 'Quiet zone', 'Family room', 'Fast-track exit to gate'].map(
                    (s) => str(s),
                  ),
                  'Highlights',
                ),
              },
              'Nebula Lounge',
            ),
            obj(
              {
                name: str('Orbit Room — JFK T7'),
                image: media([{ url: `${MVA_ASSETS}/mva-nyc.jpg`, alt: 'Orbit Room JFK' }]),
                access: str('Nebula cabin · Gold+ · partners'),
                hours: str('06:00 – 22:00'),
                highlights: arr(
                  ['Skyline terrace', 'Full bar', 'Work pods'].map((s) => str(s)),
                  'Highlights',
                ),
              },
              'Orbit Room',
            ),
            obj(
              {
                name: str('Portal Lounge — DXB T3'),
                image: media([{ url: `${MVA_ASSETS}/mva-dubai.jpg`, alt: 'Portal Lounge Dubai' }]),
                access: str('All premium cabins · members'),
                hours: str('24 hours'),
                highlights: arr(
                  ['Shower suites', 'Sleep zones', 'Prayer room'].map((s) => str(s)),
                  'Highlights',
                ),
              },
              'Portal Lounge',
            ),
          ],
          'Our lounges',
        ),
        rules: markdown(
          '**Access rules:** Nebula ticket holders use Nebula Lounge; Singularity ticket holders use the Singularity Spa. Gold/Platinum members bring one guest free. Day passes from £45 when space allows.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'lounges', state_path: 'lounges', layout: 'grid', label: 'Lounges' },
          { id: 'rules', state_path: 'rules', layout: 'detail', label: 'Access rules' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Lounges', 'lounges'),
    }),
  );

  /* ---------- partners ---------- */
  pages.set(
    'partners',
    doc({
      id: 'mva_partners',
      origin,
      path: '/app/mva/partners',
      title: 'Partner airlines & earning',
      version: 'mva-partners-1',
      state: {
        airlines: table(
          { airline: 'string', region: 'string', points: 'string', lounge: 'string' },
          [
            ['Nordica Air', 'Nordics', 'Full earn + burn', 'Yes'],
            ['Pacific Meridian', 'Asia-Pacific', 'Full earn + burn', 'Yes'],
            ['Continental South', 'Americas', 'Earn only', 'No'],
            ['Meridian Gulf', 'Middle East', 'Full earn + burn', 'Yes'],
          ],
          'Constellation Alliance partners',
        ),
        retail: table(
          { partner: 'string', category: 'string', earn_rate: 'string' },
          [
            ['StayHotels', 'Hotels', '3 pts / £1'],
            ['DriveNow', 'Car hire', '3 pts / £1 + 500 bonus'],
            ['Nebula Duty Free', 'Shopping', '2 pts / £1'],
            ['FuelEV', 'Charging', '1 pt / £1'],
          ],
          'Earn on the ground',
        ),
        note: markdown(
          'Points post within 7 days of travel or purchase. Retro-claims accepted up to 6 months.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'air', state_path: 'airlines', layout: 'table', label: 'Airline partners' },
          { id: 'retail', state_path: 'retail', layout: 'table', label: 'Earn on the ground' },
          { id: 'note', state_path: 'note', layout: 'detail', label: 'Good to know' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Partners', 'partners'),
    }),
  );

  /* ---------- help centre ---------- */
  pages.set(
    'help',
    doc({
      id: 'mva_help',
      origin,
      path: '/app/mva/help',
      title: 'Help centre',
      version: 'mva-help-1',
      state: {
        faq: markdown(
          [
            '**When does online check-in open?** 24 hours before departure, closing 1 hour before.',
            '**Can I change my flight?** Flex fares change free; Classic £60; Saver is locked.',
            '**How do I add a bag?** Manage booking or pay at the airport — online is cheaper.',
            '**Refund timescales?** 7 days to original payment; compensation claims answer within 14 days.',
            '**Is my booking real?** Multiversal Airways is a demonstration airline — no real tickets exist.',
          ].join('\n\n'),
          'Frequently asked',
        ),
        contact: obj(
          {
            phone: str('+44 20 7946 0999 (demo)', 'Phone'),
            chat: str('In-app chat, 06:00–23:00 London time', 'Chat'),
            email: str('help@multiversal.example', 'Email'),
            social: str('@MultiversalAir on every platform', 'Social'),
          },
          'Talk to a human',
        ),
        subscribed: str('Not subscribed.', 'Newsletter'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'faq', state_path: 'faq', layout: 'detail', label: 'FAQ' },
          { id: 'contact', state_path: 'contact', layout: 'detail', label: 'Talk to a human' },
          { id: 'news', state_path: 'subscribed', layout: 'detail', label: 'Newsletter' },
        ],
      },
      actions: {
        subscribe: {
          description: 'Subscribe to the newsletter',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          input: {
            email: { type: 'string', description: 'Email', required: true, max_length: 80 },
          },
        },
      },
      navigation: crumbs(origin, 'Help centre', 'help'),
    }),
  );

  /* ---------- travel extras ---------- */
  pages.set(
    'travel-extras',
    doc({
      id: 'mva_travelextras',
      origin,
      path: '/app/mva/travel-extras',
      title: 'Travel extras — hotels, cars, insurance',
      version: 'mva-extras-1',
      state: {
        offers: arr(
          [
            obj(
              {
                name: str('Hotels via StayHotels'),
                desc: str('2 million properties · 3 pts/£1 · free cancellation on most rates'),
                from: money(8900, 'GBP'),
              },
              'Hotels',
            ),
            obj(
              {
                name: str('Car hire via DriveNow'),
                desc: str('All major brands · free second driver · earn 3 pts/£1'),
                from: money(2400, 'GBP'),
              },
              'Cars',
            ),
            obj(
              {
                name: str('Travel insurance'),
                desc: str('Cover for delays, medical and bags across all timelines'),
                from: money(1450, 'GBP'),
              },
              'Insurance',
            ),
            obj(
              {
                name: str('Airport parking'),
                desc: str('Meet & greet or park-and-ride at LHR, JFK, DXB'),
                from: money(6900, 'GBP'),
              },
              'Parking',
            ),
            obj(
              {
                name: str('Lounge day pass'),
                desc: str('Nebula Lounge access, subject to capacity'),
                from: money(4500, 'GBP'),
              },
              'Lounges',
            ),
          ],
          'Book alongside your flight',
        ),
        note: markdown(
          'Extras are fulfilled by partners and billed to your booking — collect Singularity points on all of them.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'offers', state_path: 'offers', layout: 'grid', label: 'Extras' },
          { id: 'note', state_path: 'note', layout: 'detail', label: 'Good to know' },
        ],
      },
      actions: {},
      navigation: crumbs(origin, 'Travel extras', 'travel-extras'),
    }),
  );

  /* ---------- group bookings ---------- */
  pages.set(
    'group',
    doc({
      id: 'mva_group',
      origin,
      path: '/app/mva/group',
      title: 'Group bookings (10+ passengers)',
      version: 'mva-group-1',
      state: {
        pitch: markdown(
          [
            '**Flying with 10 or more?** Groups get:',
            '- One named contact and a dedicated coordinator',
            '- Seated together, checked in together',
            '- Deposit from £50 per head, balance 30 days out',
            '- Flexible name changes until tickets are issued',
          ].join('\n'),
          'Why book as a group',
        ),
        quote_status: str('No quote requested yet.', 'Your quote'),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'pitch', state_path: 'pitch', layout: 'detail', label: 'Group travel' },
          { id: 'status', state_path: 'quote_status', layout: 'detail', label: 'Your quote' },
        ],
      },
      actions: {
        request_quote: {
          description: 'Request a group quote',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          input: {
            passengers: {
              type: 'number',
              description: 'Passengers',
              required: true,
              min: 10,
              max: 200,
            },
            to: { type: 'string', description: 'Destination', required: true, max_length: 60 },
            depart: { type: 'date', description: 'Outbound', required: true },
            contact_name: {
              type: 'string',
              description: 'Contact name',
              required: true,
              max_length: 80,
            },
            email: { type: 'string', description: 'Email', required: true, max_length: 80 },
          },
        },
      },
      navigation: crumbs(origin, 'Group bookings', 'group'),
    }),
  );

  return pages;
}
