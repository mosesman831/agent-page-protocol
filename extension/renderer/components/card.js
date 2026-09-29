/**
 * Card component / grid-of-cards layout (§13.2 grid, §13.4 card).
 *
 * Store skin: when any item in a collection resolves an image or a price,
 * cards render in store mode - 4:3 media slot (or typographic placeholder),
 * prominent price, status chip. Grids with neither render as before.
 */

import {
  formatStateValue,
  getByPointer,
  stateNodePlain,
  statePathToPointer,
} from '../../protocol/parse.js';
import {
  buildMedia,
  fields as itemFields,
  plainOf,
  resolveChip,
  resolveImage,
  resolvePrice,
} from './commerce.js';

const STORE_CONSUMED = new Set(['title', 'name', 'label', 'image', 'images']);

export function renderCard({ section, manifest, bindings, onAction }) {
  const wrap = document.createElement('section');
  wrap.className = 'app-section app-card-section';
  wrap.dataset.sectionId = section.id || '';

  if (section.label) {
    const h = document.createElement('h2');
    h.className = 'app-section-title';
    h.textContent = section.label;
    wrap.appendChild(h);
  }

  const pointer = statePathToPointer(section.state_path || '');
  const node = getByPointer(manifest, pointer);

  // Single object → one card; array → card grid
  if (node?.type === 'array' || node?.type === 'table') {
    const grid = document.createElement('div');
    grid.className = 'app-card-grid';
    const items = node.type === 'array' ? node.value || [] : node.rows || node.value || [];

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'app-empty';
      empty.textContent = section.empty_message || 'No items';
      wrap.appendChild(empty);
      bindings.set(pointer, empty);
      return wrap;
    }

    const itemKey = section.item_key || 'id';
    const columns = section.columns || [];

    const prepared = items.map((item, index) => {
      const plain = stateNodePlain(item) ?? item;
      const f = itemFields(item, node);
      const imageUrl = resolveImage(f, manifest.page?.url);
      const price = resolvePrice(f, section);
      const chip = resolveChip(f);
      const title =
        plain?.title || plain?.name || plain?.label || plain?.[itemKey] || `Item ${index + 1}`;
      const consumed = new Set(STORE_CONSUMED);
      if (price) consumed.add(price.key);
      if (chip) consumed.add(chip.key);
      return { item, index, plain, f, imageUrl, price, chip, title, consumed };
    });

    const storeMode = prepared.some((p) => p.imageUrl || p.price);

    prepared.forEach((p) => {
      const card = document.createElement('article');
      card.className = storeMode ? 'app-card app-card--product' : 'app-card';
      const itemPointer = `${pointer}/value/${p.index}`;

      if (storeMode) {
        card.appendChild(buildMedia({ imageUrl: p.imageUrl, title: p.title, host: card }));

        const body = document.createElement('div');
        body.className = 'app-card-body';

        const head = document.createElement('div');
        head.className = 'app-card-head';
        const title = document.createElement('h3');
        title.className = 'app-card-title';
        title.textContent = p.title;
        head.appendChild(title);
        if (p.chip) {
          const chipEl = document.createElement('span');
          chipEl.className = 'app-chip';
          chipEl.dataset.tone = p.chip.tone;
          chipEl.textContent = p.chip.label;
          head.appendChild(chipEl);
        }
        body.appendChild(head);

        if (p.price) {
          const priceEl = document.createElement('p');
          priceEl.className = 'app-card-price app-price';
          priceEl.textContent = p.price.text;
          const keyVal = p.plain?.[itemKey] ?? p.index;
          priceEl.dataset.appTrack = `${pointer}|${keyVal}|price`;
          priceEl.dataset.appValue = `${p.price.raw}|${p.price.unit}|${p.price.scale}`;
          body.appendChild(priceEl);
        }

        const fields = p.f;
        if (columns.length) {
          for (const col of columns) {
            if (!col || p.consumed.has(col.key)) continue;
            const raw = fields[col.key];
            if (raw == null) continue;
            const row = document.createElement('div');
            row.className = 'app-card-row';
            const lab = document.createElement('span');
            lab.className = 'app-card-label';
            lab.textContent = col.label || col.key;
            const val = document.createElement('span');
            val.className = 'app-card-value';
            const fp = `${itemPointer}/fields/${col.key}`;
            const fn = getByPointer(manifest, fp);
            val.textContent = fn
              ? formatStateValue(fn, col.format)
              : formatStateValue(raw, { format: col.format });
            bindings.set(fp, val);
            row.append(lab, val);
            body.appendChild(row);
          }
        } else {
          let shown = 0;
          for (const [k, raw] of Object.entries(fields)) {
            if (shown >= 8) break;
            if (p.consumed.has(k)) continue;
            const v = plainOf(raw);
            if (v == null) continue;
            const row = document.createElement('div');
            row.className = 'app-card-row';
            const lab = document.createElement('span');
            lab.className = 'app-card-label';
            lab.textContent = k;
            const val = document.createElement('span');
            val.className = 'app-card-value';
            const fp = `${itemPointer}/fields/${k}`;
            const fn = getByPointer(manifest, fp);
            val.textContent = fn ? formatStateValue(fn, null) : formatStateValue(raw, null);
            bindings.set(fp, val);
            row.append(lab, val);
            body.appendChild(row);
            shown += 1;
          }
        }

        if (section.primary_action) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'app-btn app-btn-primary app-btn-sm';
          btn.dataset.actionId = section.primary_action;
          btn.textContent = 'Select';
          btn.addEventListener('click', () => {
            onAction(section.primary_action, { [itemKey]: p.plain?.[itemKey] ?? p.index });
          });
          body.appendChild(btn);
        }
        card.appendChild(body);
      } else {
        const title = document.createElement('h3');
        title.className = 'app-card-title';
        title.textContent = p.title;
        card.appendChild(title);

        const body = document.createElement('div');
        body.className = 'app-card-body';
        if (columns.length) {
          for (const col of columns) {
            const row = document.createElement('div');
            row.className = 'app-card-row';
            const lab = document.createElement('span');
            lab.textContent = col.label || col.key;
            const val = document.createElement('span');
            const fp = `${itemPointer}/fields/${col.key}`;
            const fn = getByPointer(manifest, fp);
            val.textContent = fn
              ? formatStateValue(fn, col.format)
              : String(p.plain?.[col.key] ?? '');
            bindings.set(fp, val);
            row.append(lab, val);
            body.appendChild(row);
          }
        } else if (typeof p.plain === 'object' && p.plain) {
          for (const [k, v] of Object.entries(p.plain).slice(0, 8)) {
            if (k === 'title' || k === 'name') continue;
            const row = document.createElement('div');
            row.className = 'app-card-row';
            const lab = document.createElement('span');
            lab.textContent = k;
            const val = document.createElement('span');
            val.textContent = String(v);
            row.append(lab, val);
            body.appendChild(row);
          }
        }
        card.appendChild(body);

        if (section.primary_action) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'app-btn app-btn-primary app-btn-sm';
          btn.dataset.actionId = section.primary_action;
          btn.textContent = 'Select';
          btn.addEventListener('click', () => {
            onAction(section.primary_action, { [itemKey]: p.plain?.[itemKey] ?? p.index });
          });
          card.appendChild(btn);
        }
      }

      bindings.set(itemPointer, card);
      grid.appendChild(card);
    });

    wrap.appendChild(grid);
    bindings.set(pointer, grid);
    return wrap;
  }

  // Single object card
  const card = buildObjectCard(node, pointer, section, manifest, bindings, onAction);
  wrap.appendChild(card);
  bindings.set(pointer, card);
  return wrap;
}

