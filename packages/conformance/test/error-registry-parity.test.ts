/**
 * Error registry parity: client and server catalogs must agree on the
 * httpStatus for every shared code. Codes only meaningful on one side
 * (policy.denied client-side; validation.too_many_params server-side) are
 * listed explicitly so asymmetries are a decision, not drift.
 */

import { describe, it, expect } from 'vitest';
import { ERROR_REGISTRY as SERVER } from '@agent-page/server';
import { ERROR_REGISTRY as CLIENT } from '@agent-page/client';

const CLIENT_ONLY_OK = new Set(['app.err.policy.denied', 'app.err.http_error']);
const SERVER_ONLY_OK = new Set([
  'app.err.validation.too_many_params',
  'app.err.rate.invalid_config',
  'app.err.event.invalid',
]);

describe('error registry parity (client vs server)', () => {
  const serverCodes = new Set(Object.keys(SERVER));
  const clientCodes = new Set(Object.keys(CLIENT));

  it('shared codes agree on httpStatus', () => {
    const mismatches: string[] = [];
    for (const code of serverCodes) {
      if (!clientCodes.has(code)) continue;
      const s = SERVER[code]!.httpStatus;
      const c = CLIENT[code]!.httpStatus;
      if (s !== c) mismatches.push(`${code}: server=${s} client=${c}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('asymmetric codes are only the declared ones', () => {
    expect([...serverCodes].filter((c) => !clientCodes.has(c)).sort()).toEqual(
      [...SERVER_ONLY_OK].sort(),
    );
    expect([...clientCodes].filter((c) => !serverCodes.has(c)).sort()).toEqual(
      [...CLIENT_ONLY_OK].sort(),
    );
  });

  it('shared codes agree on retryable', () => {
    const mismatches: string[] = [];
    for (const code of serverCodes) {
      if (!clientCodes.has(code)) continue;
      const s = SERVER[code]!.retryable;
      const c = CLIENT[code]!.retryable;
      if (s !== c) mismatches.push(`${code}: server=${s} client=${c}`);
    }
    expect(mismatches).toEqual([]);
  });
});
