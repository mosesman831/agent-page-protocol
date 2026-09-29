/**
 * Form-field rendering for the manifest → HTML renderer — action input
 * specs → HTML widgets (param_hints components pick the widget), action
 * definitions → links or POST forms that the site bridge turns back into
 * Action Requests.
 */

import { esc, moneyFmt, humanize, toSite, isMoneyNode } from './render-shared.mjs';
import { cellText, innerDl, nodeHtml } from './render-html.mjs';

export function paramHints(components = {}) {
  const hints = {};
  for (const c of Object.values(components)) {
    if (c?.action_id && c?.param != null) {
      hints[c.action_id] = hints[c.action_id] ?? {};
      hints[c.action_id][c.param] = c;
    }
  }
  return hints;
}

export function sectionHtml(sec, state) {
  const node = state?.[sec.state_path];
  if (!node) return '';
  let inner;
  if (sec.layout === 'table' || node.type === 'table') {
    inner = tableHtml(sec, node);
  } else if (sec.layout === 'dashboard') {
    inner = dashHtml(node);
  } else if (sec.layout === 'detail' && node.type === 'object') {
    inner = `<div class="objcard"><dl class="detail">${innerDl(node)}</dl></div>`;
  } else if (sec.layout === 'card') {
    inner = `<div class="card"><div class="cb">${nodeHtml(node)}</div></div>`;
  } else {
    inner = nodeHtml(node, sec.state_path);
  }
  return `<section class="sec sec-${esc(sec.layout ?? 'detail')}" id="sec-${esc(sec.id ?? '')}"><h3 class="sec-t">${esc(sec.label ?? node.label ?? sec.id ?? '')}</h3>${inner}</section>`;
}

