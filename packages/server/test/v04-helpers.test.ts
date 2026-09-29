import { describe, it, expect } from 'vitest';
import { isLoopbackHost, isLoopbackUrl, isAllowedAppUrlScheme } from '../src/loopback.js';
import { buildRateLimitHeaders } from '../src/rate-limit.js';
import { validateWellKnownManifest, buildCapabilitiesNode } from '../src/well-known.js';
import { ERROR_REGISTRY } from '../src/errors.js';
import { buildAsyncPendingManifest, ASYNC_STATUS_OPTIONS } from '../src/async-actions.js';

describe('loopback (C17)', () => {
  it('accepts localhost, 127/8, and ::1', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('::ffff:127.0.0.1')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('example.com')).toBe(false);
    expect(isLoopbackHost('192.168.0.1')).toBe(false);
    expect(isLoopbackHost('10.0.0.1')).toBe(false);
  });

  it('allows http only on loopback', () => {
    expect(isAllowedAppUrlScheme('http://127.0.0.1/x')).toBe(true);
    expect(isAllowedAppUrlScheme('http://example.com/x')).toBe(false);
    expect(isAllowedAppUrlScheme('https://example.com/x')).toBe(true);
    expect(isLoopbackUrl('http://localhost:3000/')).toBe(true);
  });
});

describe('RateLimit headers (§10.6)', () => {
  it('builds modern RateLimit + legacy trio', () => {
    const h = buildRateLimitHeaders({
      limit: 60,
      remaining: 42,
      resetDeltaSeconds: 28,
      resetEpochSeconds: 1722240000,
    });
    expect(h.RateLimit).toBe('default;limit=60;remaining=42;reset=28');
    expect(h['X-RateLimit-Limit']).toBe('60');
    expect(h['X-RateLimit-Remaining']).toBe('42');
    expect(h['X-RateLimit-Reset']).toBe('1722240000');
  });
});

describe('well-known validation (C15)', () => {
  it('requires capabilities as array of string StateNodes', () => {
    const ok = validateWellKnownManifest({
      app: '1.0',
      page: {
        id: 'well-known',
        url: 'https://example.com/.well-known/agent-page',
        version: 'v1',
      },
      state: {
        site_name: { type: 'string', value: 'Acme' },
        protocol_version: { type: 'string', value: '1.0' },
        capabilities: buildCapabilitiesNode(['search', 'diffs']),
      },
    });
    expect(ok).toBeNull();
  });

  it('accepts 1.1 well-known with features/flows/privacy as StateNodes', () => {
    const ok = validateWellKnownManifest({
      app: '1.1',
      page: {
        id: 'well-known',
        url: 'https://example.com/.well-known/agent-page',
        version: 'v1',
      },
      state: {
        site_name: { type: 'string', value: 'Acme' },
        protocol_version: { type: 'string', value: '1.1' },
        capabilities: buildCapabilitiesNode(['search']),
        features: {
          type: 'object',
          value: {
            identity_flows: { type: 'boolean', value: true },
            consent: { type: 'boolean', value: true },
            events_sse: { type: 'boolean', value: true },
            events_longpoll: { type: 'boolean', value: true },
          },
        },
        flows: {
          type: 'object',
          value: {
            login: {
              type: 'object',
              value: {
                entry_url: { type: 'string', value: 'https://example.com/login' },
              },
            },
          },
        },
        privacy: {
          type: 'object',
          value: {
            policy_url: { type: 'string', value: 'https://example.com/privacy' },
            purposes: { type: 'array', value: [] },
          },
        },
        events_url: { type: 'string', value: 'https://example.com/app-events' },
      },
    });
    expect(ok).toBeNull();
  });

  it('rejects identity_flows without flows.login.entry_url', () => {
    const err = validateWellKnownManifest({
      app: '1.1',
      page: {
        id: 'well-known',
        url: 'https://example.com/.well-known/agent-page',
        version: 'v1',
      },
      state: {
        site_name: { type: 'string', value: 'Acme' },
        protocol_version: { type: 'string', value: '1.1' },
        capabilities: buildCapabilitiesNode(['search']),
        features: {
          type: 'object',
          value: { identity_flows: { type: 'boolean', value: true } },
        },
      },
    });
    expect(err?.code).toBe('app.err.discovery.invalid_well_known');
  });

  it('rejects bare-string capabilities', () => {
    const err = validateWellKnownManifest({
      app: '1.0',
      page: {
        id: 'well-known',
        url: 'https://example.com/.well-known/agent-page',
        version: 'v1',
      },
      state: {
        site_name: { type: 'string', value: 'Acme' },
        protocol_version: { type: 'string', value: '1.0' },
        capabilities: { type: 'array', value: ['search'] },
      },
    });
    expect(err?.code).toBe('app.err.discovery.invalid_well_known');
  });
});

describe('error registry (Appendix A)', () => {
  it('includes new v0.4 codes and drops partial_results alias', () => {
    expect(ERROR_REGISTRY['app.err.state.number_precision']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.action.version_required']?.httpStatus).toBe(428);
    expect(ERROR_REGISTRY['app.err.page.gone']?.httpStatus).toBe(410);
    expect(ERROR_REGISTRY['app.err.transport.method_not_allowed']?.httpStatus).toBe(405);
    expect(ERROR_REGISTRY['app.err.negotiate.unsupported_media_type']?.httpStatus).toBe(415);
    expect(ERROR_REGISTRY['app.err.payload.unexpected_body']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.payload.duplicate_key']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.action.async_failed']?.soft).toBe(true);
    expect(ERROR_REGISTRY['app.err.partial.results']).toBeTruthy();
    expect(ERROR_REGISTRY['app.err.partial_results']).toBeUndefined();
  });
});

describe('async Form D manifest', () => {
  it('builds operation_status with cancel_operation', () => {
    const m = buildAsyncPendingManifest({
      page: { id: 'shop', url: 'http://localhost/shop', version: 'v2' },
      jobId: 'op1',
      statusUrl: 'http://localhost/operations/op1',
      status: 'running',
      progress: 0.4,
      pollIntervalMs: 1500,
    });
    expect(m.state.operation_status.type).toBe('object');
    const os = m.state.operation_status as {
      value: { state: { value: string; options: string[] }; progress: { value: number } };
    };
    expect(os.value.state.value).toBe('running');
    expect(os.value.state.options).toEqual(ASYNC_STATUS_OPTIONS);
    expect(os.value.progress.value).toBe(0.4);
    expect(m.meta?.poll_interval_ms).toBe(1500);
    expect(m.actions?.cancel_operation).toBeTruthy();
    expect(m.error).toBeUndefined();
  });
});
