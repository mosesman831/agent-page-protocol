/**
 * /site/<site>/<slug> — negotiated hybrid surface.
 *
 * Same underlying manifests as /app/*: `Accept: vnd.agent-page+json` gets the
 * manifest; anything else gets HTML rendered from it (demo/lib/render-html).
 * POST takes an HTML form, maps it to a wire Action Request, runs it through
 * the real page middleware, then turns the result back into HTML — DOM users
 * and agents share the identical flow: negotiation, idempotency,
 * confirmation, challenges, diffs.
 */

import { randomBytes } from 'node:crypto';
import {
  renderPage,
  renderErrorPage,
  renderConfirmPage,
  renderChallengePage,
} from './render-html.mjs';

const MEDIA_PAGE = 'application/vnd.agent-page+json';
const MEDIA_ACTION = 'application/vnd.agent-page-action+json';

/**
 * @param {object} app express app
 * @param {object} opts
 * @param {string} opts.origin deployment origin
 * @param {Object<string, object>} opts.skins site -> DOM skin
 * @param {(pathname: string, query?: Object<string, unknown>) => object|null} opts.findManifest
 *   returns the manifest — already cloned, with query-derived state applied
 * @param {Function} opts.pageHandler the createPageHandler() middleware
 * @param {Function} opts.express express module (for urlencoded)
 */
