/**
 * List layout — vertical stack of items (§13.2).
 */

import {
  formatStateValue,
  getByPointer,
  stateNodePlain,
  statePathToPointer,
} from '../../protocol/parse.js';

export function renderList({ section, manifest, bindings, onAction }) {
  const wrap = document.createElement('section');
  wrap.className = 'app-section app-list-section';
  wrap.dataset.sectionId = section.id || '';

  if (section.label) {
    const h = document.createElement('h2');
    h.className = 'app-section-title';
    h.textContent = section.label;
    wrap.appendChild(h);
  }

  const pointer = statePathToPointer(section.state_path || '');
  const node = getByPointer(manifest, pointer);
  let items = [];

  if (node?.type === 'array') {
    items = node.value || [];
  } else if (node?.type === 'table') {
    items = (node.rows || node.value || []).map((r) =>
      r?.type ? r : { type: 'object', fields: r },
    );
  } else if (Array.isArray(node)) {
    items = node;
  }

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'app-empty';
    empty.textContent = section.empty_message || 'No items';
    wrap.appendChild(empty);
    bindings.set(pointer, empty);
    return wrap;
  }

  const ul = document.createElement('ul');
  ul.className = 'app-list';

  const columns = section.columns || [];
  const itemKey = section.item_key || 'id';

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'app-list-item';
    const plain = stateNodePlain(item) ?? item;
    const itemPointer = `${pointer}/value/${index}`;

    if (columns.length) {
      for (const col of columns) {
        const span = document.createElement('span');
        span.className = 'app-list-cell';
        const fp = `${itemPointer}/fields/${col.key}`;
        const fn = getByPointer(manifest, fp);
        span.textContent = fn ? formatStateValue(fn, col.format) : String(plain?.[col.key] ?? '');
        bindings.set(fp, span);
        li.appendChild(span);
      }
    } else if (typeof plain === 'object' && plain) {
      const title = document.createElement('div');
      title.className = 'app-list-title';
      title.textContent =
        plain.title || plain.name || plain.label || plain[itemKey] || `Item ${index + 1}`;
      li.appendChild(title);
      const sub = document.createElement('div');
      sub.className = 'app-list-sub';
      sub.textContent = Object.entries(plain)
        .filter(([k]) => !['title', 'name', 'label', itemKey].includes(k))
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' · ');
      li.appendChild(sub);
    } else {
      li.textContent = String(plain);
    }

    if (section.primary_action) {
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      const go = () => {
        const keyVal = plain?.[itemKey] ?? index;
        onAction(section.primary_action, { [itemKey]: keyVal });
      };
      li.addEventListener('click', go);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    }

    bindings.set(itemPointer, li);
    ul.appendChild(li);
  });

  wrap.appendChild(ul);
  bindings.set(pointer, ul);
  return wrap;
}
