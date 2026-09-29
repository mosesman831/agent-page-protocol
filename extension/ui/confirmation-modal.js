/**
 * Non-spoofable confirmation modal — SPEC §6.4, §10.4.1, §13.
 *
 * Client chrome (PRIMARY, non-spoofable): origin, action id, side_effect class,
 * fixed copy "This action was initiated by <client name>".
 * Server confirm.title / body_template render BELOW as secondary plain text only.
 *
 * Mode B (`uuid-mode:<uuid>`) is for renderer/extension same-origin sessions only —
 * never for agent clients (§10.4.2).
 */

import {
  expandTemplate,
  formatStateValue,
  getByPointer,
  statePathToPointer,
  uuid,
  uuidModeToken,
} from '../protocol/parse.js';
import { confirmationLevel } from '../protocol/validate.js';

export const CLIENT_NAME = 'APP Renderer';

const LEVEL_COPY = {
  1: {
    headline: 'This action deletes or irreversibly changes data.',
    confirmLabel: 'Confirm',
    danger: true,
    enterConfirms: false,
  },
  2: {
    headline: 'This action moves money or completes a purchase.',
    confirmLabel: 'Confirm payment',
    danger: true,
    enterConfirms: true,
  },
  3: {
    headline: 'This shares your identity data.',
    confirmLabel: 'Confirm',
    danger: false,
    enterConfirms: true,
  },
  4: {
    headline: 'This action requires your explicit confirmation.',
    confirmLabel: 'Confirm',
    danger: false,
    enterConfirms: true,
  },
};

/**
 * Resolve amount display from confirm.amount_path (§10.4 L2).
 * Formats INTEGER minor units via scale/unit on the number StateNode.
 */
export function resolveAmount(manifest, actionDef) {
  const paths = actionDef?.confirm?.amount_path;
  if (!paths) return null;
  const list = Array.isArray(paths) ? paths : [paths];
  const amounts = [];
  for (const p of list) {
    const pointer = p.startsWith('/') ? p : statePathToPointer(String(p).replace(/^state\./, ''));
    const node = getByPointer(manifest, pointer);
    if (node != null) {
      amounts.push({
        path: pointer,
        display: formatStateValue(node, 'currency'),
        raw: node,
      });
    }
  }
  // Also honor policy.max_financial when amount_path absent/unresolved
  if (!amounts.length && actionDef?.policy?.max_financial) {
    const mf = actionDef.policy.max_financial;
    const node =
      mf && typeof mf === 'object' && mf.type === 'number'
        ? mf
        : { type: 'number', value: mf, scale: 2, unit: 'USD' };
    amounts.push({
      path: '/policy/max_financial',
      display: formatStateValue(node, 'currency'),
      raw: node,
    });
  }
  return amounts.length ? amounts : null;
}

/**
 * Mint a Mode B confirmation token for same-origin renderer/extension sessions.
 * MUST NOT be used when X-APP-Client kind is agent.
 */
export function mintModeBToken(rawUuid = uuid()) {
  return uuidModeToken(rawUuid);
}

/**
 * Show confirmation dialog inside `host` (prefer ShadowRoot).
 * Returns Promise<{ approved: boolean, modeBToken?: string }>.
 */
