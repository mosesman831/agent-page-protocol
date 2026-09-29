/**
 * Detail renderer - shows a single object record in detail layout:
 * labeled field list + a primary action button.
 *
 * Store skin (store mode): when the record carries a resolvable image or
 * price, renders hero media, title, prominent price block, status chip, the
 * field list minus consumed keys, and every manifest action exactly once
 * (primary Continue + secondary buttons). Non-store records render the field
 * list as before.
 */

import { formatStateValue, getByPointer, statePathToPointer } from '../../protocol/parse.js';
import { renderEmbed } from './embed.js';
import { renderMarkdown } from './markdown.js';
import { renderMedia } from './media.js';
import { renderTree } from './tree.js';

// SPEC-WEB-NODES: a detail section bound to one of these node types renders
// the dedicated component instead of the field list.
const NODE_COMPONENT = {
  embed: renderEmbed,
  markdown: renderMarkdown,
  media: renderMedia,
  tree: renderTree,
};
import {
  buildMedia,
  fields as itemFields,
  isNode,
  plainOf,
  resolveChip,
  resolveImage,
  resolvePrice,
} from './commerce.js';

const CONSUMED_KEYS = new Set(['title', 'name', 'label', 'image', 'images']);
function formatDetail(value, fieldType, format) {
  return formatStateValue(isNode(value) ? value : { type: fieldType || 'string', value }, {
    format,
  });
}

/**
 * Locate a field's node for binding. Tries, in order:
 * /value/<key> -> /fields/<key> -> /<key> (relative to the detail node).
 */
function fieldNode(rootNode, key) {
  if (!rootNode || typeof rootNode !== 'object' || Array.isArray(rootNode)) return undefined;
  const value = rootNode.value ?? rootNode.fields;
  if (value && typeof value === 'object' && !Array.isArray(value) && key in value) {
    return value[key];
  }
  return rootNode[key];
}

export function renderDetail({ section, manifest, bindings, onAction, suppressActions }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-detail';

  const header = document.createElement('div');
  header.className = 'app-detail-header';
  const label = document.createElement('h3');
  label.className = 'app-detail-label';
  label.textContent = section.label || 'Details';
  header.appendChild(label);
  wrap.appendChild(header);

  const pointer = statePathToPointer(section.state_path || '');
  const node = getByPointer(manifest, pointer);

  if (node && NODE_COMPONENT[node.type]) {
    wrap.appendChild(NODE_COMPONENT[node.type]({ node }).el);
    if (section.primary_action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn app-btn-primary';
      btn.dataset.actionId = section.primary_action;
      btn.textContent = 'Continue';
      btn.addEventListener('click', () => onAction(section.primary_action, {}));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  const dl = document.createElement('dl');
  dl.className = 'app-detail-list';

  if (!node) {
    dl.innerHTML = '<div class="app-empty">No data</div>';
    wrap.appendChild(dl);
    return wrap;
  }

  const f = itemFields(node);
  const imageUrl = resolveImage(f, manifest.page?.url);
  const price = resolvePrice(f, section);
  const chip = resolveChip(f);
  const storeMode = !!(imageUrl || price);
  const consumed = new Set(CONSUMED_KEYS);
  if (price) consumed.add(price.key);
  if (chip) consumed.add(chip.key);

  if (storeMode) {
    wrap.appendChild(
      buildMedia({
        imageUrl,
        title: plainOf(f.title) ?? plainOf(f.name) ?? '',
        host: wrap,
        mediaClass: 'app-detail-hero',
      }),
    );

    const title = document.createElement('h3');
    title.className = 'app-detail-title';
    title.textContent = plainOf(f.title) ?? plainOf(f.name) ?? plainOf(f.label) ?? 'Details';
    wrap.appendChild(title);

    const priceBlock = document.createElement('div');
    priceBlock.className = 'app-price-block';
    if (price) {
      const priceEl = document.createElement('span');
      priceEl.className = 'app-price app-price--hero';
      priceEl.textContent = price.text;
      priceEl.dataset.appTrack = `${pointer}|price`;
      priceEl.dataset.appValue = `${price.raw}|${price.unit}|${price.scale}`;
      priceBlock.appendChild(priceEl);
    }
    if (chip) {
      const chipEl = document.createElement('span');
      chipEl.className = 'app-chip';
      chipEl.dataset.tone = chip.tone;
      chipEl.dataset.appTrack = `${pointer}|${chip.key}`;
      chipEl.dataset.appValue = chip.value;
      chipEl.textContent = chip.label;
      priceBlock.appendChild(chipEl);
    }
    wrap.appendChild(priceBlock);

    if (!suppressActions) {
      const actionBar = document.createElement('div');
      actionBar.className = 'app-detail-actions';
      if (section.primary_action) {
        const primary = document.createElement('button');
        primary.type = 'button';
        primary.className = 'app-btn app-btn-primary';
        primary.dataset.actionId = section.primary_action;
        primary.textContent = 'Continue';
        primary.addEventListener('click', () => onAction(section.primary_action, {}));
        actionBar.appendChild(primary);
      }
      const itemKey = section.item_key;
      const keyVal = itemKey ? plainOf(f[itemKey]) : null;
      Object.entries(manifest.actions || {})
        .filter(([id, a]) => id !== section.primary_action && a && a.kind !== 'confirm')
        .forEach(([id, a]) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'app-btn app-btn-secondary';
          btn.dataset.actionId = id;
          btn.textContent = a.description || a.label || id;
          btn.addEventListener('click', () =>
            onAction(id, keyVal != null ? { [itemKey]: keyVal } : {}),
          );
          actionBar.appendChild(btn);
        });
      if (actionBar.children.length) {
        wrap.appendChild(actionBar);
      }
    }
  }

  const entries = Object.entries(f).filter(([key]) => !consumed.has(key));

  entries.forEach(([key, fieldValue]) => {
    const fieldNode_ = fieldNode(node, key);
    const dt = document.createElement('dt');
    dt.textContent = fieldNode_?.label || key;
    const dd = document.createElement('dd');
    const format = fieldNode_?.format;
    dd.textContent = formatDetail(plainOf(fieldValue), fieldNode_?.type, format);
    dl.appendChild(dt);
    dl.appendChild(dd);
    if (bindings) {
      const innerPtr =
        node.value !== undefined && isNode(node)
          ? `${pointer}/value/${key}`
          : isNode(node)
            ? `${pointer}/fields/${key}`
            : `${pointer}/${key}`;
      bindings.set(innerPtr, dd);
    }
  });

  wrap.appendChild(dl);

  if (!storeMode && section.primary_action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-btn app-btn-primary';
    btn.dataset.actionId = section.primary_action;
    btn.textContent = 'Continue';
    btn.addEventListener('click', () => onAction(section.primary_action, {}));
    wrap.appendChild(btn);
  }

  return wrap;
}
