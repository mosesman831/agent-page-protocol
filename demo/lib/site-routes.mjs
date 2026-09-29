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
 * @param {(pathname: string) => object|null} opts.findManifest
 * @param {Function} opts.pageHandler the createPageHandler() middleware
 * @param {Function} opts.express express module (for urlencoded)
 */
export function mountSiteRoutes(app, { origin, skins = {}, findManifest, pageHandler, express }) {
  const siteSkin = (site) => skins[site] ?? { brand: site, appUrl: `${origin}/app/${site}/home` };
  const siteSlug = (req) => `/app/${req.params.site}/${req.params.slug}`;

  app.get('/site/:site/:slug', (req, res, next) => {
    const manifest = findManifest(siteSlug(req));
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
  const coerceParams = (fields, inputSpec = {}) => {
    const params = {};
    for (const [k, spec] of Object.entries(inputSpec)) {
      const v = fields[k];
      if (spec.type === 'daterange' || spec.type === 'datetimerange') {
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
      else if (spec.type === 'array')
        params[k] = Array.isArray(v)
          ? v
          : String(v)
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
      else params[k] = v;
    }
    return params;
  };

  app.post('/site/:site/:slug', express.urlencoded({ extended: true }), async (req, res, next) => {
    const site = req.params.site;
    const pathname = siteSlug(req);
    const manifest = findManifest(pathname);
    if (!manifest) return next();
    const { __action: actionId, __version, __confirm, __challenge, ...fields } = req.body ?? {};
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

    // Forward as a wire Action Request through the real middleware; capture the
    // wire response and re-render it as HTML.
    const chunks = [];
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = (chunk, enc, cb) => {
      chunks.push(Buffer.from(chunk ?? ''));
      if (typeof enc === 'function') enc();
      if (typeof cb === 'function') cb();
      return true;
    };
    const finalize = (status, location, body) => {
      if (res.headersSent) return origEnd();
      if (location) {
        const target = String(location).replace('/app/', '/site/');
        res.redirect(Number(status) === 302 ? 302 : 303, target);
        return;
      }
      if (status === 428 && body?.error?.details) {
        const d = body.error.details;
        const confTok = d.confirmation_challenge?.value ?? d.confirmation?.value ?? null;
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
        const chId = d.challenge?.value?.id?.value ?? null;
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
      const fresh = findManifest(pathname) ?? manifest;
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(renderPage(fresh, { skin: siteSkin(site) }));
    };
    res.end = (chunk, enc, cb) => {
      if (chunk) chunks.push(Buffer.from(chunk ?? ''));
      res.write = origWrite;
      res.end = origEnd;
      const status = res.statusCode;
      const location = res.getHeader('location');
      const buf = Buffer.concat(chunks);
      let body = null;
      try {
        body = JSON.parse(buf.toString('utf8') || 'null');
      } catch {
        /* non-JSON body → render the stored manifest */
      }
      if (typeof cb === 'function') cb();
      finalize(status, location, body);
    };

    req.headers['content-type'] = MEDIA_ACTION;
    req.headers['accept'] = MEDIA_PAGE;
    req.headers['x-app-version'] = '1.1';
    req.headers['x-app-idempotency-key'] =
      req.headers['x-app-idempotency-key'] ?? `html_${randomBytes(8).toString('hex')}`;
    req.headers['x-app-origin'] = req.headers['x-app-origin'] ?? req.headers.origin ?? origin;
    if (__version) req.headers['x-app-if-match-version'] = String(__version);
    if (__confirm) req.headers['x-app-confirmation'] = String(__confirm);
    if (__challenge) req.headers['x-app-challenge'] = String(__challenge);
    // body-parser's stream was consumed by urlencoded above; flag it so the
    // pageHandler's JSON parser skips re-parsing and keeps this body.
    req._body = true;
    req.body = { app: '1.1', action: actionId, params };
    // The middleware routes on req.originalUrl (absoluteUrl()) — point both at
    // the manifest path, not the /site form path the browser posted to.
    req.url = pathname;
    req.originalUrl = pathname;
    pageHandler(req, res, (err) => {
      if (err) next(err);
    });
  });
}
