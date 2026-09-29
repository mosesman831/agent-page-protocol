/**
 * Protocol Lab — feature pages, part 2: rate limiting, idempotency,
 * soft error, typeahead/options_source. See pages.mjs.
 */

import { str, num, table, arr, obj, embed, markdown, media, tree } from '../lib/nodes.mjs';
import { lab, page, navHome, labPresent } from './helpers.mjs';

export function addExtraLabPages(pages, origin) {
  /* ---------- rate limiting ---------- */
  pages.set(
    'rate',
    page({
      origin,
      slug: 'rate',
      id: 'lab_rate',
      title: 'Rate limit — 429 + Retry-After',
      version: 'rate-1',
      state: {
        pings: num(0, { label: 'Pings this window' }),
        explain: str(
          'ping allows 2 calls per 5s window; the 3rd returns 429 with Retry-After',
          'How',
        ),
      },
      present: labPresent({
        state: [
          ['pings', 'Pings this window'],
          ['explain', 'How'],
        ],
        actions: ['ping', 'home'],
      }),
      actions: {
        ping: {
          description: 'Ping (rate-limited: 2 per 5s)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          rate_limit: { limit: 2, window_seconds: 5 },
          input: {},
          output: { state_diff: true },
        },
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );

  /* ---------- idempotency ---------- */
  pages.set(
    'idem',
    page({
      origin,
      slug: 'idem',
      id: 'lab_idem',
      title: 'Idempotent payment — replay-safe',
      version: 'idem-1',
      state: {
        payments: num(0, { label: 'Payments recorded' }),
        explain: str(
          'pay is idempotent — re-POSTing the same X-APP-Idempotency-Key replays the stored response instead of charging twice',
          'How',
        ),
      },
      present: labPresent({
        state: [
          ['payments', 'Payments recorded'],
          ['explain', 'How'],
        ],
        actions: ['pay', 'home'],
      }),
      actions: {
        pay: {
          description: 'Record a payment (idempotent)',
          kind: 'mutate',
          side_effect: 'financial',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            amount: {
              type: 'number',
              description: 'Amount (integer minor units)',
              required: true,
              min: 1,
              example: 500,
            },
          },
          output: { state_diff: true },
        },
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );

  /* ---------- soft error ---------- */
  pages.set(
    'soft',
    page({
      origin,
      slug: 'soft',
      id: 'lab_soft',
      title: 'Soft error — page-level error object',
      version: 'soft-1',
      state: {
        feed: str('partially loaded', 'Feed'),
        explain: str(
          'This page carries a soft error{}; act retry clears it and returns a diff',
          'How',
        ),
      },
      error: {
        code: 'app.err.partial.results',
        message: 'Recommendations service unavailable — showing cached feed',
        recoverable_actions: ['retry'],
      },
      present: labPresent({
        state: [
          ['feed', 'Feed'],
          ['explain', 'How'],
        ],
        actions: ['retry', 'home'],
      }),
      actions: {
        retry: {
          description: 'Retry loading recommendations (clears the soft error)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { state_diff: true },
        },
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );

  /* ---------- typeahead / options_source ---------- */
  pages.set(
    'typeahead',
    page({
      origin,
      slug: 'typeahead',
      id: 'lab_typeahead',
      title: 'Typeahead — options_source suggestions',
      version: 'type-1',
      state: {
        results: table({ code: 'string', name: 'string' }, [], 'Suggestions'),
        explain: str(
          'The city param declares options_source → act suggest {q} fills state.results',
          'How',
        ),
      },
      present: labPresent({
        state: [
          ['results', 'Suggestions'],
          ['explain', 'How'],
        ],
        actions: ['pick_city', 'suggest', 'home'],
      }),
      actions: {
        pick_city: {
          description: 'Pick a city',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            city: {
              type: 'string',
              description: 'City',
              required: true,
              options_source: {
                action: 'suggest',
                param: 'q',
                results_path: 'results',
                min_query_length: 2,
              },
            },
          },
          output: { state_diff: true },
        },
        suggest: {
          description: 'Suggest cities matching q',
          kind: 'query',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: { q: { type: 'string', description: 'Prefix', required: true } },
          output: { state_diff: true },
        },
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );
}

export function addDelegatedAuthPages(pages, origin) {
  /* ---------- delegated auth (SPEC-AUTH): bearer scope enforcement ---------- */
  pages.set(
    'delegated',
    page({
      origin,
      slug: 'delegated',
      id: 'lab_delegated',
      title: 'Delegated auth — scoped bearer tokens',
      version: 'del-1',
      state: {
        status: str('idle', 'Status'),
        explain: str(
          'Actions need auth:bearer with a scoped token from /app-oauth/token. client agent-cli (s3cret-agent) has read+class:safe+class:identity; pay-bot (s3cret-pay) adds class:financial.',
          'How',
        ),
        last_scope: str('none', 'Last call scope'),
      },
      present: labPresent({
        state: [
          ['status', 'Status'],
          ['explain', 'How'],
          ['last_scope', 'Last call scope'],
        ],
        actions: ['read_status', 'touch', 'charge', 'home'],
      }),
      actions: {
        read_status: {
          description: 'Query — requires bearer token with read scope',
          kind: 'query',
          side_effect: 'safe',
          auth: 'bearer',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { state_diff: true },
        },
        touch: {
          description: 'Mutate — requires class:safe scope',
          kind: 'mutate',
          side_effect: 'safe',
          auth: 'bearer',
          idempotent: false,
          timeout_ms: 15000,
          input: {},
          output: { state_diff: true },
        },
        charge: {
          description: 'Charge — requires class:financial scope',
          kind: 'mutate',
          side_effect: 'financial',
          auth: 'bearer',
          idempotent: false,
          timeout_ms: 15000,
          input: {},
          output: { state_diff: true },
        },
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );
}

export function addWebNodePages(pages, origin) {
  /* ---------- SPEC-WEB-NODES: embed/markdown/media/tree + gallery/calendar/stepper hints ---------- */
  pages.set(
    'webnodes',
    page({
      origin,
      slug: 'webnodes',
      id: 'lab_webnodes',
      title: 'Web-app element nodes (SPEC-WEB-NODES)',
      version: 'webnodes-1',
      state: {
        map_embed: embed(
          'https://maps.example.com/embed/lhr',
          'Terminal map centered on LHR T5 (agents: this is an opaque iframe; the description is the legible summary)',
          {
            label: 'Terminal map',
            sandbox: ['scripts', 'same-origin'],
            height: 280,
          },
        ),
        notes: markdown(
          [
            '## Check-in notes',
            '',
            '- **Bag drop** closes *45 min* before departure',
            '- Show your [booking ref](https://example.com/eticket)',
            '',
            '```',
            'PNR = T3KL9X',
            '```',
          ].join('\n'),
          'Markdown',
        ),
        gallery: media(
          [
            {
              url: 'https://cdn.example.com/img/cabin-a380.jpg',
              alt: 'A380 business cabin',
              kind: 'image',
            },
            {
              url: 'https://cdn.example.com/vid/boarding.mp4',
              alt: 'Boarding clip',
              kind: 'video',
            },
          ],
          'Gallery',
        ),
        categories: tree(
          [
            {
              id: 'travel',
              label: 'Travel',
              children: [
                { id: 'flights', label: 'Flights' },
                { id: 'hotels', label: 'Hotels' },
              ],
            },
            { id: 'extras', label: 'Extras', children: [{ id: 'bags', label: 'Bags' }] },
          ],
          'Categories',
        ),
        events: arr(
          [
            obj({ date: str('2026-10-02'), label: str('Web check-in opens') }, 'ev1'),
            obj({ date: str('2026-10-04'), label: str('Departure LHR→JFK') }, 'ev2'),
          ],
          'Trip calendar',
        ),
        step: num(2, { label: 'Checkout step', min: 1, max: 4 }),
      },
      present: labPresent({
        state: [
          ['map_embed', 'Embed (opaque to agents; description is the legible part)'],
          ['notes', 'Markdown'],
          ['gallery', 'Media'],
          ['categories', 'Tree'],
        ],
        actions: ['home'],
        components: {
          gallery_grid: { type: 'gallery', state_path: 'gallery', label: 'Cabin gallery' },
          trip_cal: { type: 'calendar', state_path: 'events', label: 'Trip calendar' },
          checkout_steps: { type: 'stepper', state_path: 'step', label: 'Checkout progress' },
        },
      }),
      actions: {
        home: {
          description: 'Back to lab home',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'home') },
        },
      },
      navigation: navHome(origin),
    }),
  );
}
