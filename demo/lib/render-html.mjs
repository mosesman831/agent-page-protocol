/**
 * Manifest → HTML renderer — the human-side reader when no extension is
 * installed. One canonical document (the manifest) renders to semantic HTML:
 * state nodes → elements, present.components → richer widgets, actions →
 * links/forms, errors → an error card. The form-POST bridge in
 * full-server.mjs turns these submissions back into wire Action Requests, so
 * DOM users and agents share one flow.
 *
 * Pure functions + small inline CSS vars from the site skin — no JS needed on
 * the page (progressive enhancement: forms post and reload).
 */

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const moneyFmt = (n) => {
  const unit = n.unit ?? 'GBP';
  const scale = n.scale ?? 2;
  return `${unit === 'GBP' ? '£' : unit + ' '}${(Number(n.value) / 10 ** scale).toLocaleString('en-GB', { minimumFractionDigits: scale, maximumFractionDigits: scale })}`;
};

const humanize = (k) =>
  String(k)
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/** site-relative path: /app/<site>/<slug> -> /site/<site>/<slug> */
const toSite = (url) => String(url ?? '').replace(/\/app\//, '/site/');

/* ---------------- node renderers ---------------- */

function nodeHtml(node, key = '') {
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
    case 'scale':
      return `${label}<dd>${esc(node.value)}/${esc(node.max ?? 10)}</dd>`;
    case 'enum': {
      const txt = node.option_labels?.[node.value] ?? node.value;
      return `${label}<dd><span class="chip">${esc(txt)}</span></dd>`;
    }
    case 'geopoint': {
      const v = node.value ?? {};
      return `${label}<dd>${esc(v.lat ?? '')}, ${esc(v.lng ?? '')}</dd>`;
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
      const items = Array.isArray(node.value) ? node.value : [];
      return `${label}<dd><ol>${items.map((i) => `<li>${esc(typeof i === 'object' ? (i.value ?? JSON.stringify(i)) : i)}</li>`).join('')}</ol></dd>`;
    }
    case 'array': {
      const items = Array.isArray(node.value) ? node.value : [];
      return `<div class="cards" data-key="${esc(key)}">${items
        .map((it) => {
          if (it && typeof it === 'object' && it.type)
            return `<article class="card"><dl>${innerDl(it)}</dl></article>`;
          if (it && typeof it === 'object')
            return `<article class="card"><dl>${Object.entries(it)
              .map(
                ([k, v]) =>
                  `<dt>${esc(humanize(k))}</dt><dd>${esc(typeof v === 'object' ? JSON.stringify(v) : v)}</dd>`,
              )
              .join('')}</dl></article>`;
          return `<article class="card">${esc(it)}</article>`;
        })
        .join('')}</div>`;
    }
    case 'table': {
      const fields = Object.keys(node.fields ?? {});
      const rows = Array.isArray(node.value) ? node.value : [];
      return `<div class="tblwrap"><table><thead><tr>${fields
        .map((f) => `<th>${esc(humanize(f))}</th>`)
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

const sandboxTokens = (n) =>
  [
    n.sandbox?.allow_scripts ? 'allow-scripts' : null,
    n.sandbox?.allow_forms ? 'allow-forms' : null,
    n.sandbox?.allow_popups ? 'allow-popups' : null,
    n.sandbox?.allow_same_origin ? 'allow-same-origin' : null,
  ]
    .filter(Boolean)
    .join(' ');

function innerDl(node) {
  return Object.entries(node.value ?? {})
    .map(([k, v]) => nodeHtml(v, k))
    .join('');
}

function cellText(c) {
  if (c && typeof c === 'object' && 'value' in c) return c.value;
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
    if (/^#{1,3}\s/.test(l)) {
      if (list) {
        html += '</ul>';
        list = false;
      }
      const level = l.match(/^#+/)[0].length + 2;
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

/* ---------------- sections / components ---------------- */

function componentHtml(comp, state) {
  const node = comp.state_path ? state?.[comp.state_path] : null;
  const type = comp.type;
  if (type === 'banner' && node) return `<div class="banner">${esc(node.value)}</div>`;
  if (type === 'gallery' && node) return nodeHtml({ ...node, type: 'media' });
  if (type === 'calendar') {
    const items = node?.value ?? [];
    const list = Array.isArray(items) ? items : [];
    return `<div class="cal"><h4>${esc(comp.label ?? node?.label ?? 'Calendar')}</h4><div class="calgrid">${list
      .map(
        (d) =>
          `<div class="calday"><span>${esc(d?.date?.value ?? d?.date ?? '')}</span><strong>${esc(d?.price?.value ? moneyFmt(d.price) : (d?.price ?? ''))}</strong></div>`,
      )
      .join('')}</div></div>`;
  }
  if (type === 'stepper' && node) {
    const max = node.max ?? 10;
    const pct = Math.min(100, Math.round((Number(node.value ?? 0) / max) * 100));
    return `<div class="stepper"><div class="stepbar"><i style="width:${pct}%"></i></div><span>${esc(comp.label ?? '')} ${pct}%</span></div>`;
  }
  if (type === 'chart' && node?.value) {
    return nodeHtml({
      type: 'table',
      fields: node.fields ?? {},
      value: node.value,
      label: comp.label,
    });
  }
  if (type === 'datepicker' && node) return nodeHtml(node);
  return '';
}

function sectionHtml(sec, state) {
  const node = state?.[sec.state_path];
  if (!node) return '';
  const inner =
    sec.layout === 'detail' && node.type === 'object'
      ? `<dl class="detail">${innerDl(node)}</dl>`
      : sec.layout === 'table' || node.type === 'table'
        ? nodeHtml({ ...node, type: 'table' })
        : sec.layout === 'grid' && node.type === 'array'
          ? nodeHtml(node, sec.state_path)
          : nodeHtml(node, sec.state_path);
  return `<section class="sec sec-${esc(sec.layout ?? 'detail')}" id="sec-${esc(sec.id ?? '')}"><h3>${esc(sec.label ?? node.label ?? sec.id ?? '')}</h3>${inner}</section>`;
}

/* ---------------- action inputs / forms ---------------- */

function inputHtml(name, spec, values = {}) {
  const desc = spec.description ?? humanize(name);
  const val = values[name] ?? spec.default ?? '';
  const req = spec.required ? ' required' : '';
  const secret = spec._secret ? ' password' : 'text';
  const id = `f_${name}`;
  const lbl = `<label for="${id}">${esc(desc)}${spec.required ? ' <i>*</i>' : ''}</label>`;
  switch (spec.type) {
    case 'boolean':
      return `<div class="fld check"><input type="checkbox" id="${id}" name="${esc(name)}" value="on"${val ? ' checked' : ''}/><label for="${id}">${esc(desc)}</label></div>`;
    case 'enum':
      return `<div class="fld">${lbl}<select id="${id}" name="${esc(name)}"${req}>${(
        spec.options ?? []
      )
        .map(
          (o) =>
            `<option value="${esc(o)}"${o === val ? ' selected' : ''}>${esc(spec.option_labels?.[o] ?? humanize(o))}</option>`,
        )
        .join('')}</select></div>`;
    case 'number':
    case 'quantity':
      return `<div class="fld">${lbl}<input type="number" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}${spec.min != null ? ` min="${spec.min}"` : ''}${spec.max != null ? ` max="${spec.max}"` : ''}/></div>`;
    case 'date':
      return `<div class="fld">${lbl}<input type="date" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}/></div>`;
    case 'daterange':
      return `<div class="fld">${lbl}<input type="date" id="${id}" name="${esc(name)}_from" value="${esc(val.from ?? '')}"/><input type="date" name="${esc(name)}_to" value="${esc(val.to ?? '')}"/></div>`;
    default:
      return `<div class="fld">${lbl}<input type="${secret}" id="${id}" name="${esc(name)}" value="${esc(val)}"${req}${spec.pattern ? ` pattern="${esc(spec.pattern)}"` : ''}${spec.min_length ? ` minlength="${spec.min_length}"` : ''}${spec.max_length ? ` maxlength="${spec.max_length}"` : ''} autocomplete="off"/></div>`;
  }
}

function actionHtml(id, def, manifest) {
  const url = toSite(def.action_url ?? manifest.page.url);
  const ver = manifest.page.version;
  const secretSet = new Set(def.policy?.secret_params ?? []);
  const hasInput = def.input && Object.keys(def.input).length;
  const confirmCls = def.requires_confirmation ? ' conf' : '';
  const dangerCls = def.kind === 'delete' || def.side_effect === 'danger' ? ' danger' : '';
  if (!hasInput && def.kind === 'navigate' && def.output?.navigates_to) {
    return `<a class="btn" href="${esc(toSite(def.output.navigates_to))}">${esc(def.description ?? humanize(id))}</a>`;
  }
  const fields = hasInput
    ? Object.entries(def.input)
        .map(([name, spec]) => inputHtml(name, { ...spec, _secret: secretSet.has(name) }))
        .join('')
    : '';
  return `<form class="act${confirmCls}${dangerCls}" method="post" action="${esc(url)}">
<input type="hidden" name="__action" value="${esc(id)}"/>
<input type="hidden" name="__version" value="${esc(ver)}"/>
${fields}
<button type="submit" class="btn${def.kind === 'navigate' ? ' primary' : ''}">${esc(def.description ?? humanize(id))}</button>
</form>`;
}

/* ---------------- page assembly ---------------- */

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
    body: `<main class="wrap"><div class="errcard"><h2>${esc(status)} — ${esc(code)}</h2><p>${esc(message)}</p>${back ? `<a class="btn" href="${esc(back)}">Go back</a>` : ''}</div></main>`,
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
    title: def.confirm?.title ?? 'Confirm',
    body: `<main class="wrap"><div class="card confcard"><h2>${esc(def.confirm?.title ?? 'Please confirm')}</h2><p>${body}</p>
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
    title: 'Verification required',
    body: `<main class="wrap"><div class="card confcard"><h2>Verification required</h2><p>${esc(challenge?.kind?.value ?? 'Verification')} — enter the code to continue.</p>
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
  const comps = Object.values(present.components ?? {})
    .map((c) => componentHtml(c, state))
    .join('');
  const sections = (present.sections ?? []).map((s) => sectionHtml(s, state)).join('');
  const acts = Object.entries(actions)
    .map(([id, def]) => actionHtml(id, def, manifest))
    .join('');
  const crumbs = (navigation.breadcrumb ?? [])
    .map((b) => `<a href="${esc(toSite(b.url))}">${esc(b.label)}</a>`)
    .join('<span class="sep">›</span>');
  const err = manifest.error
    ? `<div class="errbar">${esc(manifest.error.message ?? manifest.error.code ?? 'Error')}</div>`
    : '';
  const mainState =
    !present.sections?.length && state
      ? `<dl class="detail">${Object.entries(state)
          .map(([k, v]) => nodeHtml(v, k))
          .join('')}</dl>`
      : '';
  const hero = skin?.heroes?.[slug]
    ? `<div class="hero"><img src="${esc(skin.heroes[slug].img)}" alt=""/><div class="inner"><h2>${skin.heroes[slug].heading}</h2><p>${esc(skin.heroes[slug].sub)}</p></div></div>`
    : '';
  const promo = skin?.promos?.[slug] ?? '';
  return shell({
    skin,
    title: manifest.page.title,
    hero,
    body: `${err}<main class="wrap">
${crumbs ? `<nav class="crumbs">${crumbs}</nav>` : ''}
<h1>${esc(manifest.page.title)}</h1>
${comps}
${mainState}
${sections}
${promo}
${acts ? `<div class="actions">${acts}</div>` : ''}
</main>`,
  });
}

function shell({ skin, title, body, hero = '' }) {
  const s = skin ?? {};
  const nav = (s.nav ?? []).map((n) => `<a href="${esc(n.url)}">${esc(n.label)}</a>`).join('');
  const footer = s.footerHtml ?? '';
  const cookie = s.cookieBanner
    ? `<div class="cookie">We use cookies to make Multiversal better for humans. <form method="post" action="${esc(s.cookieAction ?? '#')}" style="display:inline"><button class="btn slim" type="submit">OK</button></form></div>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(title)}${s.brand ? ` — ${esc(s.brand)}` : ''}</title>
