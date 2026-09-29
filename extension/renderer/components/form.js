/**
 * Form layout - input-first actions (§13.2 layout "form", §13.4 inputs).
 * 1.1: secret_params → password; options_source typeahead (§10).
 */

import { createGeopointControl } from './geopoint.js';

/**
 * Render a form for one or more actions.
 * @returns {{ el: HTMLElement, collect: () => object, setErrors: (errs) => void }}
 */
export function renderForm({ actions, manifest, onSubmit, primaryActionId, onTypeahead }) {
  const form = document.createElement('form');
  form.className = 'app-form';
  form.setAttribute('novalidate', '');

  const entries = Object.entries(actions || {});
  const primaryId =
    primaryActionId || entries.find(([, a]) => a.kind !== 'confirm')?.[0] || entries[0]?.[0];

  if (!primaryId) {
    const empty = document.createElement('p');
    empty.className = 'app-empty';
    empty.textContent = 'No actions available';
    return { el: empty, collect: () => ({}), setErrors() {} };
  }

  const actionDef = actions[primaryId];
  const secretParams = new Set([
    ...(Array.isArray(actionDef?.policy?.secret_params) ? actionDef.policy.secret_params : []),
  ]);

  const fieldset = document.createElement('fieldset');
  fieldset.className = 'app-fieldset';
  const legend = document.createElement('legend');
  legend.textContent = actionDef.description || primaryId;
  fieldset.appendChild(legend);

  const inputs = actionDef.input || {};
  const fieldEls = new Map();
  const errorEls = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const typeaheadTimers = new Map();

  for (const [name, param] of Object.entries(inputs)) {
    const field = document.createElement('div');
    field.className = 'app-field';

    const label = document.createElement('label');
    label.className = 'app-label';
    const id = `app-param-${primaryId}-${name}`;
    label.setAttribute('for', id);
    label.textContent = param.description || name;
    if (param.required) {
      const req = document.createElement('span');
      req.className = 'app-required';
      req.textContent = ' *';
      req.setAttribute('aria-hidden', 'true');
      label.appendChild(req);
    }

    const isSecret = param.secret === true || secretParams.has(name);
    const control = createControl(id, name, param, manifest, { isSecret });
    const err = document.createElement('div');
    err.className = 'app-field-error';
    err.id = `${id}-error`;
    err.setAttribute('role', 'alert');
    err.hidden = true;

    control.setAttribute?.('aria-describedby', err.id);
    if (!control.getAttribute?.('aria-describedby') && control.setAttribute) {
      control.setAttribute('aria-describedby', err.id);
    }

    field.append(label, control, err);

    // Typeahead (§10)
    if (param.options_source && (param.type === 'string' || param.type === 'enum')) {
      const listId = `${id}-suggestions`;
      const datalist = document.createElement('datalist');
      datalist.id = listId;
      if (control.tagName === 'INPUT') {
        control.setAttribute('list', listId);
      }
      // Seed static options
      if (Array.isArray(param.options)) {
        for (const optVal of param.options) {
          const o = document.createElement('option');
          o.value = optVal;
          o.label = param.option_labels?.[optVal] || optVal;
          datalist.appendChild(o);
        }
      }
      field.appendChild(datalist);

      const src = param.options_source;
      const debounceMs = Math.min(2000, Math.max(0, Number(src.debounce_ms) || 200));
      const minLen = Math.min(8, Math.max(1, Number(src.min_query_length) || 1));

      control.addEventListener?.('input', () => {
        const q = control.value || '';
        clearTimeout(typeaheadTimers.get(name));
        if (q.length < minLen) return;
        typeaheadTimers.set(
          name,
          setTimeout(() => {
            const run = onTypeahead || defaultTypeaheadHint;
            void run({
              manifest,
              actions,
              source: src,
              query: q,
              datalist,
              param,
            });
          }, debounceMs),
        );
      });
    }

    fieldset.appendChild(field);
    fieldEls.set(name, control);
    errorEls.set(name, err);
  }

  form.appendChild(fieldset);

  const bar = document.createElement('div');
  bar.className = 'app-form-actions';

  for (const [id, def] of entries) {
    const btn = document.createElement('button');
    btn.type = id === primaryId ? 'submit' : 'button';
    btn.className = id === primaryId ? 'app-btn app-btn-primary' : 'app-btn app-btn-secondary';
    btn.textContent = def.confirm?.title || def.description || id;
    btn.dataset.actionId = id;
    if (id !== primaryId) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        onSubmit(id, collectParams(fieldEls, def));
      });
    }
    bar.appendChild(btn);
  }
  form.appendChild(bar);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onSubmit(primaryId, collectParams(fieldEls, actionDef));
  });

  return {
    el: form,
    collect: () => collectParams(fieldEls, actionDef),
    setErrors(errs) {
      for (const [, el] of errorEls) {
        el.hidden = true;
        el.textContent = '';
      }
      let first = null;
      for (const [name, message] of Object.entries(errs || {})) {
        const el = errorEls.get(name);
        const input = fieldEls.get(name);
        if (el) {
          el.textContent = message;
          el.hidden = false;
        }
        if (input) {
          input.setAttribute?.('aria-invalid', 'true');
          if (!first) first = input;
        }
      }
      first?.focus?.();
    },
  };
}

