import {
  AppError,
  bumpVersion,
  buildAsyncPendingManifest,
  buildAsyncFailedSoftError,
  createCancelOperationHandler,
  updateAsyncJobStatus,
  type ActionHandler,
  type AsyncJobStore,
  type GetManifest,
  type PageManifest,
} from '@agent-page/server';
import { findFlightById, type FlightRecord } from '../data/flights.js';
import type { EventBus } from '../events.js';
import { buildSessionStateNode } from '../sessions.js';
import { createOrderFromFlight, type OrderStore } from './order.js';

export type BookingStore = Map<string, PageManifest>;

/** Extra booking-job context keyed by job id (slow PNR simulation). */
export interface BookingJobContext {
  flightId: string;
  email: string;
  passport: string;
  seatPref: string;
  /** Number of status GETs observed (drives queued→running→succeeded). */
  polls: number;
}

export type BookingJobContextStore = Map<string, BookingJobContext>;

export const DEFAULT_BOOKING_POLL_INTERVAL_MS = 1500;

export function parseBookingPath(pathname: string): string | null {
  const m = /^\/booking\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

export function parseOperationsPath(pathname: string): string | null {
  const m = /^\/operations\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  return decodeURIComponent(m[1]!);
}

export function confirmationCodeFor(flight: FlightRecord): string {
  // Stable demo code matching D.6 style for fl-002; unique-ish otherwise.
  if (flight.id === 'fl-002') return 'EM-998877';
  const n = flight.id.replace(/\D/g, '').padStart(6, '0').slice(-6);
  const prefix = flight.airline
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2)
    .padEnd(2, 'X');
  return `${prefix}-${n}`;
}

export function buildBookingManifest(
  pageOrigin: string,
  flight: FlightRecord,
  options?: {
    version?: string;
    etag?: string;
    bookingStatus?: 'pending' | 'confirmed' | 'failed';
    confirmationCode?: string;
  },
): PageManifest {
  const version = options?.version ?? 'v5';
  const status = options?.bookingStatus ?? 'pending';
  const pageUrl = `${pageOrigin}/booking/${flight.id}`;

  const manifest: PageManifest = {
    app: '1.0',
    page: {
      id: 'booking-payment',
      url: pageUrl,
      title: `Complete Booking - ${flight.flight_no}`,
      version,
      etag: options?.etag ?? 'W/"book-1"',
      description: 'Confirm and pay for the selected flight',
    },
    state: {
      flight: {
        type: 'object',
        label: 'Selected flight',
        value: {
          airline: { type: 'string', value: flight.airline },
          flight: { type: 'string', value: flight.flight_no },
          price: {
            type: 'number',
            value: flight.price,
            unit: 'GBP',
            scale: 2,
            label: 'Fare',
          },
        },
      },
      /** Money node for confirm.amount_path: integer minor units + scale. */
      selected_price: {
        type: 'number',
        value: flight.price,
        unit: 'GBP',
        scale: 2,
        label: 'Total due',
      },
      booking_status: {
        type: 'enum',
        value: status,
        options: ['pending', 'confirmed', 'failed'],
        label: 'Status',
      },
      session: buildSessionStateNode(undefined),
    },
    actions: {},
    navigation: {
      breadcrumb: [
        {
          label: 'Search',
          url: `${pageOrigin}/flights`,
          page_id: 'flight-search',
          rel: 'up',
        },
        {
          label: 'Booking',
          url: pageUrl,
          page_id: 'booking-payment',
        },
      ],
    },
    present: {
      layout: 'detail',
      components: {
        pay: {
          type: 'button',
          action_id: 'confirm_booking',
          label: 'Pay now',
          variant: 'primary',
        },
      },
    },
  };

  if (status === 'pending') {
    manifest.actions = {
      confirm_booking: {
        description: 'Book this flight and charge the payment method on file (slow PNR)',
        kind: 'mutate',
        input: {
          email: {
            type: 'string',
            required: true,
            pattern: '^[^@]+@[^@]+\\.[^@]+$',
            description: 'Contact email',
          },
          passport: {
            type: 'string',
            required: true,
            min_length: 5,
            max_length: 20,
            description: 'Passport number',
          },
          seat_pref: {
            type: 'enum',
            options: ['aisle', 'window', 'middle'],
            default: 'aisle',
          },
        },
        output: { state_diff: true },
        side_effect: 'financial',
        requires_confirmation: true,
        auth: 'session',
        idempotent: false,
        timeout_ms: 30000,
        param_mode: 'strict',
        requires_etag_match: true,
        async: true,
        confirm: {
          title: 'Confirm payment',
          body_template:
            'Pay {state.selected_price.value} {state.selected_price.unit} for flight {state.flight.value.flight.value}?',
          amount_path: 'selected_price',
        },
      },
    };
  }

  if (options?.confirmationCode) {
    manifest.state.confirmation_code = {
      type: 'string',
      value: options.confirmationCode,
      label: 'Confirmation',
    };
  }

  return manifest;
}

