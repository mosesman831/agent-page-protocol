/**
 * OTP / MFA challenge form - page-step shape (§6.2).
 */

/**
 * @param {object} opts
 * @param {object} opts.challenge - normalized challenge fields
 * @param {object} [opts.actionDef]
 * @param {string} [opts.actionId]
 * @param {(params: object) => void} opts.onSubmit
 * @param {() => void} [opts.onResend]
 * @param {() => void} [opts.onAbandon]
 */
export function renderOtpForm(opts) {
  const { challenge, actionId = 'submit_otp', onSubmit, onResend, onAbandon } = opts;

  const wrap = document.createElement('section');
  wrap.className = 'app-section app-otp-form';
  wrap.setAttribute('aria-label', 'Verification');

  const title = document.createElement('h2');
  title.className = 'app-section-title';
  title.textContent = 'Enter verification code';
  wrap.appendChild(title);

  if (challenge?.mask) {
    const hint = document.createElement('p');
    hint.className = 'app-otp-mask';
    hint.textContent = `Code sent to ${challenge.mask}`;
    wrap.appendChild(hint);
  }

  const form = document.createElement('form');
  form.className = 'app-form';
  form.setAttribute('novalidate', '');

  const paramName = challenge?.param || 'otp';
  const length = Number(challenge?.length) || 6;
  const id = `app-otp-${paramName}`;

  const field = document.createElement('div');
  field.className = 'app-field';

  const label = document.createElement('label');
  label.className = 'app-label';
  label.setAttribute('for', id);
  label.textContent = 'Code';

  const input = document.createElement('input');
  input.id = id;
  input.name = paramName;
  input.className = 'app-input app-otp-input';
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.maxLength = length;
  input.required = true;
  if (challenge?.pattern) {
    try {
      input.pattern = challenge.pattern;
    } catch {
      /* ignore */
    }
  }

  const err = document.createElement('div');
  err.className = 'app-field-error';
  err.hidden = true;
  err.setAttribute('role', 'alert');

  field.append(label, input, err);
  form.appendChild(field);

  const bar = document.createElement('div');
  bar.className = 'app-form-actions';

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'app-btn app-btn-primary';
  submit.textContent = 'Verify';
  submit.dataset.actionId = actionId;
  bar.appendChild(submit);

  if (onResend && challenge?.resend_action) {
    const resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'app-btn app-btn-secondary';
    resend.textContent = 'Resend';
    resend.addEventListener('click', () => onResend());
    bar.appendChild(resend);
  }

  if (onAbandon) {
    const abandon = document.createElement('button');
    abandon.type = 'button';
    abandon.className = 'app-btn app-btn-secondary';
    abandon.textContent = 'Cancel';
    abandon.addEventListener('click', () => onAbandon());
    bar.appendChild(abandon);
  }

  form.appendChild(bar);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const otp = input.value.trim();
    if (!otp) {
      err.textContent = 'Enter the code';
      err.hidden = false;
      input.focus();
      return;
    }
    err.hidden = true;
    onSubmit({ [paramName]: otp });
  });

  wrap.appendChild(form);
  queueMicrotask(() => input.focus());

  return {
    el: wrap,
    setError(message) {
      err.textContent = message || '';
      err.hidden = !message;
    },
  };
}
