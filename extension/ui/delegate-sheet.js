/**
 * Delegate sheet - show amount + bank/IdP origin host when opening kind:delegate (§4.9 / MF-9).
 * Prefer output.resume_url when present.
 */

import { resolveAmount } from './confirmation-modal.js';

/**
 * Prompt before leaving origin for a delegate (OAuth / 3DS / bank).
 * @returns {Promise<{ approved: boolean, resumeUrl?: string|null, targetHost?: string }>}
 */
export function showDelegateSheet(host, options) {
  const { actionId, actionDef, origin, manifest = null, params = {} } = options;

  const delegatesTo =
    actionDef?.output?.delegates_to || actionDef?.delegates_to || params?.url || null;

  let targetHost = '';
  let targetUrl = '';
  try {
    const u = new URL(String(delegatesTo), origin);
    targetHost = u.host;
    targetUrl = u.href;
  } catch {
    targetHost = String(delegatesTo || '');
    targetUrl = targetHost;
  }

  const resumeUrl = actionDef?.output?.resume_url || actionDef?.resume_url || null;

  const amounts = resolveAmount(manifest, actionDef);

  return new Promise((resolve) => {
    let root =
      host instanceof ShadowRoot || host instanceof DocumentFragment
        ? host
        : host?.shadowRoot || host;

    if (!(root instanceof ShadowRoot) && root && root.nodeType === 1 && !root.shadowRoot) {
      try {
        root = root.attachShadow({ mode: 'closed' });
      } catch {
        /* ignore */
      }
    }

    root.querySelector?.('.app-delegate-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'app-delegate-overlay app-confirm-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'app-delegate-dialog app-confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'app-delegate-title');

    const trust = document.createElement('div');
    trust.className = 'app-confirm-trust';
    trust.innerHTML = `
      <div class="app-confirm-trust-badge" aria-hidden="true">APP</div>
      <h2 id="app-delegate-title" class="app-confirm-trust-title">Leave this site?</h2>
      <dl class="app-confirm-trust-meta">
        <div><dt>From</dt><dd>${escapeHtml(origin)}</dd></div>
        <div><dt>Action</dt><dd><code>${escapeHtml(actionId)}</code></dd></div>
        <div><dt>Side effect</dt><dd>${escapeHtml(actionDef?.side_effect || 'identity')}</dd></div>
      </dl>
      <p class="app-confirm-initiated">You are about to open an external page. The host below is shown by the extension, not the site.</p>
    `;

    const secondary = document.createElement('div');
    secondary.className = 'app-confirm-secondary';

    const hostBox = document.createElement('div');
    hostBox.className = 'app-delegate-host';
    hostBox.innerHTML = `<span>Opens</span><strong>${escapeHtml(targetHost || '(unknown host)')}</strong>`;
    secondary.appendChild(hostBox);

    if (amounts?.length) {
      const box = document.createElement('div');
      box.className = 'app-confirm-amount';
      box.setAttribute('aria-label', 'Amount');
      for (const a of amounts) {
        const row = document.createElement('div');
        row.className = 'app-confirm-amount-row';
        row.innerHTML = `<span>Amount</span><strong>${escapeHtml(a.display)}</strong>`;
        box.appendChild(row);
      }
      secondary.appendChild(box);
    }

    if (resumeUrl) {
      const r = document.createElement('p');
      r.className = 'app-delegate-resume';
      r.textContent = `Return to: ${resumeUrl}`;
      secondary.appendChild(r);
    }

    const actions = document.createElement('div');
    actions.className = 'app-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-btn app-btn-secondary';
    cancelBtn.textContent = 'Stay here';

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'app-btn app-btn-primary';
    openBtn.textContent = 'Open';

    actions.append(cancelBtn, openBtn);
    dialog.append(trust, secondary, actions);
    overlay.appendChild(dialog);
    (root.body || root).appendChild(overlay);

    function finish(approved) {
      overlay.remove();
      resolve({
        approved,
        resumeUrl: approved ? resumeUrl : null,
        targetHost: approved ? targetHost : undefined,
        targetUrl: approved ? targetUrl : undefined,
      });
    }

    cancelBtn.addEventListener('click', () => finish(false));
    openBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    openBtn.focus();
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
