/**
 * Halvern House — action handlers (real state mutations).
 * clone → mutate → bump version → store → push event → full manifest back.
 * Built by makeHotelHandlers() with the server's plumbing injected.
 */

import { str, num, obj } from '../lib/nodes.mjs';
import { RESULTS, hotelCard, SEED_BOOKINGS, HOUSES } from './common.mjs';

export function makeHotelHandlers({ origin, bump, storeManifest, pushEvent, AppError }) {
  const mutate = (ctx, fn) => {
    const next = structuredClone(ctx.manifest);
    fn(next);
    next.page.version = bump(next.page.version);
    storeManifest(next);
    pushEvent(next.page.url, next, null);
    return { type: 'full', manifest: next };
  };

  const on = (v) => v === true || v === 'true' || v === 'on';
  const field = (card, k) => card?.value?.[k]?.value;

  return {
    /* results — filter & sort the stays list */
    apply_filters: async (ctx) =>
      mutate(ctx, (next) => {
        const p = ctx.params;
        let list = [...RESULTS];
        const stars = String(p.min_stars ?? 'any');
        if (stars !== 'any') list = list.filter((h) => h.stars >= Number(stars));
        if (p.max_nightly != null && p.max_nightly !== '')
          list = list.filter((h) => h.nightly <= Number(p.max_nightly) * 100);
        if (on(p.free_cancellation)) list = list.filter((h) => h.freeCancel);
        if (on(p.breakfast_included)) list = list.filter((h) => h.breakfast);
        if (on(p.collection_only)) list = list.filter((h) => h.name.includes('Halvern'));
        const by = String(p.sort_by ?? 'recommended');
        if (by === 'price_low') list.sort((a, b) => a.nightly - b.nightly);
        else if (by === 'price_high') list.sort((a, b) => b.nightly - a.nightly);
        else if (by === 'rating') list.sort((a, b) => b.rating - a.rating);
        else if (by === 'distance') list.sort((a, b) => a.distKm - b.distKm);
        next.state.hotels.value = list.map(hotelCard);
        next.state.sort_by.value = by;
        next.state.results_total.value = list.length;
      }),

    /* manage booking — find a reservation, then land on its page */
    find_booking: async (ctx) => {
      const ref = String(ctx.params.booking_ref ?? '').toUpperCase();
      const surname = String(ctx.params.surname ?? '').toLowerCase();
      const b = SEED_BOOKINGS[ref];
      if (!b || b.surname !== surname)
        throw new AppError('app.err.validation.param_value', {
          message: `No booking found for ${ref} / ${surname || '—'}`,
        });
      return { type: 'navigate', url: `${origin}/app/hotel/booking`, mode: 'push' };
    },

    /* booking page — real mutations on the seeded reservation */
    add_breakfast: async (ctx) =>
      mutate(ctx, (next) => {
        const guests = Math.min(4, Math.max(1, Number(ctx.params.guests ?? 2)));
        const nights = 3;
        const cost = guests * nights * 2800;
        const bk = next.state.booking.value;
        bk.extras.value = `Breakfast for ${guests}, all 3 mornings — £${(cost / 100).toFixed(0)}`;
        bk.paid.value += cost;
      }),

    request_upgrade: async (ctx) =>
      mutate(ctx, (next) => {
        const to = String(ctx.params.to ?? 'junior_suite');
        const name =
          to === 'observatory_suite' ? 'The Observatory Suite' : 'Junior Suite (Castle view)';
        const perNight = to === 'observatory_suite' ? 19500 : 6800;
        const bk = next.state.booking.value;
        bk.room.value = `${name} — upgraded`;
        bk.extras.value = `Upgrade confirmed +£${(perNight / 100).toFixed(0)}/night`;
        bk.paid.value += perNight * 3;
      }),

    contact_house: async (ctx) =>
      mutate(ctx, (next) => {
        const topic = String(ctx.params.topic ?? 'other').replaceAll('_', ' ');
        const msg = String(ctx.params.message ?? '').slice(0, 200);
        next.state.messages.value.unshift(
          obj(
            {
              from: str('You', 'From'),
              topic: str(topic, 'Topic'),
              text: str(msg, 'Message'),
              reply: str('The house replies within the hour (7am–11pm)', 'Reply'),
            },
            `Message — ${topic}`,
          ),
        );
      }),

    cancel_booking: async (ctx) =>
      mutate(ctx, (next) => {
        if (next.state.booking?.value?.status) {
          next.state.booking.value.status.value = 'cancelled — refund to card within 5 days';
          delete next.actions.cancel_booking;
          delete next.actions.request_upgrade;
        } else if (next.state.order?.value) {
          next.state.order.value.status = 'cancelled';
          delete next.actions.cancel_booking;
        }
      }),

    /* deals — gift cards + newsletter */
    buy_gift_card: async (ctx) =>
      mutate(ctx, (next) => {
        const amount = Number(ctx.params.amount ?? 100);
        const how = ctx.params.delivery === 'boxed' ? 'boxed card by post' : 'e-card';
        const ref = `HVN-G${Math.floor(100 + Math.random() * 900)}${String(amount).padStart(3, '0')}`;
        next.state.gift_status.value = `Ordered: £${amount} gift card (${how}) — reference ${ref}.`;
      }),

    subscribe: async (ctx) =>
      mutate(ctx, (next) => {
        next.state.subscribed.value = `Subscribed: ${String(
          ctx.params.email ?? '',
        )} — offers land every other Friday, unsubscribe any time.`;
      }),

    /* dining — table request */
    request_table: async (ctx) =>
      mutate(ctx, (next) => {
        const venue = String(ctx.params.venue ?? 'forth-table');
        const vname =
          {
            'forth-table': 'The Forth Table',
            'lantern-bar': 'The Lantern Bar',
            'tarn-kitchen': 'Tarn Kitchen',
            orangery: 'The Orangery',
            jardin: 'Le Jardin',
          }[venue] ?? venue;
        next.state.table_status.value = `Requested: ${vname} for ${ctx.params.party ?? 2} on ${ctx.params.date} at ${ctx.params.time}. The house confirms by text within an hour.`;
      }),

    /* events — quote request */
    request_quote: async (ctx) =>
      mutate(ctx, (next) => {
        const kind = String(ctx.params.event_type ?? 'meeting');
        const n = Number(ctx.params.guests ?? 24);
        next.state.quote_status.value = `Quote requested: ${kind} for ${n} guests on ${ctx.params.date}. An events planner emails ${ctx.params.email} within one working day — ref HVN-E${n}${Math.floor(
          ((String(ctx.params.contact_name ?? '').length * 137) % 90) + 10,
        )}.`;
      }),

    /* loyalty — join Halvern Circle */
    join_circle: async (ctx) =>
      mutate(ctx, (next) => {
        const name = `${ctx.params.first_name ?? ''} ${ctx.params.last_name ?? ''}`.trim();
        const house = HOUSES.find((h) => h.id === ctx.params.home_house)?.name ?? 'The Observatory';
        const memberNo = `HC${String(name.length * 7919)
          .slice(0, 4)
          .padStart(4, '0')}`;
        next.state.member.value.status.value = `Key member — welcome, ${name}`;
        next.state.member.value.member_no.value = memberNo;
        next.state.join_status.value = `Joined: ${name} is now Halvern Circle member ${memberNo} (favourite house: ${house}). Member rates apply from your next search.`;
        delete next.actions.join_circle;
      }),

    /* reviews — helpful vote + new review */
    vote_helpful: async (ctx) =>
      mutate(ctx, (next) => {
        const id = String(ctx.params.review_id ?? '');
        const card = next.state.reviews.value.find((r) => field(r, 'id') === id);
        if (!card)
          throw new AppError('app.err.validation.param_value', {
            message: `Unknown review ${id}`,
          });
        card.value.helpful.value += 1;
      }),

    write_review: async (ctx) =>
      mutate(ctx, (next) => {
        const house = HOUSES.find((h) => h.id === ctx.params.house)?.name ?? 'the collection';
        const score = Number(ctx.params.score ?? 10);
        next.state.reviews.value.unshift(
          obj(
            {
              id: str(`rev-${String(Date.now()).slice(-6)}`),
              title: str(String(ctx.params.title ?? 'My stay'), 'Review'),
              author: str(`You — ${house}`, 'Guest'),
              score: num(score, { label: 'Score', max: 10 }),
              date: str(String(ctx.params.stayed ?? ''), 'Stayed'),
              helpful: num(0, { label: 'Helpful votes' }),
            },
            String(ctx.params.title ?? 'My stay'),
          ),
        );
        next.state.review_status.value = `Thanks — your review of ${house} is live.`;
        next.state.summary.value.count.value += 1;
      }),

    /* help — contact */
    contact_us: async (ctx) =>
      mutate(ctx, (next) => {
        const topic = String(ctx.params.topic ?? 'other');
        const ref = String(ctx.params.booking_ref ?? '').toUpperCase();
        next.state.contact_status.value = `Received: ${topic.replaceAll('_', ' ')}${ref ? ` for ${ref}` : ''} — replies go to ${ctx.params.email} within a day. Ticket HVN-C${Math.floor(
          ((String(ctx.params.message ?? '').length * 733) % 900) + 100,
        )}.`;
      }),
  };
}
