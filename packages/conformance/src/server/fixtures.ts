/**
 * Conformance harness: page fixtures for TV-01..TV-60.
 */

import type { PageManifest } from '@agent-page/server';

export const PAGE_HOST = '127.0.0.1';

export function pageUrl(port: number, path: string): string {
  return `http://${PAGE_HOST}:${port}${path}`;
}

export function tvRoute(n: number): string {
  return `/vectors/tv-${String(n).padStart(2, '0')}`;
}

export function makePage(
  port: number,
  path: string,
  id: string,
  partial: Omit<Partial<PageManifest>, 'page'> & {
    page?: Partial<PageManifest['page']>;
  } = {},
): PageManifest {
  return {
    app: '1.0',
    page: {
      id,
      url: pageUrl(port, path),
      title: partial.page?.title ?? id,
      version: partial.page?.version ?? 'v1',
      etag: partial.page?.etag ?? '"etag-v1"',
      generated_at: partial.page?.generated_at ?? '2026-07-30T00:00:00.000Z',
    },
    state: partial.state ?? {},
    actions: partial.actions ?? {},
    ...(partial.navigation ? { navigation: partial.navigation } : {}),
    ...(partial.present ? { present: partial.present } : {}),
    ...(partial.error ? { error: partial.error } : {}),
    ...(partial.meta ? { meta: partial.meta } : {}),
  };
}

