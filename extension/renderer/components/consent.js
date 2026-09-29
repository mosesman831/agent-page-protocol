/**
 * Consent banner / purpose grants - SPEC §8 / §24.3.
 */

/**
 * @param {object} opts
 * @param {object} opts.consentNode - state.consent StateNode or plain value
 * @param {object} [opts.privacyNode]
 * @param {(grants: {id:string,granted:boolean}[]) => void} opts.onGrant
 * @param {() => void} [opts.onRejectOptional]
 */
export function renderConsent(opts) {
  const { consentNode, privacyNode, onGrant, onRejectOptional } = opts;

  const value =
    consentNode?.value && typeof consentNode.value === 'object'
      ? consentNode.value
      : consentNode || {};

  const purposesRaw = value.purposes?.value || value.purposes || [];
  const purposes = normalizePurposes(purposesRaw);

  const wrap = document.createElement('section');
  wrap.className = 'app-section app-consent';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'Privacy preferences');

  const title = document.createElement('h2');
  title.className = 'app-section-title';
  title.textContent = consentNode?.label || 'Privacy preferences';
  wrap.appendChild(title);

  const policyUrl = nodeVal(privacyNode?.value?.policy_url) || nodeVal(value.policy_url) || null;
  if (policyUrl) {
    const a = document.createElement('a');
    a.href = String(policyUrl);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'app-consent-policy';
    a.textContent = 'Privacy policy';
    wrap.appendChild(a);
  }

  const list = document.createElement('ul');
  list.className = 'app-consent-list';

  /** @type {Map<string, HTMLInputElement>} */
  const checks = new Map();

  for (const p of purposes) {
    const li = document.createElement('li');
    li.className = 'app-consent-item';

    const id = `app-consent-${p.id}`;
    const label = document.createElement('label');
    label.className = 'app-consent-label';
    label.setAttribute('for', id);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    input.checked = p.granted || p.required || p.id === 'necessary';
    input.disabled = p.required || p.id === 'necessary';

    const text = document.createElement('span');
    text.textContent = p.label || p.id;
    if (p.required || p.id === 'necessary') {
      const badge = document.createElement('span');
      badge.className = 'app-consent-required';
      badge.textContent = ' required';
      text.appendChild(badge);
    }

    label.append(input, text);
    li.appendChild(label);
    list.appendChild(li);
    checks.set(p.id, input);
  }

  wrap.appendChild(list);

  const bar = document.createElement('div');
  bar.className = 'app-form-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'app-btn app-btn-primary';
  save.textContent = 'Save preferences';
  save.addEventListener('click', () => {
    const grants = [];
    for (const [id, input] of checks) {
      const granted = id === 'necessary' ? true : !!input.checked;
      grants.push({ id, granted });
    }
    onGrant(grants);
  });
  bar.appendChild(save);

  if (onRejectOptional) {
    const reject = document.createElement('button');
    reject.type = 'button';
    reject.className = 'app-btn app-btn-secondary';
    reject.textContent = 'Reject optional';
    reject.addEventListener('click', () => {
      for (const [id, input] of checks) {
        if (id !== 'necessary' && !input.disabled) input.checked = false;
      }
      onRejectOptional();
    });
    bar.appendChild(reject);
  }

  wrap.appendChild(bar);
  return { el: wrap };
}

function normalizePurposes(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const v = item?.value && typeof item.value === 'object' ? item.value : item;
      return {
        id: nodeVal(v?.id) || '',
        label: nodeVal(v?.label) || nodeVal(v?.id) || '',
        granted: !!nodeVal(v?.granted),
        required: !!nodeVal(v?.required),
      };
    })
    .filter((p) => p.id);
}

function nodeVal(n) {
  if (n == null) return null;
  if (typeof n === 'object' && n !== null && 'value' in n) return n.value;
  return n;
}
