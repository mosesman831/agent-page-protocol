/**
 * Protocol Lab — feature pages, part 3: delegate handoff, bulk actions,
 * component showcase. See pages.mjs.
 */

import { str, num, obj, arr, bool, money, table, enumN, geopoint, file } from '../lib/nodes.mjs';
import { lab, page, navHome, labPresent } from './helpers.mjs';

export function addLabFlowPages(pages, origin) {
  /* ---------- delegate ---------- */
  pages.set(
    'delegate',
    page({
      origin,
      slug: 'delegate',
      id: 'lab_delegate',
      title: 'Delegate — external payment handoff',
      version: 'del-1',
      state: {
        status: str('idle', 'Status'),
        explain: str(
          'pay_external is kind:delegate — the agent hands off to an https URL and can resume via resume_url',
          'How',
        ),
      },
      present: labPresent({
        state: [
          ['status', 'Status'],
          ['explain', 'How'],
        ],
        actions: ['pay_external', 'home'],
      }),
      actions: {
        pay_external: {
          description: 'Pay via external PSP (delegates)',
          kind: 'delegate',
          side_effect: 'financial',
          idempotent: false,
          timeout_ms: 15000,
          requires_confirmation: true,
          confirm: {
            title: 'External payment',
            body_template: 'Hand off to PSP for {param.amount} GBP',
          },
          input: {
            amount: {
              type: 'number',
              description: 'Amount GBP',
              required: true,
              min: 1,
              example: 25,
            },
          },
          output: {
            delegates_to: 'https://psp.example.com/checkout',
            delegate_protocol: 'https',
            resume_url: lab(origin, 'delegate-done'),
          },
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

  pages.set(
    'delegate-done',
    page({
      origin,
      slug: 'delegate-done',
      id: 'lab_delegate_done',
      title: 'Returned from PSP',
      version: 'del-done-1',
      state: { status: str('payment completed externally — resumed via resume_url', 'Status') },
      present: labPresent({
        state: [['status', 'Status']],
        actions: ['home'],
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

  /* ---------- bulk ---------- */
  pages.set(
    'bulk',
    page({
      origin,
      slug: 'bulk',
      id: 'lab_bulk',
      title: 'Bulk action — multi-item mutate (1.1)',
      version: 'bulk-1',
      state: {
        items: table(
          { id: 'string', tag: 'string' },
          [
            ['a1', 'untagged'],
            ['a2', 'untagged'],
            ['a3', 'untagged'],
          ],
          'Items',
        ),
      },
      present: labPresent({
        state: [['items', 'Items', 'table']],
        actions: ['bulk_tag', 'home'],
      }),
      actions: {
        bulk_tag: {
          description: 'Tag many items at once',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: false,
          timeout_ms: 15000,
          bulk: { max_items: 10, mode: 'all_or_nothing' },
          input: {
            items: {
              type: 'array',
              description: 'Item ids',
              required: true,
              item_type: { type: 'string' },
              min_items: 1,
              max_items: 10,
            },
            tag: {
              type: 'string',
              description: 'Tag to apply',
              required: true,
              default: 'starred',
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

  /* ---------- showcase: every present component ---------- */
  pages.set(
    'showcase',
    page({
      origin,
      slug: 'showcase',
      id: 'lab_showcase',
      title: 'Component showcase — every present type',
      version: 'show-1',
      state: {
        banner_msg: str('This page renders every component the catalog defines', 'Banner'),
        hero_title: str('Protocol Lab', 'Hero'),
        hero_sub: str('Manifest-driven UI, no HTML', 'Hero subtitle'),
        price: money(12900, 'GBP', 2),
        was_price: money(15900, 'GBP', 2),
        stats: table(
          { metric: 'string', value: 'string' },
          [
            ['uptime', '99.98%'],
            ['latency p95', '42ms'],
            ['vectors', '140'],
          ],
          'Stats',
        ),
        items: arr(
          [
            obj({ name: str('alpha'), qty: num(3) }, 'alpha'),
            obj({ name: str('beta'), qty: num(7) }, 'beta'),
          ],
          'List items',
        ),
        steps: obj({ current: num(2), total: num(4), label: str('Step 2 of 4') }, 'Progress'),
        location: geopoint(51.5074, -0.1278, 'London'),
        doc_file: {
          ...file(`${origin}/demo/files/spec.pdf`, 'spec.pdf', 'application/pdf'),
          label: 'Spec PDF',
        },
        rating: num(4, { label: 'Rating', min: 0, max: 5 }),
        pill_status: enumN('live', ['live', 'paused', 'archived'], {
          live: 'Live',
          paused: 'Paused',
          archived: 'Archived',
        }),
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
              ],
              'Purposes',
            ),
          },
          'Consent',
        ),
        order: obj(
          {
            id: str('ord_demo'),
            status: enumN('confirmed', [
              'draft',
              'paid',
              'confirmed',
              'shipped',
              'delivered',
              'cancelled',
              'refunded',
            ]),
            total: money(12900, 'GBP', 2),
          },
          'Order',
        ),
      },
      present: labPresent({
        state: [
          ['banner_msg', 'Banner'],
          ['hero_title', 'Hero'],
          ['hero_sub', 'Hero subtitle'],
          ['price', 'Price'],
          ['was_price', 'Was'],
          ['order', 'Order'],
          ['stats', 'Stats', 'table'],
          ['items', 'List items'],
          ['steps', 'Progress'],
          ['location', 'Location'],
          ['doc_file', 'Document'],
          ['rating', 'Rating'],
          ['pill_status', 'Status'],
          ['consent', 'Consent'],
        ],
        actions: ['grant_consent', 'home'],
        components: {
          banner_msg: { type: 'banner', state_path: 'banner_msg' },
          consent: { type: 'consent' },
          order: { type: 'order', state_path: 'order' },
          location: { type: 'geopoint', state_path: 'location' },
        },
      }),
      actions: {
        grant_consent: {
          description: 'Grant consent purposes',
          kind: 'mutate',
          side_effect: 'safe',
          idempotent: true,
          timeout_ms: 15000,
          input: {
            purposes: {
              type: 'array',
              description: 'Purposes — [{id,granted}] objects',
              required: true,
              item_type: {
                type: 'object',
                properties: {
                  id: { type: 'string', required: true },
                  granted: { type: 'boolean' },
                },
              },
            },
          },
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
}
