/**
 * Skin harness (docs/specs/SPEC-renderer-skin-DRAFT.md §9). Mounts AppRenderer over a
 * fixture manifest and emits `PASS|FAIL <vector> <assertion>` lines into
 * #verdict. Run via chromium --headless --dump-dom (see run.sh).
 *
 * Query params:
 *   v       vector id (V-SKIN-1..6, V-SKIN-C)
 *   shadow  1 -> mount into a closed shadow root, else document mount
 *   rm      'class' -> settings.reducedMotion (.app-reduced-motion);
 *           '1' -> expects --force-prefers-reduced-motion on the CLI
 *   stage   'before' -> V-SKIN-5 stops before the paid diff (screenshot aid)
 */

import { AppRenderer, mountShadowRenderer } from '../renderer/render-root.js';
import { currencyFormatter } from '../protocol/money.js';

const q = new URLSearchParams(location.search);
const V = q.get('v') || 'V-SKIN-1';
const SHADOW = q.get('shadow') === '1';
const RM = q.get('rm');
const STAGE = q.get('stage');
const REDUCED = RM === 'class' || RM === '1';
const ORIGIN = location.origin;
const FIXTURE_ORIGIN = 'http://127.0.0.1:8765'; // literal port baked into fixtures (spec §5)
const GBP = currencyFormatter('GBP');

window.__errors = 0;
window.addEventListener('error', () => (window.__errors += 1));
window.addEventListener('unhandledrejection', () => (window.__errors += 1));

