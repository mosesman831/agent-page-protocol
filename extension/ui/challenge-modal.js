/**
 * MFA / OTP / passkey challenge modal - SPEC §6 / §24.3.
 * Distinct from confirmation chrome (confirmation-modal.js stays L1-L4 only).
 */

import { validateChallengeRecord, staleWindowMs } from '../protocol/validate.js';

/**
 * Show challenge dialog. Returns Promise<{ otp?: string, credential?: object, abort?: boolean }>.
 *
 * @param {ShadowRoot|Document|HTMLElement} host
 * @param {object} options
 * @param {object} options.challenge - challenge fields or StateNode
 * @param {string} options.origin
 * @param {number} [options.staleMs]
 */
export function showChallengeModal(host, options) {
  const parsed = validateChallengeRecord(options.challenge);
  if (!parsed.ok) {
    return Promise.resolve({ abort: true, reason: parsed.message });
  }
  const challenge = parsed.challenge;
  const origin = options.origin || '';
  const staleMs = options.staleMs ?? staleWindowMs(challenge.ttl_ms);

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

    root.querySelector?.('.app-challenge-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'app-challenge-overlay app-confirm-overlay';
    overlay.setAttribute('role', 'presentation');

    const dialog = document.createElement('div');
    dialog.className = 'app-challenge-dialog app-confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'app-challenge-title');

    const kind = challenge.kind || 'otp';
    const paramName = challenge.param || 'otp';
    const length = Number(challenge.length) || 6;

    const trust = document.createElement('div');
    trust.className = 'app-confirm-trust';
    trust.innerHTML = `
      <div class="app-confirm-trust-badge" aria-hidden="true">APP</div>
      <h2 id="app-challenge-title" class="app-confirm-trust-title">Verification required</h2>
      <dl class="app-confirm-trust-meta">
        <div><dt>Origin</dt><dd>${escapeHtml(origin)}</dd></div>
        <div><dt>Kind</dt><dd><code>${escapeHtml(kind)}</code></dd></div>
        <div><dt>Channel</dt><dd>${escapeHtml(String(challenge.channel || ''))}</dd></div>
      </dl>
      <p class="app-confirm-initiated">Enter the verification factor for this site. Codes are never stored.</p>
    `;

    const body = document.createElement('div');
    body.className = 'app-confirm-secondary';

    if (challenge.mask) {
      const mask = document.createElement('p');
      mask.className = 'app-challenge-mask';
      mask.textContent = `Sent to ${challenge.mask}`;
      body.appendChild(mask);
    }

    let input = null;
    if (kind === 'webauthn') {
      const p = document.createElement('p');
      p.textContent = 'Use your passkey or security key to continue.';
      body.appendChild(p);
    } else if (kind === 'magic_link' || kind === 'push') {
      const p = document.createElement('p');
      p.textContent =
        kind === 'magic_link'
          ? 'Open the link we sent, then return here.'
          : 'Approve the push notification on your device.';
      body.appendChild(p);
    } else {
      const label = document.createElement('label');
      label.className = 'app-label';
      label.setAttribute('for', 'app-challenge-input');
      label.textContent = kind === 'totp' ? 'Authenticator code' : 'Verification code';
      input = document.createElement('input');
      input.id = 'app-challenge-input';
      input.className = 'app-input';
      input.type = 'text';
      input.inputMode = 'numeric';
      input.autocomplete = 'one-time-code';
      input.name = paramName;
      input.maxLength = length > 0 ? length : 12;
      if (challenge.pattern) {
        try {
          input.pattern = challenge.pattern;
        } catch {
          /* ignore */
        }
      }
      input.required = true;
      body.append(label, input);
    }

    const actions = document.createElement('div');
    actions.className = 'app-confirm-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'app-btn app-btn-secondary';
    cancelBtn.textContent = 'Cancel';

    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'app-btn app-btn-primary';
    submitBtn.textContent =
      kind === 'webauthn'
        ? 'Use passkey'
        : kind === 'magic_link' || kind === 'push'
          ? 'I am done'
          : 'Verify';

    actions.append(cancelBtn, submitBtn);
    dialog.append(trust, body, actions);
    overlay.appendChild(dialog);
    (root.body || root).appendChild(overlay);

    const staleTimer = setTimeout(() => finish({ abort: true, reason: 'stale' }), staleMs);

    let settled = false;
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(staleTimer);
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => finish({ abort: true }));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish({ abort: true });
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish({ abort: true });
      }
    });

    submitBtn.addEventListener('click', async () => {
      if (kind === 'webauthn') {
        try {
          const credential = await runWebAuthn(challenge.public_key);
          finish({ credential });
        } catch {
          finish({ abort: true, reason: 'webauthn_failed' });
        }
        return;
      }
      if (kind === 'magic_link' || kind === 'push') {
        finish({ otp: '' });
        return;
      }
      const otp = (input?.value || '').trim();
      if (!otp) {
        input?.focus();
        return;
      }
      finish({ otp });
    });

    input?.focus();
  });
}

async function runWebAuthn(publicKeyNode) {
  if (!navigator.credentials?.get) {
    throw new Error('WebAuthn unavailable');
  }
  const opts =
    publicKeyNode?.value && typeof publicKeyNode.value === 'object'
      ? publicKeyNode.value
      : publicKeyNode;
  const publicKey = reviveWebAuthnOptions(opts);
  const cred = await navigator.credentials.get({ publicKey });
  return credentialToJson(cred);
}

function reviveWebAuthnOptions(opts) {
  if (!opts || typeof opts !== 'object') return opts;
  const out = { ...opts };
  if (typeof out.challenge === 'string') {
    out.challenge = base64UrlToBuffer(out.challenge);
  }
  if (Array.isArray(out.allowCredentials)) {
    out.allowCredentials = out.allowCredentials.map((c) => ({
      ...c,
      id: typeof c.id === 'string' ? base64UrlToBuffer(c.id) : c.id,
    }));
  }
  return out;
}

function credentialToJson(cred) {
  if (!cred) return null;
  const response = cred.response;
  return {
    id: cred.id,
    type: cred.type,
    rawId: bufferToBase64Url(cred.rawId),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle ? bufferToBase64Url(response.userHandle) : null,
    },
  };
}

function base64UrlToBuffer(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