function buildObjectCard(node, pointer, section, manifest, bindings, onAction) {
  const card = document.createElement('article');
  card.className = 'app-card app-card-single';
  const plain = stateNodePlain(node) ?? {};

  const title = document.createElement('h3');
  title.className = 'app-card-title';
  title.textContent = section.label || plain.title || plain.name || 'Details';
  card.appendChild(title);

  const body = document.createElement('div');
  body.className = 'app-card-body';
  const columns = section.columns;
  const keys = columns
    ? columns.map((c) => c.key)
    : Object.keys(typeof plain === 'object' ? plain : {});

  for (const key of keys) {
    const col = columns?.find((c) => c.key === key) || { key, label: key };
    const row = document.createElement('div');
    row.className = 'app-card-row';
    const lab = document.createElement('span');
    lab.textContent = col.label || key;
    const val = document.createElement('span');
    const fp = `${pointer}/fields/${key}`;
    const fn = getByPointer(manifest, fp);
    val.textContent = fn ? formatStateValue(fn, col.format) : String(plain?.[key] ?? '');
    bindings.set(fp, val);
    row.append(lab, val);
    body.appendChild(row);
  }
  card.appendChild(body);

  if (section.primary_action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn app-btn-primary';
    btn.dataset.actionId = section.primary_action;
    btn.textContent = 'Continue';
    const itemKey = section.item_key || 'id';
    btn.addEventListener('click', () => {
      onAction(section.primary_action, {
        [itemKey]: plain?.[itemKey],
      });
    });
    card.appendChild(btn);
  }
  return card;
}
