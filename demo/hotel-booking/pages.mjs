/**
 * Hotel booking demo — APP page manifests for "Halvern House", a fictional
 * boutique hotel collection: search → results → property → rooms → checkout
 * → confirmation, plus home, manage booking, the collection/destinations,
 * offers & gift cards, dining & spa, meetings & events, loyalty, reviews
 * and help.
 */

import { buildFlowPages } from './flow.mjs';
import { buildHomePages } from './home.mjs';
import { buildContentPages } from './content.mjs';
import { buildServicePages } from './services.mjs';

export function buildHotelPages(origin) {
  return new Map([
    ...buildHomePages(origin),
    ...buildFlowPages(origin),
    ...buildContentPages(origin),
    ...buildServicePages(origin),
  ]);
}