export function mountSiteRoutes(app, { origin, skins = {}, findManifest, pageHandler, express }) {
  const siteSkin = (site) => skins[site] ?? { brand: site, appUrl: `${origin}/app/${site}/home` };
  const siteSlug = (req) => `/app/${req.params.site}/${req.params.slug}`;

  app.get('/site/:site/:slug', (req, res, next) => {
    const manifest = findManifest(siteSlug(req), req.query);
    if (!manifest) return next();
    const accept = String(req.headers.accept ?? '');
    if (accept.includes(MEDIA_PAGE)) {
      res.status(200).type(MEDIA_PAGE).json(manifest);
      return;
    }
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(renderPage(manifest, { skin: siteSkin(req.params.site) }));
  });
  app.get('/site/:site', (req, res) => res.redirect(302, `/site/${req.params.site}/home`));

  // Coerce urlencoded fields to the action input schema types — only keys the
  // spec declares (stray form fields would trip unknown-param validation).
  const tryJson = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const RANGE_TYPES = new Set(['daterange', 'date_range', 'datetimerange', 'datetime_range']);
  const coerceParams = (fields, inputSpec = {}) => {
    const params = {};
    for (const [k, spec] of Object.entries(inputSpec)) {
      const v = fields[k];
      if (RANGE_TYPES.has(spec.type)) {
        if (fields[`${k}_from`] || fields[`${k}_to`])
          params[k] = { from: fields[`${k}_from`] ?? '', to: fields[`${k}_to`] ?? '' };
        continue;
      }
      if (v === undefined || v === null || v === '') {
        if (spec.type === 'boolean') params[k] = false; // unchecked checkbox posts nothing
        continue;
      }
      if (spec.type === 'money')
        params[k] = {
          amount: Math.round(Number(v) * 10 ** (spec.scale ?? 2)),
          ...(spec.currency ? { currency: spec.currency } : {}),
          ...(spec.scale != null ? { scale: spec.scale } : {}),
        };
      else if (spec.type === 'number' || spec.type === 'quantity') params[k] = Number(v);
      else if (spec.type === 'boolean') params[k] = v === 'on' || v === 'true' || v === true;
      else if (spec.type === 'object') params[k] = tryJson(v) ?? v;
      else if (spec.type === 'array') {
        const parsed = tryJson(v);
        params[k] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(v)
            ? v
            : String(v)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
      } else params[k] = v;
    }
    return params;
  };

  app.post('/site/:site/:slug', express.urlencoded({ extended: true }), async (req, res, next) => {
    const site = req.params.site;
    const pathname = siteSlug(req);
    const manifest = findManifest(pathname, req.query);
    if (!manifest) return next();
    const { __action: actionId, __confirm, __challenge, ...fields } = req.body ?? {};
    const def = manifest.actions?.[actionId];
    const back = `/site/${site}/${req.params.slug}`;
    if (!def || typeof actionId !== 'string') {
      res
        .status(400)
        .type('text/html; charset=utf-8')
        .send(
          renderErrorPage({
            skin: siteSkin(site),
            status: 400,
            code: 'app.err.action.unknown',
            message: `Unknown action '${actionId}'`,
            back,
          }),
        );
      return;
    }
    const params = coerceParams(fields, def.input);

    // Run one wire Action Request through the real middleware on the real
    // req/res pair, intercepting writes so nothing reaches the socket until
    // we render the final HTML. Re-entrant: res is fully restored between
    // calls so a request can invoke the middleware more than once.
    const invoke = (extra = {}) =>
      new Promise((resolve) => {
        const chunks = [];
        const origWrite = res.write.bind(res);
        const origEnd = res.end.bind(res);
        const done = (out) => {
          res.write = origWrite;
          res.end = origEnd;
          resolve(out);
        };
        res.write = (chunk, enc, cb) => {
          chunks.push(Buffer.from(chunk ?? ''));
          if (typeof enc === 'function') enc();
          if (typeof cb === 'function') cb();
          return true;
        };
        res.end = (chunk, enc, cb) => {
          if (chunk) chunks.push(Buffer.from(chunk ?? ''));
          let body = null;
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
          } catch {
            /* non-JSON body */
          }
          const out = {
            status: res.statusCode,
            location: res.getHeader('location'),
            body,
          };
          res.removeHeader('location');
          res.statusCode = 200;
          if (typeof cb === 'function') cb();
          done(out);
        };
        req.headers['content-type'] = MEDIA_ACTION;
        req.headers['accept'] = MEDIA_PAGE;
        req.headers['x-app-version'] = '1.1';
        req.headers['x-app-idempotency-key'] = `html_${randomBytes(8).toString('hex')}`;
        req.headers['x-app-origin'] = req.headers.origin ?? origin;
        // DOM form posts always pin to the version this instance currently
        // has — serverless worlds re-seed per instance and this bridge is a
        // single-user demo surface, so resync beats a 409 wall. The wire
        // path keeps strict version-match semantics for real conflicts.
        if (manifest.page?.version)
          req.headers['x-app-if-match-version'] = String(manifest.page.version);
        else delete req.headers['x-app-if-match-version'];
        if (extra.confirm) req.headers['x-app-confirmation'] = extra.confirm;
        else delete req.headers['x-app-confirmation'];
        if (extra.challenge) req.headers['x-app-challenge'] = extra.challenge;
        else delete req.headers['x-app-challenge'];
        // body-parser's stream was consumed by urlencoded above; flag it so
        // the pageHandler's JSON parser skips re-parsing and keeps this body.
        req._body = true;
        req.body = { app: '1.1', action: actionId, params };
        // The middleware routes on req.originalUrl (absoluteUrl()) — point
        // both at the manifest path, not the /site form path. Keep the query:
        // the page's options/state were query-derived, so the wire lookup
        // must resolve the same derived manifest.
        const siteQs = new URLSearchParams(req.query).toString();
        req.url = siteQs ? `${pathname}?${siteQs}` : pathname;
        req.originalUrl = req.url;
        pageHandler(req, res, (err) => {
          done({
            status: 502,
            body: err
              ? { error: { code: 'app.err.bridge', message: String(err?.message ?? err) } }
              : null,
          });
        });
      });

    const confTokenOf = (b) =>
      b?.error?.details?.confirmation_challenge?.value ??
      b?.error?.details?.confirmation?.value ??
      null;
    const challIdOf = (b) => b?.error?.details?.challenge?.value?.id?.value ?? null;
    const tokenGone = (code) =>
      [
        'app.err.action.confirmation_invalid',
        'app.err.auth.challenge_failed',
        'app.err.auth.challenge_invalid',
        'app.err.auth.challenge_expired',
      ].includes(code);

    let r = await invoke({ confirm: __confirm, challenge: __challenge });
    // Pending confirmations/challenges are held by the instance that issued
    // them — a serverless resubmit often lands elsewhere. Re-run the action
    // to mint a fresh token on this instance, then replay the user's
    // already-made decision (approve / submitted code) with it.
    if (__confirm && tokenGone(r.body?.error?.code)) {
      const again = await invoke({});
      const tok = confTokenOf(again.body);
      if (tok) r = await invoke({ confirm: tok });
    }
    if (__challenge && tokenGone(r.body?.error?.code)) {
      const again = await invoke({});
      const ch = challIdOf(again.body);
      if (ch) r = await invoke({ challenge: ch });
    }

    const { status, location, body } = r;
    // Session bridge: wire login responses carry state.session_token — keep
    // it in a cookie so later site POSTs send it back (auth:'session').
    const sess = body?.state?.session_token;
    if (sess && sess.type !== 'null') {
      const t = sess.value ?? sess;
      res.setHeader(
        'Set-Cookie',
        t
          ? `session=${String(t)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
          : 'session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0',
      );
    }
    if (location) {
      const target = String(location).replace('/app/', '/site/');
      res.redirect(Number(status) === 302 ? 302 : 303, target);
      return;
    }
    if (status === 428 && body?.error?.details) {
      const d = body.error.details;
      const confTok = confTokenOf(body);
      if (confTok) {
        res
          .status(200)
          .type('text/html; charset=utf-8')
          .send(
            renderConfirmPage({
              skin: siteSkin(site),
              manifest,
              actionId,
              def,
              params,
              token: confTok,
            }),
          );
        return;
      }
      const chId = challIdOf(body);
      if (chId) {
        res
          .status(200)
          .type('text/html; charset=utf-8')
          .send(
            renderChallengePage({
              skin: siteSkin(site),
              manifest,
              actionId,
              def,
              params,
              challengeId: chId,
              challenge: d.challenge.value,
            }),
          );
        return;
      }
    }
    if (body?.error) {
      res
        .status(status)
        .type('text/html; charset=utf-8')
        .send(
          renderErrorPage({
            skin: siteSkin(site),
            status,
            code: body.error.code,
            message: body.error.message,
            back,
          }),
        );
      return;
    }
    if (body?.page?.url) {
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(renderPage(body, { skin: siteSkin(site) }));
      return;
    }
    // diff or event reply — re-render the stored (post-mutation) manifest
    const fresh = findManifest(pathname, req.query) ?? manifest;
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(renderPage(fresh, { skin: siteSkin(site) }));
  });
}