const verdictEl = document.getElementById('verdict');
const lines = [];
function out(ok, name) {
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${V}${SHADOW ? '/shadow' : ''} ${name}`);
  verdictEl.textContent = lines.join('\n');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// rAF may never fire in headless --dump-dom (no BeginFrames) - bound it.
const frame = () =>
  Promise.race([
    new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    sleep(80),
  ]);

async function fixture(name) {
  const res = await fetch(`./fixtures/${name}.json`);
  // Fixtures carry spec-literal :8765 URLs; rewrite to the serving origin so the
  // harness works on any free port.
  const doc = JSON.parse((await res.text()).split(FIXTURE_ORIGIN).join(ORIGIN));
  return doc;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------- WCAG helpers (V-SKIN-3 / V-SKIN-C) ---------- */
function parseRgb(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p));
  return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 };
}
function relLum([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(c1, c2) {
  const [l1, l2] = [relLum(c1), relLum(c2)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function firstOpaqueBg(el, root) {
  for (let e = el; e && e !== root.host && e !== document.documentElement; e = e.parentElement) {
    const bg = parseRgb(getComputedStyle(e).backgroundColor);
    if (bg && bg.a >= 0.95) return bg.rgb;
  }
  return [14, 17, 21]; // --app-bg
}
function textContrast(el, root) {
  const fg = parseRgb(getComputedStyle(el).color);
  if (!fg) return 21;
  return contrast(fg.rgb, firstOpaqueBg(el, root));
}

/* ---------- mount ---------- */
async function boot() {
  const url = `${ORIGIN}/harness/${V}`;
  const settings = { reducedMotion: RM === 'class' };
  const send = async () => null;
  let renderer;
  let shadow = null;
  if (SHADOW) {
    ({ renderer, shadow } = await mountShadowRenderer(document.getElementById('host'), {
      origin: ORIGIN,
      url,
      settings,
      stylesheetUrl: '/extension/assets/styles.css',
      fontUrl: '/extension/assets/fonts/SchibstedGrotesk-Variable.ttf',
      send,
    }));
  } else {
    renderer = new AppRenderer({ root: document, origin: ORIGIN, url, settings, send });
    renderer.mount();
  }
  const root = shadow || document;
  const sel = (s) => root.querySelector(s);
  const all = (s) => [...root.querySelectorAll(s)];
  return { renderer, root, sel, all };
}

function settleImages(root) {
  const imgs = [...root.querySelectorAll('img.app-card-img')];
  // Bounded wait: lazy/offscreen images may never dispatch load/error, and
  // virtual-time can outrun real network. Give real fetches a window, then move on.
  return Promise.race([
    Promise.all(
      imgs.map((i) =>
        i.complete
          ? Promise.resolve()
          : new Promise((r) => {
              i.addEventListener('load', r, { once: true });
              i.addEventListener('error', r, { once: true });
            }),
      ),
    ),
    sleep(900),
  ]).then(() => frame());
}

/* ---------- vectors ---------- */

async function v1(ctx) {
  const { renderer, root, all } = ctx;
  renderer.setManifest(await fixture('store'), 's-1');
  await settleImages(root);
  await document.fonts.ready;

  const cards = all('.app-card');
  out(cards.length === 4, 'card count === 4');
  const card0 = cards[0];

  const media = card0.querySelector('.app-card-media');
  const img = media?.querySelector('img.app-card-img');
  out(!!img, 'card0 has .app-card-media > img.app-card-img');
  if (img) {
    out(img.getAttribute('loading') === 'lazy' || img.loading === 'lazy', 'img loading=lazy');
    out(img.decoding === 'async', 'img decoding=async');
    out(
      (img.getAttribute('referrerpolicy') || '').toLowerCase() === 'no-referrer',
      'img no-referrer',
    );
    out(img.alt === 'London -> Dubai', 'img alt is title-derived');
    out(getComputedStyle(img).objectFit === 'cover', 'img object-fit cover');
    const box = media.getBoundingClientRect();
    out(Math.abs(box.width / box.height - 4 / 3) < 0.01, 'media aspect 4:3');
    out(img.complete && img.naturalWidth > 0, 'img loaded (naturalWidth>0)');
  }

  const price = card0.querySelector('.app-card-price');
  out(!!price, 'card0 has .app-card-price');
  if (price) {
    out(price.textContent === GBP.format(845), 'price text £845.00');
    out(getComputedStyle(price).fontSize === '28px', 'price font-size 28px');
    const pv = getComputedStyle(price).fontVariantNumeric;
    out(pv.includes('tabular-nums'), 'price tabular-nums');
    const priceSize = parseFloat(getComputedStyle(price).fontSize);
    let biggest = true;
    for (const el of card0.querySelectorAll('*')) {
      if (el === price || !el.textContent.trim()) continue;
      const s = parseFloat(getComputedStyle(el).fontSize);
      if (s >= priceSize && !el.contains(price)) biggest = false;
    }
    out(biggest, 'price is the largest text in the card');
  }

  const chip = card0.querySelector('.app-chip[data-tone="success"]');
  out(!!chip && chip.textContent === 'In stock', 'chip In stock (success)');

  let fontOk;
  try {
    fontOk = document.fonts.check('700 28px "Schibsted Grotesk"');
  } catch {
    fontOk = [...document.fonts].some((f) => /Schibsted/i.test(f.family));
  }
  out(fontOk, 'Schibsted Grotesk face loaded');
}

async function v2(ctx) {
  const { renderer, root, all } = ctx;
  const store = await fixture('store');
  renderer.setManifest(store, 's-1');
  await settleImages(root);

  const cards = all('.app-card');
  const card1 = cards[1];
  out(cards.length === 4, 'card count === 4');
  out(card1.classList.contains('app-card--noimg'), 'fl-002 card has app-card--noimg');
  const ph = card1.querySelector('.app-card-ph');
  out(!!ph && ph.getAttribute('aria-hidden') === 'true', 'placeholder aria-hidden');
  out(ph?.querySelector('.app-ph-mark')?.textContent === 'LD', 'monogram LD');
  out(card1.querySelectorAll('img').length === 0, 'zero img in card');
  const mediaBox = card1.querySelector('.app-card-media')?.getBoundingClientRect();
  out(
    mediaBox && Math.abs(mediaBox.width / mediaBox.height - 4 / 3) < 0.01,
    'placeholder keeps aspect',
  );
  out(getComputedStyle(ph).backgroundColor === 'rgb(32, 38, 46)', 'ph bg rgb(32,38,46)');
  out(
    getComputedStyle(ph.querySelector('.app-ph-mark')).color === 'rgb(170, 179, 190)',
    'ph mark rgb(170,179,190)',
  );
  out(card1.querySelector('.app-card-price')?.textContent === GBP.format(640), 'card1 £640.00');
  out(card1.querySelector('.app-card-title')?.textContent === 'London -> Dubai', 'card1 title');
  out(!!card1.querySelector('.app-btn-primary'), 'card1 button');

  // 2b: absolute URL that 404s - an <img> is created first, then replaced.
  {
    const m = clone(store);
    m.state.products.value[1].value.image = {
      type: 'string',
      value: `${ORIGIN}/extension/assets/img/missing.jpg`,
    };
    let imgAdds = 0;
    const mo = new MutationObserver((recs) => {
      for (const rec of recs) {
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          const found = [
            ...(n.matches?.('img.app-card-img') ? [n] : []),
            ...(n.querySelectorAll?.('img.app-card-img') || []),
          ];
          imgAdds += found.filter((i) => i.src.includes('missing.jpg')).length;
        }
      }
    });
    mo.observe(renderer.mainEl, { childList: true, subtree: true });
    renderer.setManifest(m, 's-1b');
    await sleep(0);
    const c1b = all('.app-card')[1];
    await settleImages(root);
    await sleep(50);
    mo.disconnect();
    out(imgAdds === 1, '2b one img.app-card-img was added before error');
    out(c1b.querySelectorAll('img.app-card-img').length === 0, '2b zero img after error');
    out(c1b.classList.contains('app-card--noimg'), '2b app-card--noimg');
    out(!!c1b.querySelector('.app-card-ph .app-ph-mark'), '2b placeholder installed');
  }

  // 2c: javascript: URL - resolver must reject, no img ever created.
  {
    const m = clone(store);
    m.state.products.value[1].value.image = { type: 'string', value: 'javascript:alert(1)' };
    let jsImg = 0;
    const mo = new MutationObserver((recs) => {
      for (const rec of recs)
        for (const n of rec.addedNodes) {
          if (n.nodeType !== 1) continue;
          jsImg += [
            ...(n.matches?.('img') ? [n] : []),
            ...(n.querySelectorAll?.('img') || []),
          ].filter((i) => (i.getAttribute('src') || '').startsWith('javascript:')).length;
        }
    });
    mo.observe(renderer.mainEl, { childList: true, subtree: true });
    renderer.setManifest(m, 's-1c');
    await settleImages(root);
    await sleep(20);
    mo.disconnect();
    const c1 = all('.app-card')[1];
    out(jsImg === 0 && !c1.querySelector('img'), '2c javascript: URL produced no img');
    out(c1.classList.contains('app-card--noimg'), '2c placeholder shown');
  }

  // 2d: images: [] - placeholder, no img.
  {
    const m = clone(store);
    const v = m.state.products.value[1].value;
    delete v.image;
    v.images = { type: 'array', value: [] };
    renderer.setManifest(m, 's-1d');
    await settleImages(root);
    const c1 = all('.app-card')[1];
    out(
      !c1.querySelector('img') && c1.classList.contains('app-card--noimg'),
      '2d empty images[] -> placeholder',
    );
  }
}

async function v3(ctx) {
  const { renderer, root, sel } = ctx;
  renderer.setManifest(await fixture('detail'), 'd-1');
  await settleImages(root);

  out(!!sel('.app-detail-hero .app-card-img'), 'hero img present');
  const price = sel('.app-price--hero');
  out(!!price, 'hero price block present');
  if (price) {
    out(price.textContent === GBP.format(912), 'hero price £912.00');
    const cs = getComputedStyle(price);
    out(parseFloat(cs.fontSize) >= 24, 'hero price >=24px');
    out(parseInt(cs.fontWeight, 10) >= 700 || cs.fontWeight === 'bold', 'hero price weight >=700');
    out(textContrast(price, root) >= 4.5, 'hero price contrast >=4.5');
    const title = sel('.app-title');
    out(
      title && parseFloat(cs.fontSize) > parseFloat(getComputedStyle(title).fontSize),
      'hero price > .app-title size',
    );
  }
  const dts = [...root.querySelectorAll('.app-detail-list dt')].map((d) => d.textContent);
  out(!dts.some((t) => /price|image/i.test(t)), 'dl excludes price/image keys');
  out(!!sel('.app-btn-primary'), 'Continue button present');
  const accepts = [...root.querySelectorAll('[data-action-id="accept_offer"]')];
  const rejects = [
    ...root.querySelectorAll(
      '.app-detail-actions .app-btn-secondary[data-action-id="reject_offer"]',
    ),
  ];
  out(accepts.length === 1, 'accept_offer button count === 1');
  out(rejects.length === 1, 'reject_offer secondary count === 1');
}

async function v4(ctx) {
  const { renderer, root, sel, all } = ctx;
  const detail = await fixture('detail');
  renderer.setManifest(detail, 'd-1');
  await frame();

  // V-SKIN-4: counter-offer diff on the detail page (price + status change).
  const diffDoc = {
    app: '1.1',
    base: { page_id: 'skin-detail', page_url: detail.page.url, version: 'd-1' },
    result_version: 'd-2',
    diff: [
      { op: 'replace', path: '/state/item/value/price/value', value: 87900 },
      { op: 'replace', path: '/state/item/value/status/value', value: 'counter_offer' },
    ],
  };
  await renderer.handleActionResult({ mode: 'diff', document: diffDoc });
  await frame();

  const price = sel('.app-price--hero');
  out(!!price && price.textContent === GBP.format(879), 'price re-rendered £879.00');
  out(!!price && price.classList.contains('app-changed'), 'price has app-changed');
  if (REDUCED || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    out(getComputedStyle(price).animationName === 'none', 'reduced-motion: tick animation off');
  } else {
    const name = getComputedStyle(price).animationName;
    out(name.includes('app-tick') && name.includes('app-tick-flash'), 'tick + flash animations');
  }
  const was = sel('.app-price-was');
  out(!!was && was.textContent === GBP.format(912), 'was-price £912.00');
  const chip = sel('.app-chip');
  out(
    !!chip && chip.dataset.tone === 'accent' && chip.textContent === 'Counter-offer',
    'chip Counter-offer accent',
  );
  out(!!sel('.app-detail-list'), 'detail list still present');

  let leaked = false;
  for (const el of root.querySelectorAll('.app-main *')) {
    const t = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join('');
    if (/^[{[]/.test(t)) leaked = true;
  }
  out(!leaked, 'no raw JSON text leaked');

  // announce() writes inside a rAF that can starve under headless dump-dom;
  // assert the contract (announce invoked with 'Updated') instead.
  const announces = [];
  const origAnnounce = renderer.announce.bind(renderer);
  renderer.announce = (t, p) => {
    announces.push(t);
    return origAnnounce(t, p);
  };
  const diffDoc2 = {
    app: '1.1',
    base: { page_id: 'skin-detail', page_url: detail.page.url, version: 'd-1' },
    result_version: 'd-3',
    diff: [{ op: 'replace', path: '/state/item/value/price/value', value: 88000 }],
  };
  renderer.setManifest(detail, 'd-1');
  await renderer.handleActionResult({ mode: 'diff', document: diffDoc2 });
  await frame();
  out(announces.includes('Updated'), 'live region announced Updated');
  renderer.announce = origAnnounce;

  // 4b: full-array replace on the store page - only the changed card ticks.
  const store = await fixture('store');
  renderer.setManifest(store, 's-1');
  await settleImages(root);
  const m2 = clone(store);
  m2.state.products.value = m2.state.products.value.map((p) => clone(p));
  m2.state.products.value[0].value.price.value = 79900;
  await renderer.handleActionResult({
    mode: 'diff',
    document: {
      app: '1.1',
      base: { page_id: 'skin-store', page_url: store.page.url, version: 's-1' },
      result_version: 's-2',
      diff: [{ op: 'replace', path: '/state/products/value', value: m2.state.products.value }],
    },
  });
  await frame();
  const cards2 = all('.app-card');
  out(cards2.length === 4, '4b still 4 cards');
  const p0 = cards2[0]?.querySelector('.app-card-price');
  out(
    !!p0 && p0.classList.contains('app-changed') && p0.textContent === GBP.format(799),
    '4b card0 price ticked to £799.00',
  );
  out(
    !!cards2[0]?.querySelector('.app-price-was') &&
      cards2[0].querySelector('.app-price-was').textContent === GBP.format(845),
    '4b was-price £845.00',
  );
  const othersUntouched = [1, 2, 3].every(
    (i) => !cards2[i].querySelector('.app-card-price')?.classList.contains('app-changed'),
  );
  out(othersUntouched, '4b only card0 ticked');
  // (4d/4e intentionally cut per §0 - not built, not asserted.)
}

async function v5(ctx) {
  const { renderer, root, sel } = ctx;
  const order = await fixture('order');
  renderer.setManifest(order, 'o-1');
  await frame();

  if (STAGE !== 'before') {
    const diffDoc = {
      app: '1.1',
      base: { page_id: 'skin-order', page_url: order.page.url, version: 'o-1' },
      result_version: 'o-2',
      diff: [
        { op: 'replace', path: '/state/order/value/status', value: 'paid' },
        { op: 'replace', path: '/state/order/value/payment/status', value: 'succeeded' },
        { op: 'remove', path: '/actions/start_pay' },
        { op: 'remove', path: '/actions/cancel_order' },
        {
          op: 'add',
          path: '/actions/request_refund',
          value: {
            kind: 'mutate',
            side_effect: 'financial',
            description: 'Request refund',
            input: {},
            output: {},
          },
        },
      ],
    };
    await renderer.handleActionResult({ mode: 'diff', document: diffDoc });

    const chip = sel('.app-order-status');
    out(!!chip, 'order status chip present');
    if (chip) {
      out(chip.classList.contains('app-order-status-paid'), 'chip paid class');
      out(chip.classList.contains('app-changed'), 'chip app-changed');
      out(chip.dataset.appPrev === 'awaiting_payment', 'chip data-app-prev');
      out(chip.textContent.trim() === 'Paid', 'chip text Paid');
      const bg0 = getComputedStyle(chip).backgroundColor;
      out(bg0 === 'rgb(47, 52, 60)', 'chip first frame rgb(47,52,60)');
      const ring = getComputedStyle(chip, '::after');
      const reducedNow = REDUCED || matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reducedNow) {
        out(ring.animationName === 'none', 'reduced-motion: ring off');
      } else {
        out(ring.animationName === 'app-ring', 'ring animation app-ring');
        out(ring.animationDuration === '0.4s', 'ring duration 0.4s');
      }
      out(getComputedStyle(chip).transitionDuration.includes('0.24s'), 'chip transition 0.24s');
      await sleep(500);
      // Transitions may freeze under virtual-time: sample the settled palette on
      // a probe element carrying the same rules minus .app-changed.
      const probe = document.createElement('span');
      probe.className = 'app-chip app-order-status app-order-status-paid';
      chip.parentElement.appendChild(probe);
      const cs = getComputedStyle(probe);
      out(cs.backgroundColor === 'rgb(38, 58, 55)', 'chip settled bg rgb(38,58,55)');
      out(cs.color === 'rgb(111, 214, 160)', 'chip settled color rgb(111,214,160)');
      probe.remove();
    }

    out(sel('.app-order-total .app-price')?.textContent === GBP.format(640), 'order total £640.00');
    const refundBtns = [...root.querySelectorAll('[data-action-id="request_refund"]')];
    out(refundBtns.length === 1, 'request_refund button count === 1');
    out(root.querySelectorAll('[data-action-id="start_pay"]').length === 0, 'start_pay removed');
    const pay = [...root.querySelectorAll('.app-detail-list dd')].find((d) =>
      /payment/i.test(d.previousElementSibling?.textContent || ''),
    );
    out(!!pay && /succeeded/i.test(pay.textContent), 'payment row humanised "Succeeded"');

    // 5b: revalidate - setManifest of the already-paid page still flashes once.
    const paid = await fixture('order-paid');
    renderer.setManifest(order, 'o-1');
    renderer.setManifest(paid, 'o-2');
    await frame();
    const chip2 = sel('.app-order-status');
    out(
      !!chip2 &&
        chip2.classList.contains('app-changed') &&
        chip2.dataset.appPrev === 'awaiting_payment',
      '5b revalidate still flashes',
    );
  } else {
    const chip = sel('.app-order-status');
    out(
      !!chip && /awaiting payment/i.test(chip.textContent),
      'stage=before shows Awaiting payment',
    );
  }
}

async function v6(ctx) {
  const { renderer, root, sel, all } = ctx;
  const extras = await fixture('extras');
  renderer.setManifest(extras, 'x-1');
  await settleImages(root);

  const cards = all('.app-card');
  out(cards.length === 4, 'extras 4 cards');
  out(!sel('img[src="x"]') && !sel('img[src="javascript:alert(1)"]'), 'no injected img');
  const c10 = cards[2];
  const badge = [...c10.querySelectorAll('.app-card-value')].map((e) => e.textContent).join('|');
  out(badge.includes('<img src=x onerror=alert(1)>'), 'badge rendered as literal text');
  out(c10.classList.contains('app-card--noimg'), 'fl-010 image:5 -> placeholder');
  const chip = c10.querySelector('.app-chip');
  out(
    !!chip && chip.dataset.tone === 'neutral' && chip.textContent === 'Back ordered',
    'fl-010 neutral Back ordered',
  );
  out(
    c10.querySelector('.app-card-price')?.textContent === '389.00',
    'fl-010 price "389.00" no symbol',
  );
  const overflow = [...cards].every((c) => c.scrollWidth <= c.clientWidth + 1);
  out(overflow, 'no card overflows horizontally');
  out(!!sel('.app-list'), 'carousel section renders as list');

  // 6c: table currency cells resolve GBP sibling (F-4).
  const priceCell = [...root.querySelectorAll('.app-table tbody tr td:nth-child(4)')][0];
  out(!!priceCell && priceCell.textContent === GBP.format(845), '6c table price £845.00');
  const noCur = clone(extras);
  delete noCur.state.currency;
  renderer.setManifest(noCur, 'x-1b');
  await frame();
  const priceCell2 = [...root.querySelectorAll('.app-table tbody tr td:nth-child(4)')][0];
  out(!!priceCell2 && priceCell2.textContent === '845.00', '6c no-currency -> "845.00"');
  renderer.setManifest(extras, 'x-1');

  // 6b: unknown state node type -> error, no crash.
  const bad = clone(extras);
  bad.state.weird = { type: 'color', value: '#fff' };
  renderer.setManifest(bad, 'x-2');
  await frame();
  const err = sel('.app-error');
  out(
    !!err && err.textContent.includes('app.err.state.unknown_type'),
    '6b unknown type -> app.err.state.unknown_type',
  );
}

async function vC(ctx) {
  const { renderer, root } = ctx;
  for (const f of ['store', 'detail', 'order', 'order-paid', 'extras']) {
    renderer.setManifest(await fixture(f), `${f}-1`);
    await frame();
    let worst = { ratio: 21, el: null };
    let failures = 0;
    for (const el of renderer.mainEl.querySelectorAll('*')) {
      if (el.closest('.app-confirm-overlay') || el.closest('.app-confirm-modal')) continue;
      if (!el.getClientRects().length) continue;
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!direct) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const bold = parseInt(cs.fontWeight, 10) >= 700 || cs.fontWeight === 'bold';
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      const ratio = textContrast(el, root);
      if (ratio < need) {
        failures++;
        if (ratio < worst.ratio) worst = { ratio, el };
      }
    }
    out(failures === 0, `${f}: all text contrast >=4.5/3.0 (${failures} failures)`);
  }
}

/* ---------- boot ---------- */
async function main() {
  const ctx = await boot();
  try {
    if (V === 'V-SKIN-1') await v1(ctx);
    else if (V === 'V-SKIN-2') await v2(ctx);
    else if (V === 'V-SKIN-3') await v3(ctx);
    else if (V === 'V-SKIN-4') await v4(ctx);
    else if (V === 'V-SKIN-5') await v5(ctx);
    else if (V === 'V-SKIN-6') await v6(ctx);
    else if (V === 'V-SKIN-C') await vC(ctx);
    else out(false, `unknown vector ${V}`);
  } catch (e) {
    out(false, `exception ${e.message}`);
  }
  out(window.__errors === 0, 'zero page errors');
  verdictEl.textContent = lines.join('\n');
}

// Top-level await delays the load event until every assertion ran - both
// --dump-dom and --screenshot then capture the final rendered state.
await main();
