import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createAppServer,
  bumpVersion,
  MEDIA_PAGE,
  MEDIA_DIFF,
  MEDIA_ACTION,
  MEDIA_ERROR,
  MemoryIdempotencyStore,
  MemoryConfirmationStore,
  HEADER_APP_RESULT_VERSION,
  type PageManifest,
  type ActionHandler,
} from '../src/index.js';

function makeManifest(): PageManifest {
  return {
    app: '1.0',
    page: {
      id: 'shop',
      url: 'http://localhost:3000/shop',
      title: 'Shop',
      version: 'v1',
      etag: '"etag-v1"',
    },
    state: {
      total: { type: 'number', value: 0, label: 'Total' },
      items: {
        type: 'table',
        fields: { sku: 'string', qty: 'number' },
        value: [],
        label: 'Items',
      },
    },
    actions: {
      add: {
        description: 'Add item',
        kind: 'mutate',
        input: {
          sku: { type: 'string', required: true },
          qty: { type: 'number', required: true, min: 1 },
        },
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
      },
      purchase: {
        description: 'Purchase cart',
        kind: 'mutate',
        input: {
          amount: { type: 'number', required: true, min: 1 },
        },
        output: { state_diff: true },
        side_effect: 'financial',
        idempotent: false,
        requires_confirmation: true,
      },
      go_checkout: {
        description: 'Navigate to checkout',
        kind: 'navigate',
        input: {},
        output: { navigates_to: 'http://localhost:3000/checkout' },
        side_effect: 'safe',
        idempotent: true,
      },
      long_job: {
        description: 'Start async job',
        kind: 'mutate',
        input: {},
        output: { state_diff: false },
        side_effect: 'safe',
        idempotent: true,
        async: true,
      },
      locked: {
        description: 'Requires version match',
        kind: 'mutate',
        input: {},
        output: { state_diff: true },
        side_effect: 'safe',
        idempotent: true,
        requires_etag_match: true,
      },
    },
  };
}

