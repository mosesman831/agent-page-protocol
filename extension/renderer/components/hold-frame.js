/**
 * Human-verification hold frame - widget iframe in same-origin Shadow Root (§7 / §24.2).
 * complete_hold MUST be posted from the same-origin page, never the widget origin.
 */

import { validateHoldRecord, staleWindowMs } from '../../protocol/validate.js';

/**
 * @param {object} opts
 * @param {object} opts.hold - hold fields or StateNode
 * @param {string} opts.origin - page origin (verify_url must match)
 * @param {(payload: {widget_response?: string, accepted?: boolean}) => void} opts.onComplete
 * @param {() => void} [opts.onAbort]
 * @param {number} [opts.staleMs]
 */
export function renderHoldFrame(opts) {
  const parsed = validateHoldRecord(opts.hold);
  const wrap = document.createElement('section');
  wrap.className = 'app-section app-hold-frame';
  wrap.setAttribute('aria-label', 'Human verification');

  if (!parsed.ok) {
    const err = document.createElement('p');
    err.className = 'app-error';
    err.setAttribute('role', 'alert');
    err.textContent = parsed.message || 'Invalid hold';
    wrap.appendChild(err);
    return { el: wrap, abort: true };
  }

  const hold = parsed.hold;
  const origin = opts.origin || '';

  let verifyOrigin;
  try {
    verifyOrigin = new URL(hold.verify_url, origin).origin;
  } catch {
    verifyOrigin = '';
  }
  if (verifyOrigin && origin && verifyOrigin !== origin) {
    const err = document.createElement('p');
    err.className = 'app-error';
    err.setAttribute('role', 'alert');
    err.textContent = 'Hold verify_url must be same-origin';
    wrap.appendChild(err);
    opts.onAbort?.();
    return { el: wrap, abort: true };
  }

  const title = document.createElement('h2');
  title.className = 'app-section-title';
  title.textContent = 'Human verification';
  wrap.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'app-hold-meta';
  meta.textContent = `Kind: ${hold.kind} · Status: ${hold.status || 'pending'}`;
  wrap.appendChild(meta);

  const staleMs = opts.staleMs ?? staleWindowMs(hold.ttl_ms);
  let staleTimer = setTimeout(() => {
    opts.onAbort?.();
  }, staleMs);

  if (hold.kind === 'tos') {
    const label = document.createElement('label');
    label.className = 'app-consent-label';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    const span = document.createElement('span');
    span.textContent = 'I accept the terms';
    label.append(cb, span);
    wrap.appendChild(label);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn app-btn-primary';
    btn.textContent = 'Continue';
    btn.addEventListener('click', () => {
      if (!cb.checked) return;
      clearTimeout(staleTimer);
      opts.onComplete({ accepted: true });
    });
    wrap.appendChild(btn);
    return { el: wrap, clearStale: () => clearTimeout(staleTimer) };
  }

  if (hold.widget_url) {
    let widgetOk;
    try {
      const wu = new URL(hold.widget_url);
      widgetOk =
        wu.protocol === 'https:' || wu.hostname === 'localhost' || wu.hostname === '127.0.0.1';
    } catch {
      widgetOk = false;
    }
    if (!widgetOk) {
      const err = document.createElement('p');
      err.className = 'app-error';
      err.textContent = 'Invalid widget URL';
      wrap.appendChild(err);
    } else {
      const iframe = document.createElement('iframe');
      iframe.className = 'app-hold-widget';
      iframe.title = 'Human verification widget';
      iframe.src = hold.widget_url;
      iframe.setAttribute('sandbox', 'allow-scripts');
      iframe.referrerPolicy = 'no-referrer';
      wrap.appendChild(iframe);
    }
  } else {
    const p = document.createElement('p');
    p.textContent = 'Complete verification on the verify page, then continue.';
    wrap.appendChild(p);
  }

  const field = document.createElement('div');
  field.className = 'app-field';
  const label = document.createElement('label');
  label.className = 'app-label';
  label.setAttribute('for', 'app-hold-response');
  label.textContent = 'Widget response (if required)';
  const input = document.createElement('input');
  input.id = 'app-hold-response';
  input.className = 'app-input';
  input.type = 'password';
  input.autocomplete = 'off';
  input.name = 'widget_response';
  field.append(label, input);
  wrap.appendChild(field);

  const bar = document.createElement('div');
  bar.className = 'app-form-actions';

  const complete = document.createElement('button');
  complete.type = 'button';
  complete.className = 'app-btn app-btn-primary';
  complete.textContent = 'I completed verification';
  complete.addEventListener('click', () => {
    clearTimeout(staleTimer);
    const widget_response = input.value || undefined;
    opts.onComplete(widget_response ? { widget_response } : {});
  });

  const abort = document.createElement('button');
  abort.type = 'button';
  abort.className = 'app-btn app-btn-secondary';
  abort.textContent = 'Cancel';
  abort.addEventListener('click', () => {
    clearTimeout(staleTimer);
    opts.onAbort?.();
  });

  bar.append(complete, abort);
  wrap.appendChild(bar);

  return {
    el: wrap,
    clearStale: () => clearTimeout(staleTimer),
  };
}
