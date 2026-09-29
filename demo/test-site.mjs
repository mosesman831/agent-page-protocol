#!/usr/bin/env node
/**
 * test:site — boots the demo server on an ephemeral port and exercises the
 * /site/<site>/<slug> negotiated surface end-to-end:
 *   - Accept negotiation (manifest vs generated HTML)
 *   - HTML form POST → wire Action Request → 303 to next page
 *   - mutate action re-rendering with updated state
 *   - requires_confirmation flow (428 → confirm page → confirmed repost)
 *   - error rendering for invalid params
 * Requires `npm run build` (the full protocol stack).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8950 + Math.floor(Math.random() * 40);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, [join(ROOT, 'demo/serve.mjs')], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push([name, ok]);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const form = async (path, fields) =>
  fetch(`${BASE}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin: BASE,
    },
    body: new URLSearchParams(fields).toString(),
  });

function waitForServer(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('demo server did not start')), timeoutMs);
    const poll = async () => {
      try {
        const res = await fetch(`${BASE}/.well-known/agent-page`);
        if (res.ok) {
          clearTimeout(timer);
          resolve();
          return;
        }
      } catch {
        /* not up yet */
      }
      setTimeout(poll, 150);
    };
    void poll();
  });
}

try {
  await waitForServer();

  // 1. GET /site html
  {
    const res = await fetch(`${BASE}/site/mva/home`, { headers: { accept: 'text/html' } });
    const html = await res.text();
    check(
      'GET /site/mva/home → HTML',
      res.status === 200 &&
        res.headers.get('content-type')?.includes('text/html') &&
        html.includes('Multiversal') &&
        html.includes('application/vnd.agent-page+json'),
      res.headers.get('content-type'),
    );
  }

  // 2. GET /site manifest via negotiation
  {
    const res = await fetch(`${BASE}/site/mva/home`, {
      headers: { accept: 'application/vnd.agent-page+json' },
    });
    const doc = await res.json();
    check(
      'GET /site/mva/home → manifest',
      res.status === 200 && doc.page?.id === 'mva_home',
      doc.page?.id,
    );
  }

  // 3. Search form POST → 303 → /site/mva/results
  {
    const res = await form('/site/mva/home', {
      __action: 'search_flights',
      from: 'lhr',
      to: 'jfk',
      depart: '2026-10-12',
      return_date: '2026-10-19',
      adults: '1',
      cabin: 'voyager',
      trip_type: 'return',
    });
    const loc = res.headers.get('location') ?? '';
    check(
      'form search → 303 /site/mva/results',
      res.status === 303 && loc.split('?')[0].endsWith('/site/mva/results'),
      loc,
    );
    const page = await fetch(`${BASE}/site/mva/results?from=lhr&to=jfk&depart=2026-10-12`);
    const html = await page.text();
    check('results page renders flights', html.includes('MV') && html.includes('Saver'));
    // Derived-option select: flight_id options come from the URL query — a
    // POST to the queried page must resolve the same derived manifest.
    const fid = html.match(/name="flight_id"[^>]*>[\s\S]*?<option[^>]*value="([^"]+)"/)?.[1];
    const sel = await form(`/site/mva/results?from=lhr&to=jfk&depart=2026-10-12`, {
      __action: 'select_outbound',
      flight_id: fid ?? 'mv0',
      fare: 'classic',
    });
    const selLoc = sel.headers.get('location') ?? '';
    check(
      'derived select_outbound → 303',
      sel.status === 303 && selLoc.includes('/site/mva/results-return'),
      `${sel.status} ${selLoc}`,
    );
  }

  // 4. Mutate re-render: select an available exit-row seat
  {
    const res = await form('/site/mva/seats', {
      __action: 'select_seat',
      leg: 'outbound',
      seat: '30K',
    });
    const html = await res.text();
    check('select_seat re-renders with 30K', res.status === 200 && html.includes('30K'));
  }

  // 5. Invalid param → error page
  {
    const res = await form('/site/mva/seats', {
      __action: 'select_seat',
      leg: 'outbound',
      seat: '99Z',
    });
    const html = await res.text();
    check(
      'invalid seat → rendered error',
      html.includes('app.err.') || html.includes('not available'),
    );
  }

  // 6. Manage booking lookup → 303 /site/mva/booking
  {
    const res = await form('/site/mva/manage', {
      __action: 'find_booking',
      booking_ref: 'MV4X8R',
      surname: 'ashford',
    });
    const loc = res.headers.get('location') ?? '';
    check(
      'find_booking → 303 /site/mva/booking',
      res.status === 303 && loc.split('?')[0].endsWith('/site/mva/booking'),
      loc,
    );
  }

  // 7. Pay → confirm page → confirmed repost → confirmation
  {
    const pay = {
      __action: 'pay',
      __version: 'mva-pay-1',
      card_number: '4242424242424242',
      expiry: '12/28',
      cvv: '123',
      name_on_card: 'REMY ASHFORD',
      billing_postcode: 'SW1A 1AA',
      billing_country: 'gb',
    };
    const first = await form('/site/mva/payment', pay);
    const conf = await first.text();
    const tok = /name="__confirm" value="([^"]+)"/.exec(conf)?.[1];
    check(
      'pay → confirmation challenge page',
      first.status === 200 && !!tok,
      tok ? 'token issued' : 'no token',
    );
    if (tok) {
      const second = await form('/site/mva/payment', { ...pay, __confirm: tok });
      const loc = second.headers.get('location') ?? '';
      check(
        'confirmed pay → 303 /site/mva/confirmation',
        second.status === 303 && loc.split('?')[0].endsWith('/site/mva/confirmation'),
        loc || `status ${second.status}`,
      );
    }
  }

  // 8. Wire action on /app still intact (agents unaffected by /site)
  {
    const res = await fetch(`${BASE}/app/mva/home`, {
      method: 'POST',
      headers: { 'content-type': 'application/vnd.agent-page-action+json', origin: BASE },
      body: JSON.stringify({
        app: '1.1',
        action: 'search_flights',
        params: {
          from: 'lhr',
          to: 'jfk',
          depart: '2026-10-12',
          adults: 1,
          cabin: 'voyager',
          trip_type: 'return',
        },
      }),
      redirect: 'manual',
    });
    check('wire POST /app/mva/home search → 303', res.status === 303, String(res.status));
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(`\nsite bridge: ${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
} catch (e) {
  console.error('FATAL', e);
  process.exitCode = 1;
} finally {
  server.kill();
}