export function tableHtml(sec, node) {
  const fields = Object.keys(node.fields ?? {});
  const cols = sec.columns?.length ? sec.columns : fields.map((f) => ({ key: f }));
  const rows = Array.isArray(node.value) ? node.value : [];
  const cell = (r, col, i) => {
    const idx = fields.indexOf(col.key);
    const v = Array.isArray(r) ? r[idx >= 0 ? idx : i] : r?.[col.key];
    if (col.format === 'currency')
      return `<td class="r num">${esc(typeof v === 'object' && v?.value != null ? (isMoneyNode(v) ? moneyFmt(v) : v.value) : isMoneyNode(v) ? moneyFmt(v) : v)}</td>`;
    if (col.format === 'number' || col.format === 'duration_min')
      return `<td class="r num">${esc(typeof v === 'object' ? (v.value ?? '') : v)}${col.format === 'duration_min' ? ' min' : ''}</td>`;
    if (col.format === 'date' || col.format === 'datetime') {
      const raw = typeof v === 'object' ? (v?.value ?? '') : v;
      const t = Date.parse(raw);
      const formatted = Number.isNaN(t)
        ? raw
        : col.format === 'date'
          ? new Date(t).toLocaleDateString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })
          : new Date(t).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              hour: 'numeric',
              minute: '2-digit',
            });
      return `<td>${esc(formatted)}</td>`;
    }
    if (col.format === 'percent') {
      const raw = typeof v === 'object' ? (v?.value ?? '') : v;
      const n = Number(raw);
      return `<td class="r num">${esc(Number.isNaN(n) ? raw : `${Math.round(n * 100)}%`)}</td>`;
    }
    const cls = col.align === 'right' ? ' class="r"' : col.align === 'center' ? ' class="c"' : '';
    return `<td${cls}>${esc(cellText(v))}</td>`;
  };
  return `<div class="tblwrap"><table><thead><tr>${cols
    .map(
      (c) =>
        `<th${c.align === 'right' ? ' class="r"' : c.align === 'center' ? ' class="c"' : ''}>${esc(c.label ?? node.fields?.[c.key]?.label ?? humanize(c.key))}</th>`,
    )
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${cols.map((c, i) => cell(r, c, i)).join('')}</tr>`)
    .join('')}</tbody></table></div>`;
}

export function dashHtml(node) {
  const items =
    node.type === 'array'
      ? (node.value ?? [])
      : Object.entries(node.value ?? {}).map(([k, v]) => ({
          label: v?.label ?? humanize(k),
          value: v?.value ?? v,
        }));
  return `<div class="strip">${items
    .map((it) => {
      const v = it?.value ?? it;
      const big = isMoneyNode(v)
        ? moneyFmt(v)
        : typeof v === 'object' && v && 'value' in v
          ? v.value
          : v;
      return `<div class="st"><b>${esc(big)}</b><span>${esc(it?.label ?? it?.title ?? '')}</span></div>`;
    })
    .join('')}</div>`;
}

/* ---------------- action inputs / forms ---------------- */

export function fieldSpan(spec, hint) {
  const t = hint?.type ?? spec.type;
  if (t === 'textarea' || t === 'checkbox_group' || spec.type === 'array' || spec.type === 'object')
    return '';
  if (t === 'slider' || t === 'radio_group' || spec.type === 'geopoint' || spec.type === 'file')
    return ' f8';
  if (spec.type === 'daterange' || spec.type === 'datetime_range' || spec.type === 'datetimerange')
    return ' f6';
  if (spec.type === 'number' || spec.type === 'quantity' || spec.type === 'money') return ' f3';
  if (spec.type === 'date' || spec.type === 'datetime') return ' f4';
  if (spec.type === 'boolean') return ' f4';
  if (spec.type === 'string' && spec.max_length != null && spec.max_length <= 12) return ' f3';
  return ' f6';
}

export function inputHtml(name, spec, values = {}, hint) {
  const desc = spec.description ?? humanize(name);
  const val = values[name] ?? spec.default ?? '';
  const req = spec.required ? ' required' : '';
  const secret = spec._secret ? 'password' : 'text';
  const id = `f_${name}`;
  const span = fieldSpan(spec, hint);
  const lbl = `<label for="${id}">${esc(desc)}${spec.required ? ' <i>*</i>' : ''}</label>`;
  const hintTxt = spec.example != null ? `<span class="hint">e.g. ${esc(spec.example)}</span>` : '';
  const ht = hint?.type;
  if (ht === 'toggle')
    return `<div class="fld switchrow${span}"><span class="switch"><input type="checkbox" id="${id}" name="${esc(name)}" value="on"${val ? ' checked' : ''}/><span class="tk"></span></span>${lbl.replace('for=', 'for=')}</div>`;
  if (ht === 'slider')
    return `<div class="fld${span}">${lbl}<input type="range" id="${id}" name="${esc(name)}" value="${esc(val)}"${spec.min != null ? ` min="${spec.min}"` : ''}${spec.max != null ? ` max="${spec.max}"` : ''} oninput="this.nextElementSibling&&(this.nextElementSibling.textContent=this.value)"/><output>${esc(val)}</output></div>`;
  if (ht === 'radio_group' && spec.options)
    return `<div class="fld${span}"><span class="fld-lab"><b>${esc(desc)}</b>${spec.required ? ' <i>*</i>' : ''}</span><div class="radios">${spec.options
      .map(
        (o) =>
          `<label><input type="radio" name="${esc(name)}" value="${esc(o)}"${o === val ? ' checked' : ''}${req}/>${esc(spec.option_labels?.[o] ?? humanize(o))}</label>`,
      )
      .join('')}</div></div>`;
  if (ht === 'checkbox_group' && spec.options)
    return `<div class="fld${span || ' f12'}"><span class="fld-lab"><b>${esc(desc)}</b></span><div class="checks">${spec.options
      .map(
        (o) =>
          `<label><input type="checkbox" name="${esc(name)}" value="${esc(o)}"${Array.isArray(val) && val.includes(o) ? ' checked' : ''}/>${esc(spec.option_labels?.[o] ?? humanize(o))}</label>`,
      )
      .join('')}</div></div>`;
  if (ht === 'textarea')
    return `<div class="fld${span || ''}">${lbl}<textarea id="${id}" name="${esc(name)}" rows="4"${req}${spec.max_length ? ` maxlength="${spec.max_length}"` : ''}>${esc(val)}</textarea></div>`;
  switch (spec.type) {
    case 'boolean':
      return `<div class="fld switchrow${span}"><span class="switch"><input type="checkbox" id="${id}" name="${esc(name)}" value="on"${val ? ' checked' : ''}/><span class="tk"></span></span><label for="${id}">${esc(desc)}</label></div>`;
    case 'enum':
      return `<div class="fld${span}">${lbl}<select id="${id}" name="${esc(name)}"${req}>${(
        spec.options ?? []
      )
        .map(
          (o) =>
            `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(spec.option_labels?.[o] ?? humanize(o))}</option>`,
        )
        .join('')}</select></div>`;
    case 'number':
    case 'quantity':
    case 'money':
      return `<div class="fld${span}">${lbl}<input type="number" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}${spec.min != null ? ` min="${spec.min}"` : ''}${spec.max != null ? ` max="${spec.max}"` : ''}/>${hintTxt}</div>`;
    case 'date':
      return `<div class="fld${span}">${lbl}<input type="date" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}/></div>`;
    case 'datetime':
      return `<div class="fld${span}">${lbl}<input type="datetime-local" id="${id}" name="${esc(name)}" value="${esc(String(val).replace(' ', 'T'))}"${req}/></div>`;
    case 'daterange':
    case 'date_range':
    case 'datetimerange':
    case 'datetime_range': {
      const v = val ?? {};
      return `<div class="fld${span}">${lbl}<div style="display:flex;gap:8px"><input type="date" name="${esc(name)}_from" value="${esc(v.from ?? '')}"/><input type="date" name="${esc(name)}_to" value="${esc(v.to ?? '')}"/></div></div>`;
    }
    case 'array':
      return `<div class="fld${span || ''}">${lbl}<input type="text" id="${id}" name="${esc(name)}" value="${esc(Array.isArray(val) ? val.join(', ') : val)}"${req} placeholder="comma separated"/>${hintTxt}</div>`;
    default:
      return `<div class="fld${span}">${lbl}<input type="${secret}" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}${spec.pattern ? ` pattern="${esc(spec.pattern)}"` : ''}${spec.min_length ? ` minlength="${spec.min_length}"` : ''}${spec.max_length ? ` maxlength="${spec.max_length}"` : ''}/>${hintTxt}</div>`;
  }
}

export function actionHtml(id, def, manifest, values = {}, hints = {}, opts = {}) {
  const url = toSite(def.action_url ?? manifest.page.url);
  const ver = manifest.page.version;
  const secretSet = new Set(def.policy?.secret_params ?? []);
  const hasInput = def.input && Object.keys(def.input).length;
  const dangerCls = def.side_effect === 'destructive' ? ' danger' : '';
  if (!hasInput && def.kind === 'navigate' && def.output?.navigates_to)
    return `<a class="btn${opts.compact ? '' : ' primary'}" href="${esc(toSite(def.output.navigates_to))}">${esc(def.description ?? humanize(id))}</a>`;
  const fields = hasInput
    ? Object.entries(def.input)
        .map(([name, spec]) =>
          inputHtml(name, { ...spec, _secret: secretSet.has(name) }, values, hints[name]),
        )
        .join('')
    : '';
  const btnCls =
    def.side_effect === 'destructive'
      ? 'btn danger'
      : def.kind === 'navigate' || def.side_effect === 'financial'
        ? 'btn primary'
        : 'btn';
  return `<form class="act${opts.compact ? ' plain' : ''}${dangerCls}" method="post" action="${esc(url)}">
<input type="hidden" name="__action" value="${esc(id)}"/>
<input type="hidden" name="__version" value="${esc(ver)}"/>
${hasInput ? `<div class="fgrid">${fields}<div class="fsub">` : ''}
<button type="submit" class="${btnCls}">${esc(def.description ?? humanize(id))}</button>${hasInput ? '</div></div>' : ''}
</form>`;
}