function createControl(id, name, param, manifest, { isSecret } = {}) {
  const type = param.type || 'string';
  let el;

  if (type === 'geopoint') {
    return createGeopointControl(id, name, param);
  }

  if (type === 'enum' && Array.isArray(param.options)) {
    el = document.createElement('select');
    el.id = id;
    el.name = name;
    if (!param.required) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-';
      el.appendChild(opt);
    }
    for (const optVal of param.options) {
      const opt = document.createElement('option');
      opt.value = optVal;
      opt.textContent = param.option_labels?.[optVal] || optVal;
      if (param.default === optVal) opt.selected = true;
      el.appendChild(opt);
    }
  } else if (type === 'boolean') {
    el = document.createElement('input');
    el.type = 'checkbox';
    el.id = id;
    el.name = name;
    el.checked = param.default === true;
  } else if (type === 'number' || type === 'money' || type === 'quantity') {
    el = document.createElement('input');
    el.type = 'number';
    el.id = id;
    el.name = name;
    if (param.min != null) el.min = param.min;
    if (param.max != null) el.max = param.max;
    if (param.default != null) el.value = param.default;
  } else if (type === 'date') {
    el = document.createElement('input');
    el.type = 'date';
    el.id = id;
    el.name = name;
    if (param.default) el.value = param.default;
  } else if (type === 'datetime') {
    el = document.createElement('input');
    el.type = 'datetime-local';
    el.id = id;
    el.name = name;
  } else if (type === 'file') {
    el = document.createElement('input');
    el.type = 'file';
    el.id = id;
    el.name = name;
    if (param.accept_mime) el.accept = String(param.accept_mime);
  } else if (isSecret || param.secret) {
    el = document.createElement('input');
    el.type = 'password';
    el.id = id;
    el.name = name;
    el.autocomplete = name === 'password' ? 'current-password' : 'off';
  } else {
    el = document.createElement(
      type === 'string' && (param.max_length || 0) > 200 ? 'textarea' : 'input',
    );
    if (el.tagName === 'INPUT') {
      el.type = 'text';
    }
    el.id = id;
    el.name = name;
    if (param.min_length != null) el.minLength = param.min_length;
    if (param.max_length != null) el.maxLength = param.max_length;
    if (param.pattern) el.pattern = param.pattern;
    if (param.default != null) el.value = param.default;
    if (param.example != null && !el.value) el.placeholder = String(param.example);
  }

  el.className = 'app-input';
  if (param.required) el.required = true;
  return el;
}

