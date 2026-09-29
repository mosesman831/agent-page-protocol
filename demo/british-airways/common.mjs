/**
 * British Airways booking demo — APP page manifests (shared URL + data helpers).
 * Part of buildBaPages: see pages.mjs for the assembled Map.
 */

import { str, num, obj, money, enumN } from '../lib/nodes.mjs';

export const BA = (o, slug) => `${o}/app/ba/${slug}`;

export const AIRPORTS_FROM = ['lhr', 'lgw', 'lcy'];
export const AIRPORTS_TO = ['jfk', 'ewr', 'bos', 'ord', 'lax', 'sfo', 'mia', 'dxb', 'sin'];
export const CABINS = ['economy', 'premium_economy', 'business', 'first'];
export const MEAL = ['standard', 'vegetarian', 'vegan', 'halal', 'kosher', 'gluten_free', 'child'];
export const TITLES = ['mr', 'ms', 'mrs', 'dr', 'miss'];
export const COUNTRIES = ['gb', 'us', 'ie', 'de', 'fr', 'ae', 'in'];

export function flightCard({
  id,
  fn,
  dep,
  arr,
  depT,
  arrT,
  aircraft,
  dur,
  co2,
  stops,
  price,
  fareType,
}) {
  return obj(
    {
      id: str(id),
      flight_no: str(fn, 'Flight'),
      depart: str(dep, 'Departs'),
      arrive: str(arr, 'Arrives'),
      dep_terminal: str(depT, 'Terminal'),
      arr_terminal: str(arrT, 'Terminal'),
      aircraft: str(aircraft, 'Aircraft'),
      duration_min: num(dur, { label: 'Duration (min)' }),
      stops: num(stops, { label: 'Stops' }),
      co2_kg: num(co2, { unit: 'kg', label: 'CO2e per passenger' }),
      fare_type: enumN(fareType, ['economy', 'premium_economy', 'business', 'first']),
      price_from: money(price, 'GBP'),
      seats_left: num(4, { label: 'Seats left at this fare' }),
      operated_by: str('British Airways', 'Operated by'),
    },
    fn,
  );
}
