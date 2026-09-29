/**
 * Protocol Lab — console pages: a param playground (every input widget in
 * one form, echoed back by inspect_params), a status board, and a wire
 * changelog. Developer-console pages, not consumer pages.
 */

import { str, num, obj, arr, markdown, table } from '../lib/nodes.mjs';
import { page } from './helpers.mjs';

export function addLabConsolePages(pages, origin) {
  /* ---------- playground ---------- */
  pages.set(
    'playground',
    page({
      origin,
      slug: 'playground',
      id: 'lab_playground',
      title: 'Playground — every input widget',
      version: 'lab-playground-1',
      state: {
        intro: str(
          'One action carrying every param type. Submit it and inspect_params echoes exactly what the wire received — the same values an agent would send.',
          'What this is',
        ),
        last_echo: obj(
          {
            note: str('Submit the form to see the echoed params here.', 'Echo'),
          },
          'Last request',
        ),
      },
      present: {
        layout: 'form',
        sections: [
          { id: 'echo', state_path: 'last_echo', layout: 'detail', label: 'Last request' },
        ],
      },
      actions: {
        inspect_params: {
          description: 'Send everything',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 5000,
          input: {
            text: { type: 'string', description: 'Text', default: 'hello agents' },
            qty: { type: 'quantity', description: 'Slider 1-10', min: 1, max: 10, default: 4 },
            money: {
              type: 'money',
              description: 'Price',
              currency: 'GBP',
              scale: 2,
              default: { amount: 1299, currency: 'GBP' },
            },
            enabled: { type: 'boolean', description: 'Toggle me' },
            choice: {
              type: 'enum',
              description: 'Pick one',
              options: ['alpha', 'beta', 'gamma'],
              option_labels: { alpha: 'Alpha', beta: 'Beta', gamma: 'Gamma' },
            },
            multi: {
              type: 'array',
              description: 'Tags (comma separated)',
              item_type: { type: 'string' },
            },
            date: { type: 'date', description: 'A date', default: '2026-10-01' },
            window: { type: 'date_range', description: 'Date range' },
            consent: { type: 'boolean', description: 'I understand this is a demo' },
          },
        },
      },
      navigation: {
        breadcrumb: [
          { label: 'Protocol Lab', url: `${origin}/app/lab/home` },
          { label: 'Playground', url: `${origin}/app/lab/playground` },
        ],
      },
    }),
  );

  /* ---------- status ---------- */
  pages.set(
    'status',
    page({
      origin,
      slug: 'status',
      id: 'lab_status',
      title: 'Lab status',
      version: 'lab-status-1',
      state: {
        board: table(
          {
            signal: 'string',
            value: 'string',
            ok: 'string',
          },
          [
            ['Wire version', 'vnd.agent-page+json v1.1', 'ok'],
            ['Conformance', 'L3 — diffs, async, challenges, delegation', 'ok'],
            ['Sessions', 'Cookie + bearer + delegated', 'ok'],
            ['Idempotency', 'Replay-safe stores', 'ok'],
            ['Rate limits', '429 + Retry-After', 'ok'],
            ['Media types', 'manifest / action / diff / error / event', 'ok'],
          ],
          'Protocol signals',
        ),
        stats: obj(
          {
            demo_sites: num(5, { label: 'Demo sites' }),
            pages: num(70, { label: 'Published manifests' }),
            actions: num(80, { label: 'Live actions' }),
            conformance_tests: num(17196, { label: 'Tests in suite' }),
          },
          'Numbers',
        ),
        note: markdown(
          'Ephemeral serverless state — counters and jobs reset on cold starts. All numbers are demo values.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'board', state_path: 'board', layout: 'table', label: 'Signals' },
          { id: 'stats', state_path: 'stats', layout: 'detail', label: 'Numbers' },
          { id: 'note', state_path: 'note', layout: 'detail', label: 'Ephemerality' },
        ],
      },
      actions: {},
      navigation: {
        breadcrumb: [
          { label: 'Protocol Lab', url: `${origin}/app/lab/home` },
          { label: 'Status', url: `${origin}/app/lab/status` },
        ],
      },
    }),
  );

  /* ---------- changelog ---------- */
  pages.set(
    'changelog',
    page({
      origin,
      slug: 'changelog',
      id: 'lab_changelog',
      title: 'Wire changelog',
      version: 'lab-changelog-1',
      state: {
        log: arr(
          [
            obj(
              {
                version: str('v1.1'),
                when: str('2026-09'),
                notes: str('bulk actions, web node types, param_hints, negotiate hardening'),
              },
              'v1.1',
            ),
            obj(
              {
                version: str('v1.0'),
                when: str('2026-08'),
                notes: str('frozen wire: manifests, diffs, challenges, sessions, idempotency'),
              },
              'v1.0',
            ),
            obj(
              {
                version: str('v0.9'),
                when: str('2026-07'),
                notes: str('diffs + ETag revalidation, async 202 status_url'),
              },
              'v0.9',
            ),
            obj(
              {
                version: str('v0.5'),
                when: str('2026-09'),
                notes: str('public beta — first open release of this repo'),
              },
              'v0.5',
            ),
          ],
          'Releases',
        ),
        policy: markdown(
          '**Stability:** `vnd.agent-page+json` versions are additive inside a major version. Breaking changes bump the major media type and keep a projection for the previous one — v1.0 agents keep working against v1.1 servers.',
        ),
      },
      present: {
        layout: 'list',
        sections: [
          { id: 'log', state_path: 'log', layout: 'grid', label: 'Releases' },
          { id: 'policy', state_path: 'policy', layout: 'detail', label: 'Versioning policy' },
        ],
      },
      actions: {},
      navigation: {
        breadcrumb: [
          { label: 'Protocol Lab', url: `${origin}/app/lab/home` },
          { label: 'Changelog', url: `${origin}/app/lab/changelog` },
        ],
      },
    }),
  );
}
