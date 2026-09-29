import { bumpVersion, type ActionHandler, type PageManifest } from '@agent-page/server';
import { AIRPORT_LABELS, DESTINATIONS, ORIGINS } from '../data/flights.js';
import { type DemoSession, buildSessionStateNode } from '../sessions.js';
import { asManifest } from '../protocol.js';

export type SearchStore = Map<string, PageManifest>;

const ALL_CODES = [...new Set([...ORIGINS, ...DESTINATIONS])];

function suggestionsTable(rows: Array<[string, string]>): import('@agent-page/server').StateNode {
  return {
    type: 'table',
    fields: { code: 'string', label: 'string' },
    item_label: 'airport',
    value: rows,
    pagination: { cursor: null, has_more: false, total: rows.length },
  };
}

export function buildSearchManifest(
  origin: string,
  options?: { session?: DemoSession; version?: string; suggestions?: Array<[string, string]> },
): PageManifest {
  const suggestions = options?.suggestions ?? [];
  return asManifest({
    app: '1.1',
    page: {
      id: 'flight-search',
      url: `${origin}/flights`,
      title: 'Search Flights',
      version: options?.version ?? 'v1',
      etag: options?.version ? `W/"search-${options.version}"` : 'W/"search-1"',
      description: 'Search for available flights',
    },
    state: {
      origin: {
        type: 'enum',
        value: 'LHR',
        options: [...ORIGINS],
        label: 'From',
      },
      destination: {
        type: 'enum',
        value: 'DXB',
        options: [...DESTINATIONS],
        label: 'To',
      },
      date: { type: 'date', value: '2026-08-15', label: 'Date' },
      passengers: {
        type: 'number',
        value: 1,
        label: 'Passengers',
        min: 1,
        max: 9,
      },
      suggestions: suggestionsTable(suggestions),
      session: buildSessionStateNode(options?.session),
    },
    actions: {
      search: {
        description: 'Search for available flights',
        kind: 'navigate',
        input: {
          origin: {
            type: 'enum',
            required: true,
            options: [...ORIGINS],
            options_source: {
              action: 'search_airports',
              param: 'q',
              results_path: 'suggestions',
              min_query_length: 1,
            },
          },
          destination: {
            type: 'enum',
            required: true,
            options: [...DESTINATIONS],
            options_source: {
              action: 'search_airports',
              param: 'q',
              results_path: 'suggestions',
              min_query_length: 1,
            },
          },
          date: { type: 'date', required: true },
          passengers: {
            type: 'number',
            default: 1,
            min: 1,
            max: 9,
          },
        },
        output: {
          navigates_to: `${origin}/flights/{origin}/{destination}/{date}?pax={passengers}`,
        },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 10000,
        auth: 'none',
        param_mode: 'strict',
      },
      search_airports: {
        description: 'Typeahead airport codes',
        kind: 'query',
        input: {
          q: { type: 'string', required: true, min_length: 1, max_length: 8 },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 5000,
        auth: 'none',
        param_mode: 'strict',
        rate_limit: { limit: 30, window_seconds: 60 },
      },
    },
    present: { layout: 'form' },
  });
}

export function createSearchHandlers(
  pageOrigin: string,
  store: SearchStore,
): Record<string, ActionHandler> {
  return {
    search: async ({ params }) => {
      const o = String(params.origin);
      const d = String(params.destination);
      const date = String(params.date);
      const pax = params.passengers !== undefined ? Number(params.passengers) : 1;
      const url = `${pageOrigin}/flights/${encodeURIComponent(o)}/${encodeURIComponent(d)}/${encodeURIComponent(date)}?pax=${pax}`;
      return { type: 'navigate', url, mode: 'push' };
    },
    search_airports: async ({ params, manifest }) => {
      const q = String(params.q ?? '').toUpperCase();
      const rows: Array<[string, string]> = ALL_CODES.filter((code) => {
        const label = (AIRPORT_LABELS[code] ?? code).toUpperCase();
        return code.includes(q) || label.includes(q);
      }).map((code) => [code, AIRPORT_LABELS[code] ?? code]);
      const next = buildSearchManifest(pageOrigin, {
        version: bumpVersion(manifest.page.version),
        suggestions: rows,
      });
      store.set(next.page.url, next);
      return { type: 'diff', nextManifest: next };
    },
  };
}
