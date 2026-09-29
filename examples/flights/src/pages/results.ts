import {
  AppError,
  bumpVersion,
  type ActionHandler,
  type PageManifest,
  type TableStateNode,
} from '@agent-page/server';
import {
  AIRPORT_LABELS,
  TABLE_FIELDS,
  filterFlights,
  findFlights,
  sortFlights,
  toRow,
  type FlightRecord,
} from '../data/flights.js';
import type { EventBus } from '../events.js';
import { type DemoSession, buildSessionStateNode } from '../sessions.js';

export interface ResultsRoute {
  origin: string;
  destination: string;
  date: string;
  pax: number;
}

export function parseResultsPath(pathname: string): Omit<ResultsRoute, 'pax'> | null {
  const m = /^\/flights\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return {
    origin: decodeURIComponent(m[1]!),
    destination: decodeURIComponent(m[2]!),
    date: decodeURIComponent(m[3]!),
  };
}

function resultsPageUrl(pageOrigin: string, route: ResultsRoute): string {
  return `${pageOrigin}/flights/${route.origin}/${route.destination}/${route.date}?pax=${route.pax}`;
}

function buildTable(flights: FlightRecord[]): TableStateNode {
  return {
    type: 'table',
    fields: { ...TABLE_FIELDS },
    item_label: 'flight',
    value: flights.map(toRow),
    pagination: {
      cursor: null,
      has_more: false,
      total: flights.length,
    },
  };
}