${s.appUrl ? `<link rel="alternate" type="application/vnd.agent-page+json" href="${esc(s.appUrl)}"/>` : ''}
<style>${css(s)}</style>
</head>
<body>
<header class="top"><a class="brand" href="${esc(s.homeUrl ?? '#')}">${s.logoHtml ?? esc(s.brand ?? '')}</a><nav>${nav}</nav></header>
${hero}
${body}
${cookie}
<footer class="foot">${footer}</footer>
</body>
</html>`;
}

function css(s) {
  const c = {
    bg: '#0b1220',
    card: '#131c33',
    ink: '#e8edf7',
    dim: '#93a0b8',
    acc: s.accent ?? '#6ea8fe',
    acc2: s.accent2 ?? '#9d6efe',
    ...(s.colors ?? {}),
  };
  return `:root{--bg:${c.bg};--card:${c.card};--ink:${c.ink};--dim:${c.dim};--acc:${c.acc};--acc2:${c.acc2}}
*{box-sizing:border-box}body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.5}
a{color:var(--acc);text-decoration:none}
.top{display:flex;align-items:center;gap:24px;padding:14px 28px;background:rgba(11,18,32,.85);backdrop-filter:blur(8px);border-bottom:1px solid #1e2a47;position:sticky;top:0;z-index:5}
.brand{font-weight:800;font-size:20px;letter-spacing:.4px;color:var(--ink)}
.brand b{color:var(--acc)}
.top nav{display:flex;gap:18px;font-size:14px}
.top nav a{color:var(--dim)}.top nav a:hover{color:var(--ink)}
.wrap{max-width:1060px;margin:0 auto;padding:26px 22px 60px}
h1{font-size:30px;margin:18px 0 6px}h3{color:var(--dim);font-size:14px;letter-spacing:.6px;text-transform:uppercase}
.crumbs{font-size:13px;color:var(--dim);margin-top:10px}.crumbs .sep{margin:0 8px;color:#445}
.crumbs a{color:var(--dim)}
.banner{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#06101f;padding:12px 16px;border-radius:10px;font-weight:600;margin:14px 0}
.detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px 26px}
dt{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
dd{margin:0 0 10px;font-size:15px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin:10px 0}
.card{background:var(--card);border:1px solid #223156;border-radius:12px;padding:14px 16px}
.card h4{margin:0 0 8px;color:var(--acc)}
.objcard{background:var(--card);border:1px solid #223156;border-radius:12px;padding:12px 16px;margin:10px 0}
.tblwrap{overflow-x:auto;margin:10px 0}
table{border-collapse:collapse;width:100%;background:var(--card);border-radius:10px;overflow:hidden}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid #223156;font-size:14px}
th{background:#0f1830;color:var(--dim);text-transform:uppercase;font-size:11px;letter-spacing:.5px}
tr:hover td{background:#182a52}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:12px 0}
.gitem{margin:0;background:var(--card);border-radius:12px;overflow:hidden;border:1px solid #223156}
.gitem img{width:100%;height:150px;object-fit:cover;display:block}
.gitem figcaption{padding:10px;font-size:13px}
.calgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}
.calday{background:var(--card);border:1px solid #223156;border-radius:8px;padding:8px;text-align:center}
.calday span{display:block;font-size:11px;color:var(--dim)}
.stepper{display:flex;align-items:center;gap:10px}.stepbar{flex:1;height:8px;background:#1c2a4d;border-radius:99px;overflow:hidden}.stepbar i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),var(--acc2))}
.embed iframe{width:100%;border:0;border-radius:12px;background:#000}
.md{max-width:70ch}.md code{background:#0f1830;padding:1px 5px;border-radius:5px}
.tree ul{list-style:none;border-left:1px solid #223156;padding-left:16px}
.fld{margin:8px 0}.fld label{display:block;font-size:12px;color:var(--dim);margin-bottom:4px}
.fld input,.fld select{width:100%;max-width:340px;padding:9px 11px;border-radius:8px;border:1px solid #2a3b63;background:#0e1830;color:var(--ink);font:inherit}
.fld.check{display:flex;align-items:center;gap:8px}.fld.check input{width:auto}
.fld.check label{margin:0;font-size:14px;color:var(--ink)}
.fld i{color:var(--acc)}
.act{margin:10px 0;padding:12px;border:1px dashed #2a3b63;border-radius:12px;background:#0e1730}
.act.conf{border-color:var(--acc)}
.act.danger{border-color:#e0607a}
.btn{display:inline-block;background:#22345f;color:var(--ink);border:1px solid #34497e;border-radius:9px;padding:9px 16px;font:inherit;font-size:14px;cursor:pointer;margin:4px 6px 4px 0}
.btn.primary{background:linear-gradient(90deg,var(--acc),var(--acc2));color:#071020;font-weight:700;border:0}
.btn.ghost{background:transparent}
.btn.slim{padding:4px 10px;font-size:12px}
.btn:hover{filter:brightness(1.15)}
.actions{margin:18px 0}
.chip{display:inline-block;background:#22345f;border-radius:99px;padding:2px 10px;font-size:12px}
.chip.yes{background:#1d5c3a}.chip.no{background:#5c2233}
.file{border:1px solid #2a3b63;padding:6px 12px;border-radius:8px}
.errbar{background:#5c2233;border:1px solid #e0607a;color:#ffd9e2;padding:10px 16px;font-weight:600}
.errcard{background:var(--card);border:1px solid #e0607a;border-radius:14px;padding:26px;margin:40px auto;max-width:560px}
.confcard{border-color:var(--acc);max-width:560px;margin:30px auto;padding:22px}
.cookie{position:fixed;bottom:0;left:0;right:0;background:#0e1730;border-top:1px solid #223156;padding:12px 22px;font-size:13px;color:var(--dim);display:flex;gap:12px;align-items:center;justify-content:center}
.foot{border-top:1px solid #1e2a47;margin-top:40px;padding:28px;color:var(--dim);font-size:13px;text-align:center}
.hero{position:relative;min-height:300px;display:flex;align-items:flex-end;overflow:hidden}
.hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.55}
.hero .inner{position:relative;padding:40px 28px;max-width:1060px;margin:0 auto;width:100%}
.hero h2{font-size:38px;margin:0;text-shadow:0 2px 14px #000}
.hero p{color:#dfe8ff;text-shadow:0 1px 8px #000}
.dim{color:var(--dim)}
${s.extraCss ?? ''}`;
}
