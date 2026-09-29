/**
 * Multiversal Airways — feature-rich airline demo: search → results → fares →
 * seats → extras → passengers → review → pay → confirmation, plus manage
 * booking, check-in, flight status, and a loyalty account — plus the
 * marketing & support pages a real airline needs (content.mjs,
 * services.mjs): destinations, cabins, baggage, fare finder, travel
 * docs, assistance, disruption, loyalty, lounges, partners, help,
 * travel extras, group bookings.
 *
 * buildMvaPages(origin) returns Map<slug, manifest>. All URLs point at
 * `${origin}/app/mva/<slug>`; action `output.navigates_to` chains pages.
 * Split across search/booking/pay/aftersale to stay under the 800-line cap.
 */

import { buildSearchPages } from './search.mjs';
import { buildBookingPages } from './booking.mjs';
import { buildPayPages } from './pay.mjs';
import { buildAftersalePages } from './aftersale.mjs';
import { buildContentPages } from './content.mjs';
import { buildServicePages } from './services.mjs';

export function buildMvaPages(origin) {
  return new Map([
    ...buildSearchPages(origin),
    ...buildBookingPages(origin),
    ...buildPayPages(origin),
    ...buildAftersalePages(origin),
    ...buildContentPages(origin),
    ...buildServicePages(origin),
  ]);
}