export function buildResultsManifest(
  pageOrigin: string,
  route: ResultsRoute,
  options?: {
    flights?: FlightRecord[];
    sortBy?: 'price' | 'duration' | 'departure';
    version?: string;
    etag?: string;
    session?: DemoSession;
  },
): PageManifest {
  const sortBy = options?.sortBy ?? 'price';
  const base = options?.flights ?? findFlights(route.origin, route.destination, route.date);
  const version = options?.version ?? 'v3';
  const pageUrl = resultsPageUrl(pageOrigin, route);

  return {
    app: '1.0',
    page: {
      id: 'flight-results',
      url: pageUrl,
      title: `Available Flights: ${route.origin} to ${route.destination}`,
      version,
      etag: options?.etag ?? 'W/"results-1"',
      generated_at: new Date().toISOString(),
      description: 'Flight search results with filtering and booking entry',
    },
    state: {
      origin: {
        type: 'string',
        value: AIRPORT_LABELS[route.origin] ?? route.origin,
        label: 'From',
      },
      destination: {
        type: 'string',
        value: AIRPORT_LABELS[route.destination] ?? route.destination,
        label: 'To',
      },
      date: { type: 'date', value: route.date, label: 'Date' },
      results: buildTable(base),
      total_results: {
        type: 'number',
        value: base.length,
        label: 'Total',
      },
      /** Table `price` column is integer minor units; companion scale/currency. */
      currency: { type: 'string', value: 'GBP', label: 'Currency' },
      price_scale: { type: 'number', value: 2, label: 'Price scale' },
      sort_by: {
        type: 'enum',
        value: sortBy,
        options: ['price', 'duration', 'departure'],
        label: 'Sort by',
      },
      passengers: {
        type: 'number',
        value: route.pax,
        label: 'Passengers',
        min: 1,
        max: 9,
      },
      session: buildSessionStateNode(options?.session),
    },
    actions: {
      filter: {
        description: 'Filter results by airline, max price, or stops',
        kind: 'query',
        input: {
          airline: { type: 'string', description: 'Airline name filter' },
          max_price: {
            type: 'number',
            description: 'Maximum price in GBP minor units (scale=2; e.g. 64000 = £640.00)',
            min: 0,
          },
          max_stops: {
            type: 'number',
            description: 'Maximum stops (0=direct only)',
            min: 0,
            max: 5,
          },
          sort_by: {
            type: 'enum',
            options: ['price', 'duration', 'departure'],
          },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 10000,
        param_mode: 'strict',
        requires_etag_match: true,
      },
      select_flight: {
        description: 'Select a flight to begin booking',
        kind: 'navigate',
        input: {
          flight_id: { type: 'string', required: true },
        },
        output: { navigates_to: `${pageOrigin}/booking/{flight_id}` },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 10000,
        param_mode: 'strict',
      },
    },
    navigation: {
      breadcrumb: [
        { label: 'Home', url: `${pageOrigin}/`, page_id: 'home', rel: 'up' },
        {
          label: 'Search',
          url: `${pageOrigin}/flights`,
          page_id: 'flight-search',
          rel: 'up',
        },
        {
          label: 'Results',
          url: pageUrl,
          page_id: 'flight-results',
        },
      ],
    },
    present: {
      layout: 'list',
      sections: [
        {
          id: 'results',
          label: 'Available Flights',
          state_path: 'results',
          layout: 'table',
          item_key: 'id',
          primary_action: 'select_flight',
          columns: [
            { key: 'airline', label: 'Airline' },
            { key: 'departure', label: 'Depart' },
            { key: 'arrival', label: 'Arrive' },
            { key: 'duration', label: 'Duration', format: 'duration_min' },
            { key: 'price', label: 'Price', format: 'currency', align: 'right' },
            { key: 'stops', label: 'Stops' },
          ],
          sortable_by: ['price', 'duration', 'departure'],
          filterable_by: ['airline'],
          empty_message: 'No flights match your filters',
        },
      ],
      a11y: { page_label: 'Flight results', live_region: 'polite' },
    },
  };
}

/** In-memory results page state (filter / sort mutations). */
export type ResultsStore = Map<string, PageManifest>;

export function createResultsHandlers(
  pageOrigin: string,
  store: ResultsStore,
  bus?: EventBus,
): Record<string, ActionHandler> {
  return {
    filter: async ({ manifest, params }) => {
      const pageUrl = manifest.page.url;
      const u = new URL(pageUrl);
      const parsed = parseResultsPath(u.pathname);
      if (!parsed) {
        throw new Error('Invalid results page URL');
      }
      const pax = Number(u.searchParams.get('pax') ?? '1');
      const route: ResultsRoute = { ...parsed, pax };

      let flights = findFlights(route.origin, route.destination, route.date);
      flights = filterFlights(flights, {
        airline: params.airline !== undefined ? String(params.airline) : undefined,
        max_price: params.max_price !== undefined ? Number(params.max_price) : undefined,
        max_stops: params.max_stops !== undefined ? Number(params.max_stops) : undefined,
      });
      const sortBy = (params.sort_by as 'price' | 'duration' | 'departure' | undefined) ?? 'price';
      flights = sortFlights(flights, sortBy);

      const nextVersion = bumpVersion(manifest.page.version);
      const next = buildResultsManifest(pageOrigin, route, {
        flights,
        sortBy,
        version: nextVersion,
        etag: `W/"results-${nextVersion}"`,
      });
      store.set(pageUrl, next);
      store.set(canonicalizeResultsKey(pageUrl), next);
      bus?.publish('state.changed', {
        pageId: 'flight-results',
        pageUrl,
        version: nextVersion,
        baseVersion: manifest.page.version,
        hint: 'revalidate',
        pointers: ['/state/results', '/state/total_results'],
      });
      return { type: 'diff', nextManifest: next };
    },

    select_flight: async ({ params, manifest }) => {
      const flightId = String(params.flight_id);
      const table = manifest.state.results as TableStateNode;
      const ids = table.value.map((row) => String(row[0]));
      if (!ids.includes(flightId)) {
        throw new AppError('app.err.validation.param_range', {
          message: `Unknown flight_id: ${flightId}`,
          path: '/params/flight_id',
        });
      }
      return {
        type: 'navigate',
        url: `${pageOrigin}/booking/${encodeURIComponent(flightId)}`,
        mode: 'push',
      };
    },
  };
}

export function canonicalizeResultsKey(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}?${u.searchParams.toString()}`;
  } catch {
    return url;
  }
}
