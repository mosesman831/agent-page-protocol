import { describe, it, expect } from 'vitest';
import { renderPretty } from '../src/pretty.js';
import type { ToolEnvelope } from '../src/core/types.js';

describe('pretty', () => {
  it('renders search page digest without secrets', () => {
    const env: ToolEnvelope = {
      app: '1.0',
      tool: '1.0',
      ok: true,
      status: 'ok',
      session: 'ses_AAAAAAAAAAAAAAAAAAAAAA',
      page: {
        id: 'flight-search',
        url: 'http://localhost:3456/flights',
        version: 'v1',
        title: 'Search Flights',
      },
      digest: {
        page: {
          id: 'flight-search',
          url: 'http://localhost:3456/flights',
          version: 'v1',
          title: 'Search Flights',
        },
        state: {
          origin: {
            type: 'enum',
            value: 'LHR',
            options: ['LHR', 'LGW', 'STN', 'LTN'],
          },
          destination: {
            type: 'enum',
            value: 'DXB',
            options: ['DXB', 'JFK', 'SIN', 'HKG'],
          },
          secret_token: { type: 'string', value: '[REDACTED]', secret: true },
        },
        actions: [
          {
            id: 'search',
            description: 'Search',
            kind: 'navigate',
            side_effect: 'safe',
            requires_confirmation: false,
            idempotent: true,
            auth: 'none',
            input: { origin: { type: 'enum' } },
          },
        ],
        capabilities: ['search', 'booking'],
      },
      meta: { cache: 'miss' },
    };

    const text = renderPretty(env, true);
    expect(text).toContain('OK');
    expect(text).toContain('flight-search');
    expect(text).toContain('LHR');
    expect(text).toContain('search');
    expect(text).not.toMatch(/Bearer |password|raw_body/i);
    expect(text).toMatchInlineSnapshot(`
"OK  session=ses_AAAAAAAAAAAAAAAAAAAAAA  cache=miss
PAGE  flight-search  v1
URL   http://localhost:3456/flights
TITLE Search Flights

STATE
  origin         LHR   enum [LHR, LGW, STN, LTN]
  destination    DXB   enum [DXB, JFK, SIN, HKG]
  secret_token   [REDACTED]

ACTIONS
  search   navigate  safe  auth=none  [origin]

CAPS  search, booking"
`);
  });
});