function newJobId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createBookingHandlers(
  pageOrigin: string,
  jobContexts: BookingJobContextStore,
): Record<string, ActionHandler> {
  return {
    confirm_booking: async ({ manifest, params }) => {
      const flightId = parseBookingPath(new URL(manifest.page.url).pathname);
      if (!flightId) throw new Error('Invalid booking URL');
      const flight = findFlightById(flightId);
      if (!flight) throw new Error(`Unknown flight: ${flightId}`);

      const status = (manifest.state.booking_status as { value?: string } | undefined)?.value;
      if (status === 'confirmed') {
        throw new AppError('app.err.action.unavailable', {
          message: 'Booking already confirmed',
        });
      }

      const jobId = newJobId();
      const statusUrl = `${pageOrigin}/operations/${jobId}`;

      jobContexts.set(jobId, {
        flightId,
        email: String(params.email ?? ''),
        passport: String(params.passport ?? ''),
        seatPref: String(params.seat_pref ?? 'aisle'),
        polls: 0,
      });

      // Form D: middleware registers the AsyncJob and emits 202 + operation_status.
      // Booking store is updated when the status poll reaches succeeded.
      return {
        type: 'async',
        jobId,
        statusUrl,
        pollIntervalMs: DEFAULT_BOOKING_POLL_INTERVAL_MS,
        status: 'queued',
        progress: 0,
      };
    },
  };
}

/**
 * Advance slow-PNR simulation: queued → running → succeeded.
 * First status GET: running; second: succeeded (updates booking store).
 */
export async function advanceBookingJob(
  pageOrigin: string,
  jobId: string,
  asyncStore: AsyncJobStore,
  jobContexts: BookingJobContextStore,
  bookingStore: BookingStore,
  orderStore?: OrderStore,
  bus?: EventBus,
): Promise<PageManifest | null> {
  const job = await asyncStore.get(jobId);
  if (!job) return null;

  const ctx = jobContexts.get(jobId);
  const statusUrl = job.statusUrl;

  if (job.status === 'cancelled') {
    return buildAsyncPendingManifest({
      page: {
        id: 'operation_status',
        url: statusUrl,
        title: 'Booking operation',
        version: `v-cancelled`,
      },
      jobId,
      statusUrl,
      status: 'cancelled',
      pollIntervalMs: job.pollIntervalMs,
      actions: {},
    });
  }

  if (job.status === 'failed') {
    const failed = buildAsyncPendingManifest({
      page: {
        id: 'operation_status',
        url: statusUrl,
        title: 'Booking operation',
        version: 'v-failed',
      },
      jobId,
      statusUrl,
      status: 'failed',
      pollIntervalMs: job.pollIntervalMs,
      actions: {},
      softError: {
        code: 'app.err.action.async_failed',
        message: 'PNR creation failed',
      },
    });
    failed.error = buildAsyncFailedSoftError({
      jobId,
      message: 'PNR creation failed',
      recoverable_actions: ['confirm_booking'],
    });
    return failed;
  }

  if (job.status === 'succeeded') {
    const flight = ctx ? findFlightById(ctx.flightId) : undefined;
    const code = flight ? confirmationCodeFor(flight) : undefined;
    const m = buildAsyncPendingManifest({
      page: {
        id: 'operation_status',
        url: statusUrl,
        title: 'Booking operation',
        version: 'v-succeeded',
      },
      jobId,
      statusUrl,
      status: 'succeeded',
      progress: 1,
      pollIntervalMs: job.pollIntervalMs,
      actions: {},
    });
    if (code) {
      m.state.confirmation_code = {
        type: 'string',
        value: code,
        label: 'Confirmation',
      };
    }
    if (ctx) {
      m.navigation = {
        related: [
          {
            label: 'View booking',
            url: `${pageOrigin}/booking/${ctx.flightId}`,
            page_id: 'booking-payment',
          },
        ],
      };
    }
    return m;
  }

  // In-flight: advance on each poll
  if (!ctx) {
    return buildAsyncPendingManifest({
      page: {
        id: 'operation_status',
        url: statusUrl,
        title: 'Booking operation',
        version: `v-${job.status}`,
      },
      jobId,
      statusUrl,
      status: job.status,
      progress: job.progress,
      pollIntervalMs: job.pollIntervalMs,
    });
  }

  ctx.polls += 1;
  jobContexts.set(jobId, ctx);

  if (job.status === 'queued' || ctx.polls === 1) {
    await updateAsyncJobStatus(asyncStore, jobId, 'running', 0.4);
    return buildAsyncPendingManifest({
      page: {
        id: 'operation_status',
        url: statusUrl,
        title: 'Creating PNR',
        version: `v-run-${ctx.polls}`,
      },
      jobId,
      statusUrl,
      status: 'running',
      progress: 0.4,
      pollIntervalMs: job.pollIntervalMs,
    });
  }

  // Second+ poll while running → succeed and materialize booking
  const flight = findFlightById(ctx.flightId);
  if (!flight) {
    await updateAsyncJobStatus(asyncStore, jobId, 'failed');
    return advanceBookingJob(
      pageOrigin,
      jobId,
      asyncStore,
      jobContexts,
      bookingStore,
      orderStore,
      bus,
    );
  }

  const code = confirmationCodeFor(flight);
  const confirmed = buildBookingManifest(pageOrigin, flight, {
    version: bumpVersion('v5'),
    etag: 'W/"book-confirmed"',
    bookingStatus: 'confirmed',
    confirmationCode: code,
  });
  confirmed.actions = {};
  const orderId = `ord-${ctx.flightId}`;
  if (orderStore) {
    const order = createOrderFromFlight(pageOrigin, flight, orderId, 'paid');
    orderStore.set(orderId, order);
    confirmed.navigation = {
      ...(confirmed.navigation ?? {}),
      related: [
        {
          label: 'View order',
          url: `${pageOrigin}/orders/${orderId}`,
          page_id: 'flight-order',
        },
      ],
    };
    bus?.publish('order.updated', {
      pageId: 'flight-order',
      pageUrl: `${pageOrigin}/orders/${orderId}`,
      version: 'o-1',
      hint: 'revalidate',
      pointers: ['/state/order'],
    });
  }
  bookingStore.set(confirmed.page.url, confirmed);
  bookingStore.set(`/booking/${ctx.flightId}`, confirmed);

  await updateAsyncJobStatus(asyncStore, jobId, 'succeeded', 1);
  const updated = await asyncStore.get(jobId);
  if (updated) {
    updated.resultManifest = confirmed;
    await asyncStore.set(updated);
  }

  const done = buildAsyncPendingManifest({
    page: {
      id: 'operation_status',
      url: statusUrl,
      title: 'Booking complete',
      version: `v-done-${ctx.polls}`,
    },
    jobId,
    statusUrl,
    status: 'succeeded',
    progress: 1,
    pollIntervalMs: job.pollIntervalMs,
    actions: {},
  });
  done.state.confirmation_code = {
    type: 'string',
    value: code,
    label: 'Confirmation',
  };
  done.navigation = {
    related: [
      {
        label: 'View booking',
        url: `${pageOrigin}/booking/${ctx.flightId}`,
        page_id: 'booking-payment',
      },
    ],
  };
  return done;
}

