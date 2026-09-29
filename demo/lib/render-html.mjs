/**
 * Manifest → HTML renderer — the human-side reader when no extension is
 * installed. One canonical document (the manifest) renders to semantic HTML:
 * state nodes → elements, present.components → richer widgets, actions →
 * links/forms, errors → an error card. The form-POST bridge in
 * site-routes.mjs turns these submissions back into wire Action Requests, so
 * DOM users and agents share one flow.
 *
 * Skin contract (demo/<site>/skin.mjs):
 *   brand, homeUrl, appUrl, logoHtml, dark, colors{acc,acc2,bg,card,ink,dim,line,
 *   topBg,topInk,footBg,footInk}, nav[], utilityNav[], heroes{slug:{img,heading,
 *   sub}}, heroTabs[{label,url,slug}], heroForm{slug:actionId}, strips{slug:
 *   [{value,label}]}, promos{slug:html}, footerColumns[{heading,links}],
 *   footerNote, cookieBanner, cookieText, extraCss.
 */

import { siteCss } from './skin-css.mjs';
import { esc, moneyFmt, humanize, toSite, isMoneyNode } from './render-shared.mjs';
import { paramHints, actionHtml, inputHtml, sectionHtml } from './render-fields.mjs';

/* ---------------- node renderers ---------------- */

const stars = (value, max = 5) => {
  const full = Math.round(Number(value) || 0);
  let out = '';
  for (let i = 0; i < max; i++) out += `<span${i < full ? '' : ' class="dim"'}>★</span>`;
  return `<span class="stars">${out}</span>`;
};

