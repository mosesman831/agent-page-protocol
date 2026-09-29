/**
 * Protocol Lab — a demo site that exercises every APP wire feature the other
 * demos do not: diffs, async jobs, OTP challenge, consent, rate limits,
 * idempotency, version-match, soft errors, typeahead, delegation, bulk, and a
 * full component showcase. Served through the real @agent-page/server
 * middleware by demo/full-server.mjs (falls back to the basic handler).
 */

import { str, num, obj, arr, bool } from '../lib/nodes.mjs';
import { lab, page, navHome, labPresent } from './helpers.mjs';
import { addExtraLabPages, addDelegatedAuthPages, addWebNodePages } from './pages-extra.mjs';
import { addLabFlowPages } from './pages-flows.mjs';
import { addLabConsolePages } from './pages-console.mjs';
export function buildLabPages(origin) {
  const pages = new Map();

  /* ---------- home: hub ---------- */
  pages.set(
    'home',
    page({
      origin,
      slug: 'home',
      id: 'lab_home',
      title: 'Protocol Lab — feature coverage',
      version: 'lab-home-1',
      state: {
        intro: str(
          'Each page demonstrates one wire feature end-to-end. All responses go through @agent-page/server middleware.',
          'About',
        ),
        feature_index: arr(
          [
            obj(
              {
                feature: str('Diff responses'),
                page: str('counter'),
                try: str('act inc — returns vnd.agent-page-diff+json'),
              },
              'diff',
            ),
            obj(
              {
                feature: str('Conditional GET / watch'),
                page: str('counter'),
                try: str('app_watch — 304 until inc mutates etag'),
              },
              'watch',
            ),
            obj(
              {
                feature: str('Async 202 + status_url'),
                page: str('async'),
                try: str('act start_job then poll status'),
              },
              'async',
            ),
            obj(
              {
                feature: str('OTP challenge (§18.2 continuation)'),
                page: str('secure'),
                try: str('act login with idempotency_key, then app_challenge otp=123456'),
              },
              'challenge',
            ),
            obj(
              {
                feature: str('Consent gate'),
                page: str('consent'),
                try: str('act track → consent.required → grant_consent → retry'),
              },
              'consent',
            ),
            obj(
              {
                feature: str('Rate limiting'),
                page: str('rate'),
                try: str('act ping 3× → 429 + Retry-After'),
              },
              'rate',
            ),
            obj(
              {
                feature: str('Idempotent replay'),
                page: str('idem'),
                try: str('act pay twice with same idempotency_key → identical stored response'),
              },
              'idem',
            ),
            obj(
              {
                feature: str('Version match'),
                page: str('counter'),
                try: str('inc requires X-APP-If-Match-Version (client sends it)'),
              },
              'version',
            ),
            obj(
              {
                feature: str('Soft error'),
                page: str('soft'),
                try: str('page carries error{}; act retry clears it'),
              },
              'soft',
            ),
            obj(
              {
                feature: str('Typeahead / options_source'),
                page: str('typeahead'),
                try: str('act suggest {q} → results in state'),
              },
              'typeahead',
            ),
            obj(
              {
                feature: str('Delegate (external)'),
                page: str('delegate'),
                try: str('act pay_external → delegates_to https + resume_url'),
              },
              'delegate',
            ),
            obj(
              {
                feature: str('Bulk (1.1)'),
                page: str('bulk'),
                try: str('act bulk_tag with items[]'),
              },
              'bulk',
            ),
            obj(
              {
                feature: str('Auth session'),
                page: str('secure'),
                try: str('account actions need session cookie from OTP login'),
              },
              'auth',
            ),
            obj(
              {
                feature: str('Component showcase'),
                page: str('showcase'),
                try: str('open in the extension — every present component'),
              },
              'showcase',
            ),
            obj(
              {
                feature: str('Web nodes (embed/markdown/media/tree)'),
                page: str('webnodes'),
                try: str('open — gallery/calendar/stepper component hints render'),
              },
              'webnodes',
            ),
          ],
          'Coverage',
        ),
      },
      present: { layout: 'table', sections: [] },
      actions: {
        go_counter: {
          description: 'Open counter',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'counter') },
        },
        go_async: {
          description: 'Open async job page',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'async') },
        },
        go_secure: {
          description: 'Open OTP challenge page',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'secure') },
        },
        go_consent: {
          description: 'Open consent page',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'consent') },
        },
        go_showcase: {
          description: 'Open component showcase',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'showcase') },
        },
        go_webnodes: {
          description: 'Open web-app element nodes page',
          kind: 'navigate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {},
          output: { navigates_to: lab(origin, 'webnodes') },
        },
      },
      navigation: navHome(origin),
    }),
  );

  /* ---------- counter: diff + etag + version-match + SSE ---------- */
  pages.set(
    'counter',
    page({
      origin,
      slug: 'counter',
      id: 'lab_counter',
      title: 'Counter — diff / etag / version-match',
      version: 'ctr-1',
      state: {
        counter: num(0, { label: 'Count' }),
        note: str('inc returns a diff when the client accepts vnd.agent-page-diff+json', 'How'),
      },
      meta: { events_url: `${origin}/app-events`, refresh_hint_ms: 1000 },
      present: labPresent({
        state: [
          ['counter', 'Count'],
          ['note', 'How'],
        ],
        actions: ['inc', 'home'],
      }),
      actions: {
        inc: {
          description: 'Increment the counter (diff response, version-match required)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          timeout_ms: 15000,
          requires_etag_match: true,
          input: {
            delta: { type: 'number', description: 'Amount', default: 1, min: -100, max: 100 },
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

  /* ---------- async: 202 + status_url ---------- */
  pages.set(
    'async',
    page({
      origin,
      slug: 'async',
      id: 'lab_async',
      title: 'Async job — 202 + status_url',
      version: 'async-1',
      state: {
        status: str('idle', 'Job status'),
        explain: str(
          'start_job returns 202 with an operations status_url; polling it flips to succeeded then returns the final manifest',
          'How',
        ),
      },
      present: labPresent({
        state: [
          ['status', 'Job status'],
          ['explain', 'How'],
        ],
        actions: ['start_job', 'home'],
      }),
      actions: {
        start_job: {
          description: 'Start a 2-poll async job',
          kind: 'mutate',
          side_effect: 'safe',
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

  /* ---------- secure: OTP challenge + session cookie ---------- */
  pages.set(
    'secure',
    page({
      origin,
      slug: 'secure',
      id: 'lab_secure',
      title: 'Secure area — OTP challenge + session',
      version: 'sec-1',
      state: {
        status: str('signed-out', 'Session'),
        explain: str(
          'login (with an idempotency key) issues an OTP challenge; app_challenge otp=123456 signs you in and sets the session cookie',
          'How',
        ),
        challenge_hint: str('Demo OTP is 123456', 'Hint'),
      },
      present: labPresent({
        state: [
          ['status', 'Session'],
          ['explain', 'How'],
          ['challenge_hint', 'Hint'],
        ],
        actions: ['login', 'whoami', 'logout', 'home'],
      }),
      actions: {
        login: {
          description: 'Sign in — issues OTP challenge (§18.2)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          timeout_ms: 15000,
          input: {
            user: { type: 'string', description: 'Username', required: true, default: 'demo' },
            password: { type: 'string', description: 'Password', required: true },
            otp: {
              type: 'string',
              description: 'One-time code (continuation param)',
              required: false,
            },
          },
          output: { state_diff: true },
        },
        whoami: {
          description: 'Read the authenticated identity (requires session)',
          kind: 'query',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          auth: 'session',
          input: {},
          output: {},
        },
        logout: {
          description: 'Sign out (clears session cookie)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          timeout_ms: 15000,
          auth: 'session',
          input: {},
          output: {},
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

  /* ---------- consent ---------- */
  pages.set(
    'consent',
    page({
      origin,
      slug: 'consent',
      id: 'lab_consent',
      title: 'Consent gate — grant/revoke purposes',
      version: 'cons-1',
      state: {
        consent: obj(
          {
            version: str('v1'),
            required: bool(false),
            purposes: arr(
              [
                obj({
                  id: str('necessary'),
                  label: str('Necessary (always on)'),
                  granted: bool(true),
                  required: bool(true),
                }),
                obj({
                  id: str('analytics'),
                  label: str('Analytics'),
                  granted: bool(false),
                  required: bool(false),
                }),
                obj({
                  id: str('marketing'),
                  label: str('Marketing'),
                  granted: bool(false),
                  required: bool(false),
                }),
              ],
              'Purposes',
            ),
          },
          'Consent state',
        ),
        tracked: num(0, { label: 'Tracked events' }),
      },
      present: labPresent({
        state: [
          ['consent', 'Consent state'],
          ['tracked', 'Tracked events'],
        ],
        actions: ['track', 'grant_consent', 'revoke_consent', 'home'],
        components: { consent: { type: 'consent' } },
      }),
      actions: {
        track: {
          description: 'Send an analytics event (needs analytics consent)',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          timeout_ms: 15000,
          input: {},
          output: { state_diff: true },
          policy: { consent_purposes: ['analytics'] },
        },
        grant_consent: {
          description: 'Grant consent purposes',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            purposes: {
              type: 'array',
              description:
                'Purposes to grant — [{id,granted}] objects (consent component contract)',
              required: true,
              item_type: {
                type: 'object',
                properties: {
                  id: { type: 'string', required: true },
                  granted: { type: 'boolean' },
                },
              },
              example: [{ id: 'analytics', granted: true }],
            },
          },
          output: { state_diff: true },
        },
        revoke_consent: {
          description: 'Revoke consent purposes',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            purposes: {
              type: 'array',
              description: 'Purposes to revoke — [{id}] objects',
              required: true,
              item_type: {
                type: 'object',
                properties: {
                  id: { type: 'string', required: true },
                  granted: { type: 'boolean' },
                },
              },
              example: [{ id: 'marketing', granted: false }],
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

  addExtraLabPages(pages, origin);
  addLabFlowPages(pages, origin);
  addDelegatedAuthPages(pages, origin);
  addWebNodePages(pages, origin);
  addLabConsolePages(pages, origin);

  return pages;
}