function collectParams(fieldEls, actionDef) {
  const params = {};
  const inputs = actionDef?.input || {};
  for (const [name, el] of fieldEls) {
    // Secondary buttons share the primary's fields; only send params the
    // invoked action actually declares or servers reject unknown_param.
    if (!(name in inputs)) continue;
    const def = inputs[name] || {};
    if (typeof el.getValue === 'function') {
      const v = el.getValue();
      if (v == null) {
        if (def.required) params[name] = null;
      } else {
        params[name] = v;
      }
      continue;
    }
    if (el.type === 'checkbox') {
      params[name] = el.checked;
    } else if (el.type === 'file') {
      if (el.files?.[0]) params[name] = el.files[0].name;
    } else if (def.type === 'number' || def.type === 'money' || def.type === 'quantity') {
      if (el.value === '' || el.value == null) {
        if (!def.required) continue;
        params[name] = null;
      } else {
        params[name] = Number(el.value);
      }
    } else if (def.type === 'array' || def.type === 'object') {
      // Structured params are entered as JSON text (e.g. ["a1","a2"]); a bad
      // payload is left as a string so the server's param_type error surfaces.
      const raw = el.value;
      if (raw === '' || raw == null) {
        if (def.required) params[name] = null;
        continue;
      }
      try {
        params[name] = JSON.parse(raw);
      } catch {
        params[name] = raw;
      }
    } else if (el.value === '' || el.value == null) {
      if (def.required) params[name] = '';
    } else {
      params[name] = el.value;
    }
  }
  return params;
}

/**
 * Populate datalist from a typeahead action result state (or static fallback).
 * Actual POST is performed by the renderer via onTypeahead when provided.
 */
async function defaultTypeaheadHint({ source, query, datalist, param, manifest }) {
  // Without renderer callback, keep static options only.
  void source;
  void query;
  void datalist;
  void param;
  void manifest;
}

/**
 * Apply typeahead results into a datalist element.
 * @param {HTMLDataListElement} datalist
 * @param {object} resultsNode - table or array state node
 * @param {object} source - options_source
 */
export function fillTypeaheadDatalist(datalist, resultsNode, source) {
  if (!datalist) return;
  datalist.innerHTML = '';
  const itemValue = source.item_value || 'code';
  const itemLabel = source.item_label || 'label';
  const rows = extractTypeaheadRows(resultsNode, itemValue, itemLabel);
  for (const row of rows.slice(0, 64)) {
    const o = document.createElement('option');
    o.value = row.value;
    if (row.label && row.label !== row.value) o.label = row.label;
    datalist.appendChild(o);
  }
}

function extractTypeaheadRows(node, itemValue, itemLabel) {
  if (!node) return [];
  if (node.type === 'table' && Array.isArray(node.value)) {
    const keys = Object.keys(node.fields || {});
    const vi = keys.indexOf(itemValue);
    const li = keys.indexOf(itemLabel);
    return node.value.map((row) => ({
      value: String(row[vi >= 0 ? vi : 0] ?? ''),
      label: String(row[li >= 0 ? li : vi >= 0 ? vi : 0] ?? ''),
    }));
  }
  const arr = node.type === 'array' ? node.value : Array.isArray(node) ? node : [];
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (item && typeof item === 'object') {
      const plain = item.value && typeof item.value === 'object' ? item.value : item;
      const v =
        plain[itemValue]?.value ?? plain[itemValue] ?? plain.code?.value ?? plain.code ?? '';
      const l =
        plain[itemLabel]?.value ?? plain[itemLabel] ?? plain.label?.value ?? plain.label ?? v;
      return { value: String(v), label: String(l) };
    }
    return { value: String(item), label: String(item) };
  });
}

/**
 * Render standalone action buttons (non-form pages).
 */
export function renderActionBar({ actions, onAction }) {
  const bar = document.createElement('div');
  bar.className = 'app-action-bar';
  for (const [id, def] of Object.entries(actions || {})) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn app-btn-primary';
    btn.textContent = def.description || id;
    btn.dataset.actionId = id;
    btn.addEventListener('click', () => onAction(id, {}));
    bar.appendChild(btn);
  }
  return bar;
}
