/**
 * British Airways booking demo — APP page manifests for a full booking flow:
 * search → outbound → inbound → fare brand → seats → passengers → pay → PNR.
 *
 * buildBaPages(origin) returns Map<slug, manifest>. All URLs point at the demo
 * server (`${origin}/app/ba/<slug>`); action `output.navigates_to` chains pages.
 * Pages are split across search.mjs (search & flight selection) and
 * checkout.mjs (booking & payment) to stay under the 800-line file cap.
 */

import { buildSearchPages } from './search.mjs';
import { buildCheckoutPages } from './checkout.mjs';

export function buildBaPages(origin) {
  return new Map([...buildSearchPages(origin), ...buildCheckoutPages(origin)]);
}