export function showConfirmationModal(host, options) {
  const {
    level,
    actionId,
    actionDef,
    origin,
    params = {},
    manifest = null,
    clientName = CLIENT_NAME,
    mintModeB = true,
  } = options;

  const lvl = level ?? confirmationLevel(actionDef);
  if (lvl <= 0) {
    return Promise.resolve({
      approved: true,
      modeBToken: mintModeB ? mintModeBToken() : undefined,
    });
  }

  const copy = LEVEL_COPY[Math.min(lvl, 4)] || LEVEL_COPY[4];
  const sideEffect = actionDef?.side_effect || 'safe';
  const serverTitle = actionDef?.confirm?.title || null;
  const serverBody = actionDef?.confirm?.body_template
    ? expandTemplate(actionDef.confirm.body_template, {
        params,
        state: manifest?.state || {},
      })
    : null;

  const amounts =
    lvl === 2 || sideEffect === 'financial' ? resolveAmount(manifest, actionDef) : null;

  const piiFromPolicy = Array.isArray(actionDef?.policy?.pii_params)
    ? actionDef.policy.pii_params
    : [];
  const piiParams =
    lvl === 3 || sideEffect === 'identity'
      ? [
          ...new Set([
            ...piiFromPolicy,
            ...Object.keys(actionDef?.input || {}).filter((k) => {
              const p = actionDef.input[k];
              return p && p.secret;
            }),
          ]),
        ]
      : [];

  return new Promise((resolve) => {
    // Prefer closed shadow root so host page CSS cannot spoof chrome (§10.8)
    let root =
      host instanceof ShadowRoot || host instanceof DocumentFragment
        ? host
        : host?.shadowRoot || host;

    if (!(root instanceof ShadowRoot) && root && root.nodeType === 1 && !root.shadowRoot) {
      try {
        root = root.attachShadow({ mode: 'closed' });
      } catch {
        /* already has shadow or not an element */
      }
    }

    const existing = root.querySelector?.('.app-confirm-overlay');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'app-confirm-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'app-confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'app-confirm-trust-title');

    // --- Non-spoofable trust header (PRIMARY) — extension-owned ---
    const trust = document.createElement('div');
    trust.className = 'app-confirm-trust';
    trust.innerHTML = `
      <div class="app-confirm-trust-badge" aria-hidden="true">APP</div>
      <h2 id="app-confirm-trust-title" class="app-confirm-trust-title">Confirm action</h2>
      <dl class="app-confirm-trust-meta">
        <div><dt>Origin</dt><dd data-field="origin">${escapeHtml(origin)}</dd></div>
        <div><dt>Action</dt><dd data-field="action"><code>${escapeHtml(actionId)}</code></dd></div>
        <div><dt>Side effect</dt><dd data-field="side_effect">${escapeHtml(sideEffect)}</dd></div>
        <div><dt>Level</dt><dd data-field="level">L${lvl}</dd></div>
      </dl>
      <p class="app-confirm-initiated">This action was initiated by ${escapeHtml(clientName)}</p>
      <p class="app-confirm-trust-headline">${escapeHtml(copy.headline)}</p>
    `;

    // --- Server-provided content (SECONDARY plain text only) ---
    const secondary = document.createElement('div');
    secondary.className = 'app-confirm-secondary';
    const hasSecondary = serverTitle || serverBody || amounts || (lvl === 3 && piiParams.length);
    if (hasSecondary) {
      if (serverTitle) {
        const t = document.createElement('p');
        t.className = 'app-confirm-server-title';
        t.textContent = serverTitle;
        secondary.appendChild(t);
      }
      if (serverBody) {
        const b = document.createElement('p');
        b.className = 'app-confirm-server-body';
        b.textContent = serverBody;
        secondary.appendChild(b);
      }
      if (amounts) {
        const box = document.createElement('div');
        box.className = 'app-confirm-amount';
        box.setAttribute('aria-label', 'Amount');
        for (const a of amounts) {
          const row = document.createElement('div');
          row.className = 'app-confirm-amount-row';
          const label = document.createElement('span');
          label.textContent = 'Amount';
          const strong = document.createElement('strong');
          strong.textContent = a.display;
          row.append(label, strong);
          box.appendChild(row);
        }
        secondary.appendChild(box);
      }
      if (lvl === 3 && piiParams.length) {
        const label = document.createElement('p');
        label.className = 'app-confirm-pii-label';
        label.textContent = 'Parameters that may share identity data:';
        secondary.appendChild(label);
        const list = document.createElement('ul');
        list.className = 'app-confirm-pii';
        list.setAttribute('aria-label', 'Identity parameters');
        for (const name of piiParams) {
          const li = document.createElement('li');
          li.textContent = name;
          list.appendChild(li);
        }
        secondary.appendChild(list);
      }
    } else {
      secondary.hidden = true;
    }

    const actions = document.createElement('div');
    actions.className = 'app-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-btn app-btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = copy.danger ? 'app-btn app-btn-danger' : 'app-btn app-btn-primary';
    confirmBtn.textContent = copy.confirmLabel;
    // L1: Enter ≠ confirm — keep confirm out of default activation path
    if (!copy.enterConfirms) {
      confirmBtn.setAttribute('data-enter-confirm', 'false');
    }

    actions.append(cancelBtn, confirmBtn);
    dialog.append(trust, secondary, actions);
    overlay.appendChild(dialog);

    const mount = root.body || root;
    mount.appendChild(overlay);

    const focusRoot = root instanceof ShadowRoot ? root : document;
    const focusables = () =>
      [
        ...dialog.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.disabled && el.getClientRects().length > 0);

    const previouslyFocused =
      (focusRoot.activeElement && focusRoot.activeElement !== focusRoot) || document.activeElement;

    // Destructive (L1): focus Cancel so Enter does not confirm
    if (!copy.enterConfirms) {
      cancelBtn.focus();
    } else {
      confirmBtn.focus();
    }

    function trap(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
        return;
      }
      // L1 destructive: Enter must never confirm
      if (e.key === 'Enter' && !copy.enterConfirms) {
        if (e.target === confirmBtn) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      const active = focusRoot.activeElement || document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function finish(approved) {
      overlay.removeEventListener('keydown', trap, true);
      overlay.remove();
      if (previouslyFocused && previouslyFocused.focus) {
        try {
          previouslyFocused.focus();
        } catch {
          /* ignore */
        }
      }
      resolve({
        approved,
        modeBToken: approved && mintModeB ? mintModeBToken() : undefined,
      });
    }

    overlay.addEventListener('keydown', trap, true);
    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export { confirmationLevel };