export function nodeHtml(node, key = '') {
  if (node == null) return '';
  const t = node.type;
  const label = node.label ? `<dt>${esc(node.label)}</dt>` : '';
  switch (t) {
    case 'string':
      return `${label}<dd class="str">${esc(node.value)}</dd>`;
    case 'number':
      return `${label}<dd class="num">${esc(node.value)}${node.unit ? ` ${esc(node.unit)}` : ''}</dd>`;
    case 'boolean':
      return `${label}<dd><span class="chip ${node.value ? 'yes' : 'no'}">${node.value ? 'Yes' : 'No'}</span></dd>`;
    case 'money':
    case 'currency':
      return `${label}<dd class="money">${esc(moneyFmt(node))}</dd>`;
    case 'date':
    case 'datetime':
      return `${label}<dd>${esc(String(node.value).replace('T', ' ').slice(0, 16))}</dd>`;
    case 'daterange':
    case 'datetimerange': {
      const v = node.value ?? {};
      return `${label}<dd>${esc(v.from ?? v.start ?? '')} → ${esc(v.to ?? v.end ?? '')}</dd>`;
    }
    case 'quantity':
      return `${label}<dd>${esc(node.value)} ${esc(node.unit ?? '')}</dd>`;
    case 'scale': {
      const max = node.max ?? 5;
      return `${label}<dd>${max <= 5 ? stars(node.value, max) : `${esc(node.value)}/${esc(max)}`}</dd>`;
    }
    case 'enum': {
      const txt = node.option_labels?.[node.value] ?? node.value;
      return `${label}<dd><span class="chip">${esc(txt)}</span></dd>`;
    }
    case 'geopoint': {
      const v = node.value ?? {};
      return `${label}<dd><span class="pin">📍</span> ${esc(v.label ?? '')} <a href="https://www.openstreetmap.org/?mlat=${esc(v.lat)}&mlon=${esc(v.lng)}#map=14/${esc(v.lat)}/${esc(v.lng)}" rel="noopener">map</a></dd>`;
    }
    case 'null':
      return `${label}<dd class="dim">—</dd>`;
    case 'file': {
      const v = node.value ?? {};
      return `${label}<dd><a class="file" href="${esc(v.url ?? node.url ?? '#')}">${esc(v.name ?? node.name ?? 'Download')} ↓</a></dd>`;
    }
    case 'markdown':
      return `<div class="md">${mdHtml(node.value)}</div>`;
    case 'embed': {
      const url = String(node.url ?? '');
      if (!url.startsWith('https://')) return '';
      return `<figure class="embed"><iframe sandbox="${esc(sandboxTokens(node))}" src="${esc(url)}" height="${esc(node.height ?? 320)}" loading="lazy" title="${esc(node.description ?? 'embed')}"></iframe><figcaption>${esc(node.description ?? '')}</figcaption></figure>`;
    }
    case 'media': {
      const items = Array.isArray(node.value) ? node.value : [];
      if (items.length === 1) {
        const it = items[0];
        return `<figure class="gitem wide"><img src="${esc(it.url ?? it.src ?? '')}" alt="${esc(it.alt ?? '')}" loading="lazy"/></figure>`;
      }
      return `<div class="gallery">${items
        .map((it) => {
          const url = it.url ?? it.src ?? '';
          if (!/^https?:\/\//.test(url) && !url.startsWith('/')) return '';
          return `<figure class="gitem"><img src="${esc(url)}" alt="${esc(it.alt ?? it.label ?? '')}" loading="lazy"/><figcaption>${esc(it.label ?? it.alt ?? '')}</figcaption></figure>`;
        })
        .join('')}</div>`;
    }
    case 'tree':
      return `<div class="tree">${treeHtml(node.value)}</div>`;
    case 'order': {
      const v = node.value;
      const items = Array.isArray(v) ? v : Array.isArray(v?.items) ? v.items : [];
      const txt = (i) =>
        typeof i === 'object' ? (i.label ?? i.value ?? i.title ?? JSON.stringify(i)) : i;
      return `${label}<dd><ol class="orderlist">${items.map((i) => `<li>${esc(txt(i))}</li>`).join('')}</ol></dd>`;
    }
    case 'array': {
      const items = Array.isArray(node.value) ? node.value : [];
      return `<div class="cards" data-key="${esc(key)}">${items.map(cardHtml).join('')}</div>`;
    }
    case 'table': {
      const fields = Object.keys(node.fields ?? {});
      const rows = Array.isArray(node.value) ? node.value : [];
      return `<div class="tblwrap"><table><thead><tr>${fields
        .map((f) => `<th>${esc(node.fields[f]?.label ?? humanize(f))}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map(
          (r) =>
            `<tr>${fields.map((f, i) => `<td>${esc(cellText(Array.isArray(r) ? r[i] : r?.[f]))}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table></div>`;
    }
    case 'object': {
      return `<div class="objcard" data-key="${esc(key)}">${node.label ? `<h4>${esc(node.label)}</h4>` : ''}<dl>${innerDl(node)}</dl></div>`;
    }
    default: {
      const v = node && typeof node === 'object' && 'value' in node ? node.value : node;
      return `${label}<dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`;
    }
  }
}

/** One array item → a card. Image-first when the item carries a media/url/image field. */
function cardHtml(it) {
  if (!it || typeof it !== 'object')
    return `<article class="card"><div class="cb">${esc(it)}</div></article>`;
  if (it.type === 'media') return `<article class="card">${nodeHtml(it)}</article>`;
  const entries = it.type ? Object.entries(it.value ?? {}) : Object.entries(it);
  let img = '';
  const rows = [];
  for (const [k, v] of entries) {
    const n = it.type ? v : v;
    if (
      n &&
      typeof n === 'object' &&
      n.type === 'media' &&
      Array.isArray(n.value) &&
      n.value[0]?.url
    ) {
      img = `<img class="cardimg" src="${esc(n.value[0].url)}" alt="${esc(n.value[0].alt ?? '')}" loading="lazy"/>`;
      continue;
    }
    if (!it.type && typeof v === 'string' && /^https?:\/\/.*\.(jpe?g|png|webp)$/i.test(v)) {
      img = `<img class="cardimg" src="${esc(v)}" alt="${esc(k)}" loading="lazy"/>`;
      continue;
    }
    rows.push([k, n]);
  }
  const dl = rows
    .map(([k, v]) => {
      if (v && typeof v === 'object' && v.type) {
        if (v.type === 'scale') return `<dd>${stars(v.value, v.max ?? 5)}</dd>`;
        if (isMoneyNode(v) || (v.type === 'number' && v.unit))
          return `<dd><span class="price">${esc(moneyFmt(v))}</span></dd>`;
        if (v.type === 'boolean')
          return `<dd><span class="chip ${v.value ? 'yes' : 'no'}">${v.value ? 'Yes' : 'No'}</span></dd>`;
        if (v.type === 'markdown') return `<dd class="md">${mdHtml(v.value)}</dd>`;
        if (v.type === 'array')
          return `<dd><div class="chips">${(Array.isArray(v.value) ? v.value : [])
            .map(
              (c) =>
                `<span class="chip">${esc(typeof c === 'object' ? (c.value ?? '') : c)}</span>`,
            )
            .join('')}</div></dd>`;
        return `<dt>${esc(v.label ?? humanize(k))}</dt><dd>${esc(String(v.value ?? ''))}</dd>`;
      }
      return `<dt>${esc(humanize(k))}</dt><dd>${esc(String(v ?? ''))}</dd>`;
    })
    .join('');
  return `<article class="card">${img}<div class="cb"><dl>${dl}</dl></div></article>`;
}

const sandboxTokens = (n) =>
  [
    n.sandbox?.allow_scripts ? 'allow-scripts' : null,
    n.sandbox?.allow_forms ? 'allow-forms' : null,
    n.sandbox?.allow_popups ? 'allow-popups' : null,
    n.sandbox?.allow_same_origin ? 'allow-same-origin' : null,
  ]
    .filter(Boolean)
    .join(' ');

export function innerDl(node) {
  return Object.entries(node.value ?? {})
    .map(([k, v]) => nodeHtml(v, k))
    .join('');
}

export function cellText(c) {
  if (c && typeof c === 'object' && 'value' in c)
    return isMoneyNode(c) || c.unit ? moneyFmt(c) : c.value;
  return c;
}

function treeHtml(items) {
  if (!Array.isArray(items)) return '';
  return `<ul>${items
    .map((it) => {
      const label = it?.label ?? it?.value ?? '';
      const kids = it?.children ?? it?.items;
      return `<li>${esc(label)}${treeHtml(kids)}</li>`;
    })
    .join('')}</ul>`;
}

/** Safe markdown subset — never raw HTML. */
function mdHtml(src) {
  const lines = String(src ?? '').split(/\r?\n/);
  let html = '';
  let list = false;
  for (const line of lines) {
    const l = line.trimEnd();
    const inline = (s) =>
      esc(s)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(
          /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
          '<a href="$2" rel="noopener noreferrer">$1</a>',
        );
    if (/^#{1,4}\s/.test(l)) {
      if (list) {
        html += '</ul>';
        list = false;
      }
      const level = Math.min(5, l.match(/^#+/)[0].length + 2);
      html += `<h${level}>${inline(l.replace(/^#+\s*/, ''))}</h${level}>`;
    } else if (/^[-*]\s/.test(l)) {
      if (!list) {
        html += '<ul>';
        list = true;
      }
      html += `<li>${inline(l.replace(/^[-*]\s*/, ''))}</li>`;
    } else if (!l) {
      if (list) {
        html += '</ul>';
        list = false;
      }
    } else {
      if (list) {
        html += '</ul>';
        list = false;
      }
      html += `<p>${inline(l)}</p>`;
    }
  }
  if (list) html += '</ul>';
  return html;
}

/* ---------------- components ---------------- */

function chartSvg(node, kind) {
  const fields = Object.keys(node?.fields ?? {});
  const rows = Array.isArray(node?.value) ? node.value : [];
  if (!fields.length || !rows.length) return '';
  const pts = rows.map((r) => Number(cellText(Array.isArray(r) ? r[1] : r?.[fields[1]])) || 0);
  const lbls = rows.map((r) => String(cellText(Array.isArray(r) ? r[0] : r?.[fields[0]]) ?? ''));
  const W = 640;
  const H = 200;
  const P = 28;
  const max = Math.max(...pts, 1);
  if (kind === 'pie') {
    const total = pts.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cols = ['#1e3a8a', '#b78a3e', '#3b82f6', '#7c5cd6', '#14a06c', '#d0564b'];
    let acc = 0;
    const segs = pts
      .map((p, i) => {
        const r = 70;
        const circ = 2 * Math.PI * r;
        const frac = Math.max(0, p) / total;
        const seg = `<circle cx="100" cy="100" r="${r}" fill="none" stroke="${cols[i % cols.length]}" stroke-width="38" stroke-dasharray="${(frac * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(${(-90 + acc * 360).toFixed(1)} 100 100)"/>`;
        acc += frac;
        return seg;
      })
      .join('');
    const legend = lbls
      .map(
        (l, i) =>
          `<text x="205" y="${55 + i * 20}" font-size="12" fill="currentColor"><tspan fill="${cols[i % cols.length]}">■</tspan> ${esc(l)}</text>`,
      )
      .join('');
    return `<svg viewBox="0 0 340 200">${segs}${legend}</svg>`;
  }
  if (kind === 'line') {
    const step = (W - P * 2) / Math.max(pts.length - 1, 1);
    const coords = pts.map(
      (p, i) => `${(P + i * step).toFixed(1)},${(H - P - (p / max) * (H - P * 2)).toFixed(1)}`,
    );
    const dots = pts
      .map(
        (p, i) =>
          `<circle cx="${(P + i * step).toFixed(1)}" cy="${(H - P - (p / max) * (H - P * 2)).toFixed(1)}" r="4" fill="var(--acc)"/>`,
      )
      .join('');
    const xl = lbls
      .map(
        (l, i) =>
          `<text x="${(P + i * step).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${esc(l)}</text>`,
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}"><polyline points="${coords.join(' ')}" fill="none" stroke="var(--acc)" stroke-width="2.5"/>${dots}${xl}</svg>`;
  }
  // bar (default)
  const bw = (W - P * 2) / pts.length;
  const bars = pts
    .map((p, i) => {
      const h = (p / max) * (H - P * 2);
      return `<rect class="bar" x="${(P + i * bw + bw * 0.18).toFixed(1)}" y="${(H - P - h).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${h.toFixed(1)}" rx="4"/>`;
    })
    .join('');
  const xl = lbls
    .map(
      (l, i) =>
        `<text x="${(P + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">${esc(l)}</text>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}">${bars}${xl}</svg>`;
}

function componentHtml(comp, state, actions, manifest) {
  const node = comp.state_path ? state?.[comp.state_path] : null;
  const type = comp.type;
  if (type === 'hidden' || type === 'spinner') return '';
  if (comp.action_id && comp.param != null) return ''; // bound into the action form
  if (type === 'button' && comp.action_id && actions?.[comp.action_id])
    return actionHtml(comp.action_id, actions[comp.action_id], manifest, {}, {}, { compact: true });
  if (type === 'link') {
    if (comp.action_id && actions?.[comp.action_id])
      return actionHtml(
        comp.action_id,
        actions[comp.action_id],
        manifest,
        {},
        {},
        { compact: true },
      );
    if (comp.url)
      return `<a class="ctab ${comp.variant ?? ''}" href="${esc(comp.url)}">${esc(comp.label ?? comp.url)}</a>`;
    return '';
  }
  if (type === 'banner' && node)
    return `<div class="banner">${esc(node.value ?? node.label ?? '')}</div>`;
  if (type === 'gallery' && node) return nodeHtml({ ...node, type: 'media' });
  if (type === 'image' && node?.value?.[0]?.url)
    return `<figure class="gitem wide"><img src="${esc(node.value[0].url)}" alt="${esc(node.value[0].alt ?? comp.label ?? '')}"/></figure>`;
  if (type === 'price' && node)
    return `<div class="pricebig">${esc(isMoneyNode(node) ? moneyFmt(node) : (node.value ?? ''))} <small>${esc(comp.label ?? node.label ?? '')}</small></div>`;
  if (type === 'badge' && node)
    return `<span class="badge${comp.variant === 'secondary' ? ' alt' : ''}">${esc(node.value ?? comp.label ?? '')}</span>`;
  if (type === 'card' && node)
    return `<div class="card"><div class="cb">${nodeHtml(node)}</div></div>`;
  if (type === 'breadcrumbs') {
    const trail = manifest.navigation?.breadcrumb ?? [];
    return trail.length
      ? `<nav class="crumbs">${trail.map((b) => `<a href="${esc(toSite(b.url))}">${esc(b.label)}</a>`).join('<span class="sep">›</span>')}</nav>`
      : '';
  }
  if (type === 'order' && node)
    return nodeHtml({ type: 'order', value: node.value, label: comp.label ?? node.label });
  if (type === 'chart' && node)
    return `<div class="chart">${comp.label ? `<h4>${esc(comp.label)}</h4>` : ''}${chartSvg(node, comp.chart_kind ?? 'bar')}</div>`;
  if (type === 'calendar') {
    const list = Array.isArray(node?.value) ? node.value : [];
    const prices = list.map((d) => Number(d?.price?.value ?? d?.price ?? Infinity));
    const min = Math.min(...prices.filter(Number.isFinite), Infinity);
    return `<div class="cal"><h4>${esc(comp.label ?? node?.label ?? 'Calendar')}</h4><div class="calgrid">${list
      .map(
        (d) =>
          `<div class="calday${(d?.price?.value ?? d?.price) === min ? ' low' : ''}"><span>${esc(String(d?.date?.value ?? d?.date ?? '').slice(5))}</span><strong>${esc(d?.price?.value ? moneyFmt(d.price) : (d?.price ?? ''))}</strong></div>`,
      )
      .join('')}</div></div>`;
  }
  if (type === 'stepper' && node) {
    const max = node.max ?? 10;
    const pct = Math.min(100, Math.round((Number(node.value ?? 0) / max) * 100));
    return `<div class="stepper"><div class="stepbar"><i style="width:${pct}%"></i></div><span>${esc(comp.label ?? node.label ?? '')}</span></div>`;
  }
  if (type === 'tabs' && Array.isArray(comp.tabs)) {
    return `<div class="tabs">${comp.tabs
      .map(
        (t, i) =>
          `<a href="#sec-${esc(t.section)}"${i === 0 ? ' class="on"' : ''}>${esc(t.label)}</a>`,
      )
      .join('')}</div>`;
  }
  if (type === 'consent' && node)
    return `<div class="consent"><b>${esc(comp.label ?? 'Consent')}</b> ${esc(typeof node.value === 'object' ? (node.value?.text ?? '') : (node.value ?? ''))}</div>`;
  if (type === 'datepicker' && node) return nodeHtml(node);
  if (type === 'table' && node) return nodeHtml({ ...node, type: 'table' });
  return node ? nodeHtml(node, comp.state_path) : '';
}

/** Collect param-bound components: { actionId: { param: comp } } — they render inside the form. */ /* ---------------- page assembly ---------------- */

export function renderErrorPage({
  skin,
  status = 500,
  code = 'error',
  message = 'Something went wrong',
  back,
}) {
  return shell({
    skin,
    title: `Error ${status}`,
    body: `<main class="wrap tight"><div class="errcard"><h2>${esc(status)} — ${esc(code)}</h2><p>${esc(message)}</p>${back ? `<a class="btn" href="${esc(back)}">Go back</a>` : ''}</div></main>`,
  });
}

/** Confirmation step for requires_confirmation actions (428 → confirm form). */
export function renderConfirmPage({ skin, manifest, actionId, def, params, token }) {
  const url = toSite(def.action_url ?? manifest.page.url);
  const body = (def.confirm?.body_template ?? '').replace(/\{param\.(\w+)\}/g, (_, k) =>
    esc(params[k] ?? ''),
  );
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}"/>`)
    .join('');
  return shell({
    skin,
    manifest,
    title: def.confirm?.title ?? 'Confirm',
    body: `<main class="wrap tight"><div class="confcard"><h2>${esc(def.confirm?.title ?? 'Please confirm')}</h2><p>${body}</p>
<form method="post" action="${esc(url)}">
<input type="hidden" name="__action" value="${esc(actionId)}"/>
<input type="hidden" name="__version" value="${esc(manifest.page.version)}"/>
<input type="hidden" name="__confirm" value="${esc(token)}"/>
${hidden}
<button class="btn primary" type="submit">Confirm — ${esc(def.description ?? actionId)}</button>
<a class="btn ghost" href="${esc(toSite(manifest.page.url))}">Cancel</a>
</form></div></main>`,
  });
}

/** Challenge step (SPEC §18): e.g. OTP — the retry carries X-APP-Challenge. */
export function renderChallengePage({
  skin,
  manifest,
  actionId,
  def,
  params,
  challengeId,
  challenge,
}) {
  const url = toSite(def.action_url ?? manifest.page.url);
  const param = String(challenge?.param?.value ?? 'otp');
  const hidden = Object.entries(params)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}"/>`)
    .join('');
  return shell({
    skin,
    manifest,
    title: 'Verification required',
    body: `<main class="wrap tight"><div class="confcard"><h2>Verification required</h2><p>${esc(challenge?.kind?.value ?? 'Verification')} — enter the code to continue.</p>
<form method="post" action="${esc(url)}">
<input type="hidden" name="__action" value="${esc(actionId)}"/>
<input type="hidden" name="__version" value="${esc(manifest.page.version)}"/>
<input type="hidden" name="__challenge" value="${esc(challengeId)}"/>
${hidden}
<div class="fld"><label for="ch">${esc(param.toUpperCase())}</label><input type="text" id="ch" name="${esc(param)}" required autocomplete="one-time-code"/></div>
<button class="btn primary" type="submit">Verify</button>
<a class="btn ghost" href="${esc(toSite(manifest.page.url))}">Cancel</a>
</form></div></main>`,
  });
}

export function renderPage(manifest, { skin }) {
  const { state = {}, actions = {}, present = {}, navigation = {} } = manifest;
  const slug = String(manifest.page?.url ?? '')
    .split('/')
    .pop();
  const hints = paramHints(present.components);
  const bound = new Set(
    Object.values(present.components ?? {})
      .filter((c) => c.action_id && (c.type === 'button' || c.type === 'link') && c.param == null)
      .map((c) => c.action_id),
  );
  const comps = Object.values(present.components ?? {})
    .map((c) => componentHtml(c, state, actions, manifest))
    .join('');
  const sections = (present.sections ?? []).map((s) => sectionHtml(s, state)).join('');
  const acts = Object.entries(actions)
    .filter(([id]) => !bound.has(id) && id !== skin?.heroForm?.[slug])
    .map(([id, def]) => actionHtml(id, def, manifest, {}, hints[id] ?? {}))
    .join('');
  const crumbs = (navigation.breadcrumb ?? [])
    .slice(0, -1)
    .map((b) => `<a href="${esc(toSite(b.url))}">${esc(b.label)}</a>`)
    .join('<span class="sep">›</span>');
  const related = (navigation.related ?? [])
    .map((r) => `<a class="ctab" href="${esc(toSite(r.url))}">${esc(r.label)}</a>`)
    .join('');
  const err = manifest.error
    ? `<div class="errbar">${esc(manifest.error.message ?? manifest.error.code ?? 'Error')}</div>`
    : '';
  const mainState =
    !present.sections?.length && state
      ? `<dl class="detail">${Object.entries(state)
          .map(([k, v]) => nodeHtml(v, k))
          .join('')}</dl>`
      : '';
  // hero + booking widget
  const heroDef = skin?.heroes?.[slug];
  const heroActionId = skin?.heroForm?.[slug];
  const heroAction = heroActionId ? actions?.[heroActionId] : null;
  const tabs = skin?.heroTabs?.length
    ? `<div class="tabs">${skin.heroTabs.map((t) => `<a href="${esc(t.url)}"${t.slug === slug ? ' class="on"' : ''}>${esc(t.label)}</a>`).join('')}</div>`
    : '';
  const widget =
    tabs || heroAction
      ? `<div class="widget"><div class="wbody">${tabs}${
          heroAction
            ? `<form method="post" action="${esc(toSite(heroAction.action_url ?? manifest.page.url))}"><input type="hidden" name="__action" value="${esc(heroActionId)}"/><input type="hidden" name="__version" value="${esc(manifest.page.version)}"/><div class="fgrid">${Object.entries(
                heroAction.input ?? {},
              )
                .map(([name, spec]) => inputHtml(name, spec, {}, (hints[heroActionId] ?? {})[name]))
                .join(
                  '',
                )}<div class="fsub"><button class="btn primary" type="submit">${esc(heroAction.description ?? humanize(heroActionId))}</button></div></div></form>`
            : ''
        }</div></div>`
      : '';
  const strip = (skin?.strips?.[slug] ?? [])
    .map((st) => `<div class="st"><b>${esc(st.value)}</b><span>${esc(st.label)}</span></div>`)
    .join('');
  const promo = skin?.promos?.[slug] ?? '';
  const theme = present.theme ?? {};
  return shell({
    skin,
    manifest,
    title: manifest.page.title,
    hero: heroDef
      ? `<div class="hero"><img src="${esc(heroDef.img)}" alt=""/><div class="inner"><h2>${heroDef.heading}</h2><p>${esc(heroDef.sub ?? '')}</p></div></div>`
      : '',
    widget,
    themeVars: themeVars(theme, skin),
    body: `${err}<main class="wrap"${present.a11y?.live_region ? ` aria-live="${esc(present.a11y.live_region)}"` : ''}${present.a11y?.page_label ? ` aria-label="${esc(present.a11y.page_label)}"` : ''}>
${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
<h1>${esc(manifest.page.title)}</h1>
${comps}
${mainState}
${sections}
${strip ? `<div class="strip">${strip}</div>` : ''}
${promo}
${acts ? `<div class="actions">${acts}</div>` : ''}
${related ? `<div class="actions row" style="margin-top:18px">${related}</div>` : ''}
</main>`,
  });
}

function themeVars(theme, skin) {
  const p = theme.palette ?? [];
  const vars = {};
  if (p[0]) vars.bg = p[0];
  if (p[1]) vars.card = p[1];
  if (p[2]) vars.acc = p[2];
  if (theme.font_body) vars.font = theme.font_body;
  return { ...vars, dark: theme.dark ?? skin?.dark };
}

function shell({ skin, manifest, title, body, hero = '', widget = '', themeVars: tv }) {
  const s = skin ?? {};
  const util = (s.utilityNav ?? [])
    .map(
      (n, i) =>
        `${i ? '<span class="sep">·</span>' : ''}<a href="${esc(n.url)}">${esc(n.label)}</a>`,
    )
    .join('');
  const nav = (s.nav ?? []).map((n) => `<a href="${esc(n.url)}">${esc(n.label)}</a>`).join('');
  const cols = (s.footerColumns ?? [])
    .map(
      (c) =>
        `<div><h5>${esc(c.heading)}</h5>${(c.links ?? [])
          .map((l) => `<a href="${esc(l.url)}">${esc(l.label)}</a>`)
          .join('')}</div>`,
    )
    .join('');
  const footer = cols
    ? `<div class="cols">${cols}</div><div class="base">${s.footerNote ?? s.footerHtml ?? ''}</div>`
    : `<div class="base">${s.footerHtml ?? s.footerNote ?? ''}</div>`;
  const cookie = s.cookieBanner
    ? `<div class="cookie"><span>${esc(s.cookieText ?? 'We use cookies to improve your experience.')}</span><button class="btn slim" type="button" onclick="this.closest('.cookie').remove()">OK</button></div>`
    : '';
  const inlineVars = tv
    ? `:root{${Object.entries(tv)
        .filter(([k, v]) => v && k !== 'dark' && k !== 'font')
        .map(([k, v]) => `--${k === 'bg' ? 'bg' : k === 'card' ? 'card' : 'acc'}:${v}`)
        .join(';')}}`
    : '';
  const lang = manifest?.language ?? s.lang ?? 'en';
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}${s.brand ? ` — ${esc(s.brand)}` : ''}</title>
${s.appUrl ? `<link rel="alternate" type="application/vnd.agent-page+json" href="${esc(s.appUrl)}"/>` : ''}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(s.favicon ?? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">◆</text></svg>')}"/>
<style>${siteCss(s)}${inlineVars}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${util ? `<div class="topbar">${util}</div>` : ''}
<header class="top"><a class="brand" href="${esc(s.homeUrl ?? '#')}">${s.logoHtml ?? esc(s.brand ?? '')}</a><nav>${nav}</nav><div class="spacer"></div></header>
${hero}
${widget}
${body}
${cookie}
<footer class="foot">${footer}</footer>
</body>
</html>`;
}