export function seedPages(port: number): Map<string, PageManifest> {
  const pages = new Map<string, PageManifest>();
  const p = (n: number) => tvRoute(n);
  const mk = (n: number, id: string, partial: Parameters<typeof makePage>[3] = {}) =>
    makePage(port, p(n), id, partial);

  pages.set(p(1), mk(1, 'tv_01', { state: {}, actions: {} }));

  pages.set(
    p(2),
    mk(2, 'tv_02', {
      state: {
        profile: {
          type: 'object',
          label: 'Profile',
          value: {
            first_name: { type: 'string', value: 'Ada' },
            middle_name: { type: 'null', label: 'Middle name' },
            last_name: { type: 'string', value: 'Lovelace' },
          },
        },
      },
    }),
  );

  pages.set(
    p(3),
    mk(3, 'tv_03', {
      state: {
        results: {
          type: 'table',
          label: 'Results',
          fields: { id: 'string', name: 'string' },
          value: [],
          pagination: { cursor: null, has_more: false, total: 0 },
        },
      },
    }),
  );

  pages.set(
    p(4),
    mk(4, 'tv_04', {
      state: {
        items: {
          type: 'array',
          label: 'Items',
          value: [],
          pagination: { cursor: null, has_more: true, total: null },
        },
      },
      meta: {
        warnings: [
          {
            code: 'app.warn.state.pagination_inconsistent',
            message: 'cursor null with has_more true',
          },
        ],
      },
    }),
  );

  pages.set(
    p(5),
    mk(5, 'tv_05', {
      state: {
        status: {
          type: 'enum',
          value: 'invalid_option',
          options: ['a', 'b'],
          label: 'Status',
        },
      },
    }),
  );

  const dupOptions = ['a', 'a', 'b'];
  pages.set(
    p(6),
    mk(6, 'tv_06_dup', {
      state: {
        big: {
          type: 'enum',
          value: 'a',
          options: dupOptions,
          label: 'Dup',
        },
      },
    }),
  );
  pages.set(
    `${p(6)}/too-many`,
    mk(6, 'tv_06_many', {
      state: {
        big: {
          type: 'enum',
          value: 'opt0',
          options: Array.from({ length: 257 }, (_, i) => `opt${i}`),
          label: 'Many',
        },
      },
    }),
  );

  pages.set(p(7), mk(7, 'tv_07', { state: { n: { type: 'number', value: -0, label: 'N' } } }));

  pages.set(
    p(8),
    mk(8, 'tv_08_bad', {
      state: { big: { type: 'number', value: 9007199254740992, label: 'Big' } },
    }),
  );
  pages.set(
    `${p(8)}/ok`,
    mk(8, 'tv_08_ok', {
      state: { big: { type: 'number', value: 9007199254740991, label: 'MaxSafe' } },
    }),
  );

  pages.set(
    p(9),
    mk(9, 'tv_09', {
      state: { price: { type: 'number', value: 10.5, scale: 2, label: 'Price' } },
    }),
  );

  pages.set(
    p(10),
    mk(10, 'tv_10', { state: { d: { type: 'date', value: '2026-02-30', label: 'D' } } }),
  );
  pages.set(
    p(11),
    mk(11, 'tv_11', {
      state: { dt: { type: 'datetime', value: '2026-01-01T12:00:00', label: 'DT' } },
    }),
  );

  pages.set(
    p(12),
    mk(12, 'tv_12', {
      state: {
        bad: {
          type: 'object',
          value: {
            constructor: { type: 'string', value: 'x' },
          },
        },
      },
    }),
  );

  pages.set(
    p(13),
    mk(13, 'tv_13', {
      state: {
        t: {
          type: 'table',
          fields: { a: 'string', b: 'number' },
          value: [['only-one']],
          label: 'T',
        },
      },
    }),
  );

  pages.set(
    p(14),
    mk(14, 'tv_14', {
      state: {
        doc: {
          type: 'file',
          value: { url: 'https://cdn.example/f', name: 'bad/name.pdf', mime: 'application/pdf' },
        },
      },
    }),
  );

  pages.set(
    p(15),
    mk(15, 'tv_15', {
      state: {
        doc: {
          type: 'file',
          value: {
            url: 'http://evil.example/file.pdf',
            name: 'file.pdf',
            mime: 'application/pdf',
          },
        },
      },
    }),
  );

  pages.set(
    p(18),
    mk(18, 'tv_18', {
      state: { note: { type: 'string', value: 'dual-mode', label: 'Note' } },
      present: { layout: 'list' },
    }),
  );

  pages.set(
    p(19),
    mk(19, 'tv_19', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        noop: {
          description: 'No diff output',
          kind: 'query',
          input: {},
          output: {},
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(22),
    mk(22, 'tv_22', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        set_n: {
          description: 'Set n',
          kind: 'mutate',
          input: { n: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(23),
    mk(23, 'tv_23', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        need_x: {
          description: 'Needs x',
          kind: 'mutate',
          input: { x: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(24),
    mk(24, 'tv_24', {
      meta: { param_mode: 'strict' },
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        touch_strict: {
          description: 'Touch strict',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          param_mode: 'strict',
        },
      },
    }),
  );

  pages.set(
    p(25),
    mk(25, 'tv_25', {
      meta: { param_mode: 'lenient' },
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        touch_lenient: {
          description: 'Touch lenient',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          param_mode: 'lenient',
        },
      },
    }),
  );

  pages.set(
    p(26),
    mk(26, 'tv_26', {
      state: { bal: { type: 'number', value: 0, scale: 2, label: 'Balance' } },
      actions: {
        charge: {
          description: 'Charge',
          kind: 'mutate',
          input: { amount: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'financial',
          idempotent: false,
        },
      },
    }),
  );

  pages.set(
    p(27),
    mk(27, 'tv_27', {
      state: { total: { type: 'number', value: 0, label: 'Total' } },
      actions: {
        add: {
          description: 'Add',
          kind: 'mutate',
          input: { amount: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(28),
    mk(28, 'tv_28', {
      state: { total: { type: 'number', value: 0, label: 'Total' } },
      actions: {
        add: {
          description: 'Add',
          kind: 'mutate',
          input: { amount: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(29),
    mk(29, 'tv_29', {
      state: { total: { type: 'number', value: 0, label: 'Total' } },
      actions: {
        slow_add: {
          description: 'Slow add',
          kind: 'mutate',
          input: { amount: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          async: true,
        },
      },
    }),
  );

  pages.set(
    p(30),
    mk(30, 'tv_30', {
      state: { n: { type: 'number', value: 1, label: 'N' } },
      actions: {
        bump: {
          description: 'Bump',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(31),
    mk(31, 'tv_31', {
      state: { n: { type: 'number', value: 1, label: 'N' } },
      actions: {
        bump: {
          description: 'Bump',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
        // Simulates a permanently racing writer: every attempt conflicts (TV-31).
        race_bump: {
          description: 'Bump under concurrent writes',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(35),
    mk(35, 'tv_35', {
      state: {
        results: {
          type: 'table',
          label: 'Results',
          fields: { id: 'string', score: 'number' },
          value: [
            ['a', 1],
            ['b', 2],
          ],
        },
      },
      actions: {
        replace_table: {
          description: 'Replace entire results table',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(36),
    mk(36, 'tv_36', {
      state: { n: { type: 'number', value: 5, label: 'N' } },
      actions: {
        noop: {
          description: 'No-op',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(37),
    mk(37, 'tv_37', {
      state: {},
      actions: {
        bad_nav: {
          description: 'Bad navigate',
          kind: 'navigate',
          input: {},
          // {dest} placeholder keeps clients on the POST path (no safe-GET shortcut).
          output: { navigates_to: `${pageUrl(port, p(37))}/{dest}` },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(38),
    mk(38, 'tv_38', {
      state: {},
      actions: {
        go: {
          description: 'Go',
          kind: 'navigate',
          input: { q: { type: 'string', required: true } },
          output: { navigates_to: `${pageUrl(port, p(38))}/dest?q={q}` },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );
  pages.set(
    `${p(38)}/dest`,
    makePage(port, `${p(38)}/dest`, 'tv_38_dest', {
      state: { q: { type: 'string', value: '', label: 'Q' } },
    }),
  );

  pages.set(
    p(39),
    mk(39, 'tv_39', {
      state: {},
      actions: {
        mismatch: {
          description: 'Mismatch headers',
          kind: 'navigate',
          input: {},
          output: { navigates_to: pageUrl(port, p(39)) },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(40),
    mk(40, 'tv_40', {
      state: {},
      actions: {
        search: {
          description: 'Search',
          kind: 'navigate',
          input: { city: { type: 'string', required: true } },
          output: { navigates_to: `${pageUrl(port, p(40))}/r?city={city}` },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );
  pages.set(`${p(40)}/r`, makePage(port, `${p(40)}/r`, 'tv_40_r', { state: {} }));

  pages.set(
    p(44),
    mk(44, 'tv_44', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        touch: {
          description: 'Touch',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(45),
    mk(45, 'tv_45', {
      state: {
        amount: { type: 'number', value: 4200, scale: 2, label: 'Amount' },
        status: { type: 'enum', value: 'pending', options: ['pending', 'confirmed'] },
      },
      actions: {
        confirm_pay: {
          description: 'Confirm pay',
          kind: 'mutate',
          input: { amount: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'financial',
          idempotent: false,
          requires_confirmation: true,
        },
      },
    }),
  );

  pages.set(
    p(46),
    mk(46, 'tv_46', {
      state: { paid: { type: 'boolean', value: false, label: 'Paid' } },
      actions: {
        pay: {
          description: 'Pay',
          kind: 'mutate',
          input: {
            amount: { type: 'number', required: true },
            currency: { type: 'enum', required: true, options: ['GBP', 'USD', 'EUR'] },
          },
          output: { state_diff: true },
          side_effect: 'financial',
          idempotent: false,
          requires_confirmation: true,
        },
      },
    }),
  );

  pages.set(
    p(47),
    mk(47, 'tv_47', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        sensitive: {
          description: 'Sensitive',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'financial',
          idempotent: false,
          requires_confirmation: true,
        },
      },
    }),
  );

  pages.set(
    p(48),
    mk(48, 'tv_48', {
      state: { hits: { type: 'number', value: 0, label: 'Hits' } },
      actions: {
        ping: {
          description: 'Ping',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          rate_limit: { limit: 1, window_seconds: 60 },
        },
      },
    }),
  );

  pages.set(
    p(49),
    mk(49, 'tv_49', {
      state: { secret: { type: 'string', value: 'hidden', secret: true, label: 'Secret' } },
      actions: {
        refresh: {
          description: 'Refresh',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          auth: 'bearer',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(50),
    mk(50, 'tv_50', {
      state: {
        status: { type: 'enum', value: 'pending', options: ['pending', 'done'], label: 'Status' },
      },
      actions: {
        run_job: {
          description: 'Run async job',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          async: true,
        },
      },
    }),
  );

  pages.set(
    p(51),
    mk(51, 'tv_51', {
      state: {
        status: { type: 'enum', value: 'pending', options: ['pending', 'failed'], label: 'Status' },
      },
      actions: {
        fail_job: {
          description: 'Fail async job',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
          async: true,
        },
      },
    }),
  );

  pages.set(
    p(52),
    mk(52, 'tv_52', {
      state: { n: { type: 'number', value: 1, label: 'N' } },
      error: {
        code: 'app.err.internal.server',
        message: 'Hard error masquerading as soft',
        recoverable_actions: [],
      },
    }),
  );

  pages.set(
    p(53),
    mk(53, 'tv_53', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        touch: {
          description: 'Touch',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(54),
    mk(54, 'tv_54', { state: { note: { type: 'string', value: 'cached', label: 'Note' } } }),
  );

  pages.set(
    p(56),
    mk(56, 'tv_56', {
      state: {
        doc: {
          type: 'file',
          value: {
            url: `${pageUrl(port, '/files/signed-expired')}`,
            name: 'doc.pdf',
            mime: 'application/pdf',
          },
          label: 'Doc',
        },
      },
    }),
  );

  pages.set(
    p(57),
    mk(57, 'tv_57', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        upload: {
          description: 'Upload',
          kind: 'mutate',
          input: { file: { type: 'string', required: true, upload: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(58),
    mk(58, 'tv_58', {
      // §5.6: capped collection MUST declare truncation — has_more + meta.truncated
      // + a paginate action taking the emitted cursor.
      state: {
        results: {
          type: 'table',
          label: 'Results',
          fields: { id: 'string' },
          value: [['a'], ['b'], ['c']],
          pagination: { has_more: true, cursor: 'cursor_2', total: null },
        },
      },
      actions: {
        next_page: {
          description: 'Fetch the next results page',
          kind: 'query',
          input: { cursor: { type: 'string', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
      meta: { truncated: true },
    }),
  );

  pages.set(
    p(60),
    mk(60, 'tv_60', {
      state: { counter: { type: 'number', value: 0, label: 'Counter' } },
      actions: {
        inc: {
          description: 'Increment',
          kind: 'mutate',
          input: { delta: { type: 'number', required: true } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(141),
    mk(141, 'tv_141', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        noop19: {
          description: 'No-op',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(142),
    mk(142, 'tv_142', {
      state: {
        counter: { type: 'number', value: 0, label: 'Counter' },
        geo: { type: 'geopoint', value: { lat: 51.47, lng: -0.45 }, label: 'Loc' },
      },
      actions: {
        mutate142: {
          description: 'Mutate counter and geo',
          kind: 'mutate',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(147),
    mk(147, 'tv_147', {
      state: { q: { type: 'string', value: '', label: 'Q' } },
      actions: {
        search: {
          description: 'Search with a dangling options_source',
          kind: 'query',
          input: {
            q: {
              type: 'string',
              options_source: { action: 'ghost_action', param: 'q', results_path: '/state/hits' },
            },
          },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(148),
    mk(148, 'tv_148', {
      state: {
        big: {
          type: 'table',
          fields: { c: 'string' },
          value: Array.from({ length: 10001 }, (_, i) => [`r${i}`]),
          label: 'Big',
        },
      },
      actions: {
        noop19: {
          description: 'No-op',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(151),
    mk(151, 'tv_151', {
      state: { picked: { type: 'string', value: '', label: 'Picked' } },
      actions: {
        pick: {
          description: 'Pick color + sku',
          kind: 'query',
          input: {
            color: { type: 'enum', options: ['red', 'green'] },
            sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{4}$' },
          },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  pages.set(
    p(152),
    mk(152, 'tv_152', {
      state: { n: { type: 'number', value: 0, label: 'N' } },
      actions: {
        explode: {
          description: 'Throws',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
        geo_pin: {
          description: '1.1-only geopoint input',
          kind: 'query',
          input: { loc: { type: 'geopoint' } },
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  // Legacy routes used by focused tests
  pages.set('/vectors/csrf', pages.get(p(44))!);
  pages.set('/vectors/confirmation-replay', pages.get(p(46))!);
  pages.set('/vectors/auth', pages.get(p(49))!);
  pages.set('/vectors/idempotency', pages.get(p(27))!);
  pages.set('/vectors/rate-limit', pages.get(p(48))!);
  pages.set('/vectors/financial-confirm', pages.get(p(45))!);
  pages.set(
    '/vectors/soft-error',
    mk(52, 'soft_error_legacy', {
      state: {
        results: { type: 'array', value: [{ type: 'string', value: 'x' }], label: 'R' },
      },
      error: {
        code: 'app.err.partial.results',
        message: 'Partial',
        recoverable_actions: ['retry_search'],
      },
      actions: {
        retry_search: {
          description: 'Retry',
          kind: 'query',
          input: {},
          output: { state_diff: true },
          side_effect: 'safe',
          idempotent: true,
        },
      },
    }),
  );

  return pages;
}

/** Valid well-known manifest with StateNode capabilities (TV-16 contrast). */
export function validWellKnown(port: number): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'well_known',
      url: pageUrl(port, '/.well-known/agent-page'),
      title: 'APP Discovery',
      version: 'v1',
      generated_at: '2026-07-30T00:00:00.000Z',
    },
    state: {
      capabilities: {
        type: 'object',
        value: {
          file_upload: { type: 'boolean', value: true },
          async_actions: { type: 'boolean', value: true },
          cors_read: { type: 'boolean', value: true },
        },
      },
    },
    actions: {},
  };
}

export function invalidWellKnown(): unknown {
  return {
    app: '1.0',
    page: {
      id: 'bad_well_known',
      url: 'http://example/.well-known/agent-page',
      title: 'Bad',
      version: 'v1',
    },
    state: {},
    actions: {},
    capabilities: 'file_upload,async_actions',
  };
}

export const V11_FEATURE_FLAGS: Record<string, boolean> = {
  identity_flows: true,
  mfa: true,
  passkey: true,
  oauth: true,
  magic_link: true,
  human_hold: true,
  consent: true,
  events_sse: true,
  events_longpoll: true,
  events_ws: false,
  session_resume: true,
  typeahead: true,
  file_presign: true,
  geopoint: true,
  quantity: true,
  datetime_range: true,
  bulk_actions: true,
  commerce: true,
  order_state: true,
  deep_focus: true,
  locale_tz: true,
  error_i18n: true,
  action_result_pagination: false,
  drafts: false,
};

export function boolNode(value: boolean, label?: string) {
  return label ? { type: 'boolean' as const, value, label } : { type: 'boolean' as const, value };
}

export function strNode(value: string, label?: string) {
  return label ? { type: 'string' as const, value, label } : { type: 'string' as const, value };
}

export function numNode(value: number, label?: string) {
  return label ? { type: 'number' as const, value, label } : { type: 'number' as const, value };
}

export function enumNode(value: string, options: string[], label?: string) {
  return { type: 'enum' as const, value, options, ...(label ? { label } : {}) };
}

export function featuresObject(flags: Record<string, boolean> = V11_FEATURE_FLAGS) {
  const value: Record<string, { type: 'boolean'; value: boolean }> = {};
  for (const [k, v] of Object.entries(flags)) {
    value[k] = { type: 'boolean', value: v };
  }
  return { type: 'object' as const, label: 'Features', value };
}

export function capabilitiesArray(caps: string[]) {
  return {
    type: 'array' as const,
    label: 'Capabilities',
    value: caps.map((c) => ({ type: 'string' as const, value: c })),
  };
}

const DEFAULT_CAPS = [
  'search',
  'booking',
  'checkout',
  'user_account',
  'auth_session',
  'auth_bearer',
  'auth_oauth',
  'diffs',
  'file_upload',
  'pagination',
  'async_actions',
];

export function wellKnown11(port: number): PageManifest {
  const origin = pageUrl(port, '');
  return {
    app: '1.1',
    page: {
      id: 'well-known',
      url: pageUrl(port, '/.well-known/agent-page'),
      title: 'APP Discovery',
      version: 'wk-11',
      language: 'en',
    },
    state: {
      site_name: strNode('APP Conformance', 'Site'),
      protocol_version: strNode('1.1', 'Protocol'),
      capabilities: capabilitiesArray(DEFAULT_CAPS),
      features: featuresObject(),
      events_url: strNode(`${origin}/app-events`, 'Events'),
      locale_default: strNode('en'),
      time_zone_default: strNode('UTC'),
      flows: {
        type: 'object',
        label: 'Identity flows',
        value: {
          login: {
            type: 'object',
            value: {
              kind: enumNode('mixed', ['password', 'oauth', 'passkey', 'magic_link', 'mixed']),
              entry_url: strNode(`${origin}/login`),
              logout_url: strNode(`${origin}/logout`),
              signup_url: strNode(`${origin}/signup`),
              recovery_url: strNode(`${origin}/recover`),
              mfa: boolNode(true),
              providers: {
                type: 'array',
                item_label: 'provider',
                value: [
                  {
                    type: 'object',
                    value: {
                      id: strNode('google'),
                      label: strNode('Google'),
                      start_url: strNode(`${origin}/auth/google`),
                    },
                  },
                ],
              },
            },
          },
          logout: {
            type: 'object',
            value: {
              kind: enumNode('password', ['password', 'oauth', 'passkey', 'magic_link', 'mixed']),
              entry_url: strNode(`${origin}/logout`),
            },
          },
        },
      },
    },
    actions: {},
  } as unknown as PageManifest;
}

export function wellKnown10From11(port: number): PageManifest {
  const wk = wellKnown11(port);
  return {
    ...wk,
    app: '1.0',
    page: { ...wk.page },
    state: {
      site_name: wk.state.site_name,
      protocol_version: strNode('1.1', 'Protocol'),
      capabilities: wk.state.capabilities,
      features: wk.state.features,
    },
    actions: {},
  };
}

export function wellKnown10Only(port: number): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'well-known',
      url: pageUrl(port, '/.well-known/agent-page-v10'),
      title: 'APP Discovery v0.4',
      version: 'wk-10',
    },
    state: {
      site_name: strNode('Legacy', 'Site'),
      protocol_version: strNode('1.0', 'Protocol'),
      capabilities: capabilitiesArray(['search', 'diffs', 'auth_session']),
    },
    actions: {},
  };
}
