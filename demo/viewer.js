/**
 * Demo viewer: mounts the real extension renderer (AppRenderer) over demo
 * manifests and acts as the host — NAVIGATE messages load the target page,
 * INVOKE_ACTION posts to the demo server and returns its ACTION_RESULT.
 *
 * URL form: /#<site>/<slug>  (e.g. /#ba/results)
 */

import { AppRenderer } from '/extension/renderer/render-root.js';
import { createMessage } from '/extension/protocol/messages.js';

const ORIGIN = location.origin;
const picker = document.getElementById('picker');
const rawLink = document.getElementById('raw');

let current = { site: 'ba', slug: 'home' };
let renderer = null;
let PAGES = {};

const send = async (msg) => {
  if (!msg || typeof msg !== 'object') return null;
  if (msg.type === 'NAVIGATE') {
    const u = new URL(msg.payload?.url || '', ORIGIN);
    const parts = u.pathname.split('/').filter(Boolean); // ['app', site, slug]
    if (parts[0] === 'app' && parts[1] && parts[2]) {
      await load(parts[1], parts[2]);
    }
    return null;
  }
  if (msg.type === 'INVOKE_ACTION') {
    const res = await fetch(`${ORIGIN}/app/${current.site}/${current.slug}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: msg.payload?.action,
        params: msg.payload?.params || {},
      }),
    });
    const payload = await res.json().catch(() => ({ mode: 'none' }));
    if (payload.mode === 'full' && payload.document) {
      const doc = payload.document;
      const parts = doc.page.url.split('/');
      const slug = parts[parts.length - 1];
      current = { ...current, slug };
      setActive();
      rawLink.innerHTML = `manifest: <a href="${doc.page.url}">${doc.page.id}@${doc.page.version}</a>`;
    }
    return createMessage('ACTION_RESULT', payload);
  }
  return null;
};

async function load(site, slug) {
  const res = await fetch(`${ORIGIN}/app/${site}/${slug}`, {
    headers: { accept: 'application/vnd.agent-page+json' },
  });
  const doc = await res.json();
  current = { site, slug };
  location.hash = `${site}/${slug}`;
  if (!renderer) {
    renderer = new AppRenderer({
      root: document,
      origin: ORIGIN,
      url: doc.page.url,
      settings: {},
      send,
    });
    renderer.mount();
  }
  renderer.setManifest(doc, doc.page.version);
  setActive();
  rawLink.innerHTML = `manifest: <a href="${doc.page.url}">${doc.page.id}@${doc.page.version}</a>`;
  window.scrollTo(0, 0);
}

const SITE_LABEL = { ba: 'British Airways', hotel: 'HotelHub', gc: 'Classroom' };

function setActive() {
  picker.querySelectorAll('a').forEach((a) => {
    a.classList.toggle('active', a.dataset.key === `${current.site}/${current.slug}`);
  });
}

async function buildPicker() {
  PAGES = await (await fetch('/demo/pages.json')).json();
  let html = '<strong>APP demos</strong>';
  for (const site of Object.keys(PAGES)) {
    html += `<span class="sep"></span><strong>${SITE_LABEL[site] || site}</strong>`;
    for (const p of PAGES[site]) {
      html += `<a href="#${site}/${p.slug}" data-key="${site}/${p.slug}">${p.slug}</a>`;
    }
  }
  picker.innerHTML = html;
  picker.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-key]');
    if (!a) return;
    e.preventDefault();
    const [site, slug] = a.dataset.key.split('/');
    load(site, slug);
  });
}

window.addEventListener('hashchange', () => {
  const [site, slug] = (location.hash || '').replace('#', '').split('/');
  if (PAGES[site] && PAGES[site].some((p) => p.slug === slug)) {
    load(site, slug);
  }
});

const [hSite, hSlug] = (location.hash || '').replace('#', '').split('/');
await buildPicker();
await load(
  PAGES[hSite] ? hSite : 'ba',
  (PAGES[hSite] || []).some((p) => p.slug === hSlug) ? hSlug : 'home',
);