export function createOperationsGetManifest(
  pageOrigin: string,
  asyncStore: AsyncJobStore,
  jobContexts: BookingJobContextStore,
  bookingStore: BookingStore,
  orderStore?: OrderStore,
  bus?: EventBus,
): GetManifest {
  return async ({ url }) => {
    const { pathname } = new URL(url);
    const jobId = parseOperationsPath(pathname);
    if (!jobId) return null;
    return advanceBookingJob(
      pageOrigin,
      jobId,
      asyncStore,
      jobContexts,
      bookingStore,
      orderStore,
      bus,
    );
  };
}

export function createOperationsHandlers(
  asyncStore: AsyncJobStore,
  jobContexts: BookingJobContextStore,
): Record<string, ActionHandler> {
  return {
    cancel_operation: async ({ manifest }) => {
      const jobId = parseOperationsPath(new URL(manifest.page.url).pathname);
      if (!jobId) {
        throw new AppError('app.err.page.not_found', { message: 'Unknown operation' });
      }
      const job = await asyncStore.get(jobId);
      if (
        !job ||
        job.status === 'succeeded' ||
        job.status === 'failed' ||
        job.status === 'cancelled'
      ) {
        throw new AppError('app.err.action.unavailable', {
          message: 'Operation cannot be cancelled',
        });
      }
      const cancel = createCancelOperationHandler(asyncStore, jobId);
      const result = await cancel({ manifest });
      // Keep context for audit; do not finalize booking
      void jobContexts;
      return result;
    },
  };
}

export function getOrBuildBooking(
  pageOrigin: string,
  flightId: string,
  store: BookingStore,
): PageManifest | null {
  const cached =
    store.get(`${pageOrigin}/booking/${flightId}`) ?? store.get(`/booking/${flightId}`);
  if (cached) return cached;
  const flight = findFlightById(flightId);
  if (!flight) return null;
  const built = buildBookingManifest(pageOrigin, flight);
  store.set(built.page.url, built);
  store.set(`/booking/${flightId}`, built);
  return built;
}
