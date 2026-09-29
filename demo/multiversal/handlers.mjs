/**
 * Multiversal Airways — action handlers (real state mutations).
 * clone → mutate → bump version → store → push event → full manifest back.
 * Built by makeMvaHandlers() with the server's plumbing injected.
 */

export function makeMvaHandlers({ origin, bump, storeManifest, pushEvent, AppError }) {
  const mutate = (ctx, fn) => {
    const next = structuredClone(ctx.manifest);
    fn(next);
    next.page.version = bump(next.page.version);
    storeManifest(next);
    pushEvent(next.page.url, next, null);
    return { type: 'full', manifest: next };
  };

  const seatRow = (seat, seatMap) => {
    const row = seatMap?.value?.find((r) => r[0] === seat);
    return row && row[4] === 'available' ? row : null;
  };

  return {
    sort_results: async (ctx) =>
      mutate(ctx, (next) => {
        const list = next.state.flights?.value ?? [];
        const farePrice = (f) => f?.value?.fares?.value?.[0]?.value?.price?.value ?? 0;
        const field = (f, k) => f?.value?.[k]?.value;
        const by = String(ctx.params.sort_by ?? 'departure');
        if (String(ctx.params.direct_only ?? '') === 'true' || ctx.params.direct_only === true) {
          next.state.flights.value = list.filter((f) => field(f, 'stops') === 0);
        } else {
          next.state.flights.value = [...list].sort((a, b) =>
            by === 'price'
              ? farePrice(a) - farePrice(b)
              : by === 'duration'
                ? field(a, 'duration_min') - field(b, 'duration_min')
                : by === 'arrival'
                  ? String(field(a, 'arrive')).localeCompare(String(field(b, 'arrive')))
                  : String(field(a, 'depart')).localeCompare(String(field(b, 'depart'))),
          );
        }
        next.state.sort_by.value = by;
      }),

    select_seat: async (ctx) => {
      const seat = String(ctx.params.seat ?? '').toUpperCase();
      const leg = String(ctx.params.leg ?? 'outbound');
      const row = seatRow(seat, ctx.manifest.state.seat_map);
      if (!row)
        throw new AppError('app.err.validation.param_value', {
          message: `Seat ${seat} is not available`,
        });
      return mutate(ctx, (next) => {
        const key = leg === 'return' ? 'pax1_return' : 'pax1_outbound';
        next.state.selected.value[key].value = seat;
        const fees = Object.values(next.state.selected.value)
          .map((n) => seatRow(n.value, next.state.seat_map)?.[5] ?? 0)
          .reduce((a, b) => a + b, 0);
        next.state.seat_fees.value = fees;
      });
    },

    update_extras: async (ctx) =>
      mutate(ctx, (next) => {
        const p = ctx.params;
        const on = (v) => v === true || v === 'true' || v === 'on';
        const bags = Math.min(3, Math.max(0, Number(p.bag_23 ?? 1)));
        const chosen = next.state.chosen.value;
        chosen.bag_23.value = bags;
        chosen.meal_upgrade.value = String(p.meal_upgrade ?? 'standard');
        for (const k of ['lounge', 'wifi', 'insurance']) {
          if (chosen[k]) chosen[k].value = on(p[k]) ? 'yes' : 'no';
        }
        next.state.extras_total.value =
          bags * 3800 +
          (chosen.meal_upgrade.value === 'standard' ? 0 : 1400) +
          (on(p.lounge) ? 4500 : 0) +
          (on(p.wifi) ? 1199 : 0) +
          (on(p.priority) ? 900 : 0) +
          (on(p.insurance) ? 2200 : 0) +
          (on(p.offset) ? 450 : 0);
      }),

    find_booking: async (ctx) => {
      const ref = String(ctx.params.booking_ref ?? '').toUpperCase();
      const surname = String(ctx.params.surname ?? '').toLowerCase();
      const ok =
        (ref === 'MV4X8R' && surname === 'ashford') || (ref === 'MV9T2Q' && surname === 'doe');
      if (!ok)
        throw new AppError('app.err.validation.param_value', {
          message: `No booking found for ${ref} / ${surname}`,
        });
      return { type: 'navigate', url: `${origin}/app/mva/booking`, mode: 'push' };
    },

    change_seat: async (ctx) =>
      mutate(ctx, (next) => {
        const seat = String(ctx.params.seat ?? '').toUpperCase();
        const leg = ctx.params.leg === 'return' ? 'return' : 'outbound';
        const seats = next.state.booking.value.seats.value.split('·');
        seats[leg === 'outbound' ? 0 : 1] = `${seat}${leg === 'outbound' ? ' (out)' : ' (ret)'}`;
        next.state.booking.value.seats.value = seats.join('· ');
      }),

    add_bag: async (ctx) =>
      mutate(ctx, (next) => {
        next.state.booking.value.bags.value = Math.min(
          3,
          Math.max(0, Number(ctx.params.bags ?? 0)),
        );
      }),

    request_upgrade: async (ctx) =>
      mutate(ctx, (next) => {
        const leg = ctx.params.leg === 'return' ? 'return_leg' : 'outbound';
        const cur = next.state.booking.value[leg].value;
        next.state.booking.value[leg].value = `${cur} · upgraded to Voyager Plus`;
        next.state.booking.value.cabin.value = 'Voyager Plus (premium economy)';
      }),

    cancel_booking: async (ctx) =>
      mutate(ctx, (next) => {
        next.state.booking.value.status.value = 'cancelled — refund pending';
        delete next.actions.cancel_booking;
        delete next.actions.request_upgrade;
      }),

    sign_in: async (ctx) =>
      mutate(ctx, (next) => {
        const who = String(ctx.params.user ?? 'remy');
        next.state.member.value.name.value = who === 'jane' ? 'Jane Doe' : 'Remy Ashford';
        next.state.member.value.tier.value = who === 'jane' ? 'Platinum' : 'Gold';
        next.state.member.value.points.value = who === 'jane' ? 48200 : 12400;
        next.state.hint.value = 'Signed in. Trips and points are live.';
      }),

    status_lookup: async (ctx) =>
      mutate(ctx, (next) => {
        const fn = String(ctx.params.flight_no ?? '').toUpperCase();
        const date = String(ctx.params.date ?? '');
        const row = next.state.board.value.find((r) => r[0] === fn);
        next.state.looked_up.value = row
          ? `${fn} on ${date}: ${row[4].replace('_', ' ')}${row[5] !== '—' ? ` · gate ${row[5]}` : ''}`
          : `${fn} on ${date}: not found on today's board`;
      }),

    apply_points: async (ctx) =>
      mutate(ctx, (next) => {
        const pts = Math.max(0, Number(ctx.params.points_amount ?? 0));
        next.state.total_due.value = Math.max(
          0,
          next.state.total_due.value - Math.floor(pts / 100) * 100,
        );
        next.state.order.value.status.value = `awaiting_payment (${pts} points applied)`;
      }),

    /* ---- content & service page actions ---- */
    check_docs: async (ctx) =>
      mutate(ctx, (next) => {
        const dest = String(ctx.params.to ?? '').toUpperCase();
        const nat = String(ctx.params.nationality ?? 'gb');
        const rows = {
          gb: 'UK passport: ESTA/visa rules in the table apply; passport valid for your stay.',
          ie: 'Irish passport: same UK/US rules; EU residents card not needed for visits.',
          us: 'US passport: check return rules — most destinations visa-free under 90 days.',
        };
        next.state.docs_result.value = `${dest} travel, ${nat.toUpperCase()} passport — ${rows[nat] ?? 'Verify requirements with the destination embassy — rules vary.'}`;
      }),

    request_assistance: async (ctx) =>
      mutate(ctx, (next) => {
        const ref = String(ctx.params.booking_ref ?? '').toUpperCase() || 'your next booking';
        const kind = String(ctx.params.type ?? 'mobility').replaceAll('_', ' ');
        next.state.request_logged.value = `Request logged: ${kind} assistance for ${ref}. Our care team confirms within 24h — ref MV-A${String(ref).length}${Math.floor(((kind.length * 371) % 900) + 100)}.`;
      }),

    claim_refund: async (ctx) =>
      mutate(ctx, (next) => {
        const ref = String(ctx.params.booking_ref ?? '').toUpperCase();
        const ok = ['MV4X8R', 'MV9T2Q'].includes(ref);
        if (!ok)
          throw new AppError('app.err.validation.param_value', {
            message: `No booking found for ${ref}`,
          });
        const kind = String(ctx.params.claim_type ?? 'refund');
        next.state.claim_status.value = `Claim opened: ${kind} for ${ref} (${String(ctx.params.surname).toLowerCase()}) — case MV-C${Math.floor(((ref.charCodeAt(0) * 97) % 900) + 100)}. We answer within 14 days.`;
      }),

    subscribe: async (ctx) =>
      mutate(ctx, (next) => {
        next.state.subscribed.value = `Subscribed: ${String(ctx.params.email ?? '')} — deals every Tuesday, no spam in any timeline.`;
      }),

    request_quote: async (ctx) =>
      mutate(ctx, (next) => {
        const n = Number(ctx.params.passengers ?? 10);
        next.state.quote_status.value = `Quote requested: ${n} passengers to ${ctx.params.to} departing ${ctx.params.depart}. A coordinator emails ${ctx.params.email} within 1 working day — ref MV-G${n}${Math.floor(((String(ctx.params.contact_name).length * 137) % 90) + 10)}.`;
      }),
  };
}