describe('createAppServer integration (v0.4)', () => {
  let manifest: PageManifest;
  let idemStore: MemoryIdempotencyStore;
  let confStore: MemoryConfirmationStore;

  beforeEach(() => {
    manifest = makeManifest();
    idemStore = new MemoryIdempotencyStore();
    confStore = new MemoryConfirmationStore();
  });

  function app() {
    const add: ActionHandler = async ({ manifest: cur, params }) => {
      const next = structuredClone(cur);
      const table = next.state.items as {
        type: 'table';
        value: unknown[][];
      };
      table.value.push([params.sku, params.qty]);
      (next.state.total as { value: number }).value += Number(params.qty);
      next.page.version = bumpVersion(cur.page.version);
      next.page.etag = `"etag-${next.page.version}"`;
      manifest = next;
      return { type: 'diff', nextManifest: next };
    };

    const purchase: ActionHandler = async ({ manifest: cur }) => {
      const next = structuredClone(cur);
      next.page.version = bumpVersion(cur.page.version);
      next.state.purchased = { type: 'boolean', value: true };
      manifest = next;
      return { type: 'diff', nextManifest: next };
    };

    const go_checkout: ActionHandler = async () => ({
      type: 'navigate',
      url: 'http://localhost:3000/checkout',
    });

    const long_job: ActionHandler = async () => ({
      type: 'async',
      jobId: 'op_test_1',
      pollIntervalMs: 2000,
      status: 'queued',
      statusUrl: 'http://localhost:3000/operations/op_test_1',
    });

    const locked: ActionHandler = async ({ manifest: cur }) => {
      const next = structuredClone(cur);
      next.page.version = bumpVersion(cur.page.version);
      manifest = next;
      return { type: 'full', manifest: next };
    };

    return createAppServer({
      pageOrigin: 'http://localhost:3000',
      getManifest: async () => manifest,
      actionHandlers: { add, purchase, go_checkout, long_job, locked },
      idempotencyStore: idemStore,
      confirmationStore: confStore,
      path: '/shop',
    });
  }

  it('GET returns manifest with required headers', async () => {
    const res = await request(app()).get('/shop').set('Accept', MEDIA_PAGE).expect(200);

    expect(res.headers['content-type']).toMatch(/vnd\.agent-page\+json/);
    expect(res.headers['x-app-version']).toBe('1.0');
    expect(res.headers['x-app-page-id']).toBe('shop');
    expect(res.headers['x-app-response-mode']).toBe('full');
    expect(res.headers['etag']).toBeTruthy();
    expect(res.headers['vary']).toMatch(/Accept/i);
    expect(res.body.page.id).toBe('shop');
    expect(res.body.page_version).toBeUndefined();
  });

  it('GET If-None-Match returns 304', async () => {
    await request(app())
      .get('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('If-None-Match', '"etag-v1"')
      .expect(304);
  });

  it('OPTIONS returns 204 with Allow, no error envelope', async () => {
    const res = await request(app()).options('/shop').expect(204);
    expect(res.headers['allow']).toMatch(/GET/);
    expect(res.headers['allow']).toMatch(/POST/);
    expect(res.body).toEqual({});
  });

  it('rejects disallowed methods with 405', async () => {
    const res = await request(app()).put('/shop').set('Accept', MEDIA_PAGE).expect(405);
    expect(res.body.error.code).toBe('app.err.transport.method_not_allowed');
    expect(res.headers['allow']).toBeTruthy();
  });

  it('wrong Content-Type → 415 unsupported_media_type', async () => {
    await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', 'application/json')
      .set('Origin', 'http://localhost:3000')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(415)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.negotiate.unsupported_media_type');
      });
  });

  it('POST returns diff with X-APP-Result-Version and detects version conflict', async () => {
    const server = app();
    const ok = await request(server)
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-If-Match-Version', 'v1')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 2 } })
      .expect(200);

    expect(ok.headers['content-type']).toMatch(/vnd\.agent-page-diff\+json/);
    expect(ok.body.result_version).toBe('v2');
    expect(ok.headers[HEADER_APP_RESULT_VERSION.toLowerCase()]).toBe('v2');
    expect(ok.body.result_etag).toBeUndefined();
    expect(ok.body.base.etag).toBeUndefined();

    await request(server)
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-If-Match-Version', 'v1')
      .send({ app: '1.0', action: 'add', params: { sku: 'b', qty: 1 } })
      .expect(409)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.diff.conflict');
        expect(r.headers['content-type']).toMatch(/vnd\.agent-page-error\+json/);
      });
  });

  it('requires_etag_match missing version → 428 version_required', async () => {
    await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .send({ app: '1.0', action: 'locked', params: {} })
      .expect(428)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.action.version_required');
      });
  });

  it('navigate returns 303 empty body with Location + X-APP-Navigate (C4)', async () => {
    const res = await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .redirects(0)
      .send({ app: '1.0', action: 'go_checkout', params: {} });

    expect(res.status).toBe(303);
    expect(res.headers['location']).toBe('http://localhost:3000/checkout');
    expect(res.headers['x-app-navigate']).toBe('http://localhost:3000/checkout');
    expect(res.headers['x-app-response-mode']).toBe('redirect');
    expect(res.text === '' || res.text === undefined).toBe(true);
  });

  it('async returns Form D 202 with operation_status (C5)', async () => {
    const res = await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .send({ app: '1.0', action: 'long_job', params: {} })
      .expect(202);

    expect(res.headers['content-type']).toMatch(/vnd\.agent-page\+json/);
    expect(res.headers['x-app-response-mode']).toBe('async');
    expect(res.body.state.operation_status.type).toBe('object');
    expect(res.body.state.operation_status.value.state.value).toBe('queued');
    expect(res.body.state.operation_status.value.status_url.value).toContain('/operations/');
    expect(res.body.meta.poll_interval_ms).toBe(2000);
    expect(res.body.actions.cancel_operation).toBeTruthy();
    expect(res.body.error).toBeUndefined();
  });

  it('CSRF: mismatched Origin rejected despite valid X-APP-Origin', async () => {
    await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'https://evil.com')
      .set('X-APP-Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer test')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(403)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.security.csrf');
      });
  });

  it('CSRF: first-party renderer POST with no Origin + X-APP-Origin + Bearer → success', async () => {
    const res = await request(app())
      .post('/shop')
      .set('Accept', MEDIA_DIFF)
      .set('Content-Type', MEDIA_ACTION)
      .set('X-APP-Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer test')
      .send({ app: '1.0', action: 'add', params: { sku: 'renderer', qty: 1 } })
      .expect(200);

    expect(res.body.error).toBeUndefined();
    expect(res.headers['x-app-response-mode']).toBe('diff');
  });

  it('CSRF: chrome-extension Origin + X-APP-Origin + auth → 403 csrf', async () => {
    await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'chrome-extension://abcdefghijklmnopqrstuvwxyz123456')
      .set('X-APP-Origin', 'http://localhost:3000')
      .set('Authorization', 'Bearer test')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(403)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.security.csrf');
      });
  });

  it('financial action requires idempotency key and confirmation (raw body binding)', async () => {
    const server = app();

    await request(server)
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .send({ app: '1.0', action: 'purchase', params: { amount: 50 } })
      .expect(400)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.validation.idempotency_key_required');
      });

    const challenge = await request(server)
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_pay_0001')
      .set('Cookie', 'session=user1')
      .send({ app: '1.0', action: 'purchase', params: { amount: 50 } })
      .expect(428);

    expect(challenge.body.error.code).toBe('app.err.action.confirmation_required');
    expect(challenge.body.error.details.confirmation_challenge.type).toBe('string');
    expect(challenge.body.meta.server_time).toBeTruthy();
    const token = challenge.body.error.details.confirmation_challenge.value as string;

    // mutated params → 403 (different raw body)
    await request(server)
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_pay_0002')
      .set('X-APP-Confirmation', token)
      .set('Cookie', 'session=user1')
      .send({ app: '1.0', action: 'purchase', params: { amount: 99 } })
      .expect(403)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.action.confirmation_invalid');
      });

    // correct echo → success
    const ok = await request(server)
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_pay_0001')
      .set('X-APP-Confirmation', token)
      .set('X-APP-If-Match-Version', 'v1')
      .set('Cookie', 'session=user1')
      .send({ app: '1.0', action: 'purchase', params: { amount: 50 } })
      .expect(200);
    expect(ok.headers[HEADER_APP_RESULT_VERSION.toLowerCase()]).toBeTruthy();
  });

  it('idempotency conflict on different body', async () => {
    const server = app();
    await request(server)
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_add_aaaa')
      .set('X-APP-If-Match-Version', 'v1')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(200);

    await request(server)
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_add_aaaa')
      .set('X-APP-If-Match-Version', 'v2')
      .send({ app: '1.0', action: 'add', params: { sku: 'b', qty: 9 } })
      .expect(409)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.action.idempotency_conflict');
        expect(r.headers['content-type']).toMatch(new RegExp(MEDIA_ERROR.replace('+', '\\+')));
      });
  });

  it('Accept with v=1.0 media param negotiates successfully', async () => {
    await request(app())
      .get('/shop')
      .set('Accept', `${MEDIA_PAGE};v=1.0`)
      .set('X-APP-Accept-Versions', '1.0')
      .expect(200);
  });

  it('rejects unknown action-request root keys (§3.4.2)', async () => {
    await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_root_1')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 }, bogus: true })
      .expect(400)
      .expect((r) => {
        expect(r.body.error.code).toBe('app.err.payload.invalid_json');
      });
    await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Idempotency-Key', 'idem_root_2')
      .send({
        app: '1.0',
        action: 'add',
        params: { sku: 'a', qty: 1 },
        client: { kind: 'agent', name: 't', version: '1' },
      })
      .expect(200);
  });

  it('stamps diff documents with the negotiated version', async () => {
    const diff11 = await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF}, ${MEDIA_PAGE}`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.1, 1.0')
      .set('X-APP-Idempotency-Key', 'idem_diff_1')
      .send({ app: '1.1', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(200);
    expect(diff11.body.app).toBe('1.1');
    expect(diff11.headers['x-app-version']).toBe('1.1');

    const diff10 = await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_DIFF};v=1.0, ${MEDIA_PAGE};v=1.0`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.0')
      .set('X-APP-Idempotency-Key', 'idem_diff_2')
      .send({ app: '1.0', action: 'add', params: { sku: 'b', qty: 1 } })
      .expect(200);
    expect(diff10.body.app).toBe('1.0');
    expect(diff10.headers['x-app-version']).toBe('1.0');
  });

  it('idempotent replay returns the exact negotiated representation', async () => {
    manifest = {
      ...manifest,
      state: {
        ...manifest.state,
        geo: { type: 'geopoint', value: { lat: 1, lng: 2 }, label: 'Loc' },
      },
    };
    const first = await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_PAGE};v=1.0`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.0')
      .set('X-APP-Idempotency-Key', 'idem_replay_v')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(200);
    expect(first.body.app).toBe('1.0');
    expect(first.body.state.geo.type).toBe('object');

    const replay = await request(app())
      .post('/shop')
      .set('Accept', `${MEDIA_PAGE};v=1.0`)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.0')
      .set('X-APP-Idempotency-Key', 'idem_replay_v')
      .send({ app: '1.0', action: 'add', params: { sku: 'a', qty: 1 } })
      .expect(200);
    expect(replay.body.app).toBe('1.0');
    expect(replay.body.state.geo.type).toBe('object');
    expect(replay.body).toEqual(first.body);
  });

  it('stamps async 202 and navigate responses with the negotiated version', async () => {
    const asyncRes = await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.1, 1.0')
      .set('X-APP-Idempotency-Key', 'idem_async_1')
      .send({ app: '1.1', action: 'long_job', params: {} })
      .expect(202);
    expect(asyncRes.body.app).toBe('1.1');
    expect(asyncRes.headers['x-app-version']).toBe('1.1');

    const nav = await request(app())
      .post('/shop')
      .set('Accept', MEDIA_PAGE)
      .set('Content-Type', MEDIA_ACTION)
      .set('Origin', 'http://localhost:3000')
      .set('X-APP-Accept-Versions', '1.1, 1.0')
      .set('X-APP-Idempotency-Key', 'idem_nav_1')
      .send({ app: '1.1', action: 'go_checkout', params: {} })
      .expect(303);
    expect(nav.headers['x-app-version']).toBe('1.1');
  });
});
