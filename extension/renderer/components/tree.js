/**
 * Tree node — expandable hierarchy (SPEC-WEB-NODES §1.4).
 */

function renderItems(items, depth) {
  const ul = document.createElement('ul');
  ul.className = depth === 0 ? 'app-treeview' : 'app-treeview-children';
  ul.setAttribute('role', depth === 0 ? 'tree' : 'group');
  for (const it of items) {
    const li = document.createElement('li');
    li.setAttribute('role', 'treeitem');
    if (Array.isArray(it.children) && it.children.length) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = it.label;
      det.appendChild(sum);
      det.appendChild(renderItems(it.children, depth + 1));
      li.appendChild(det);
    } else {
      const span = document.createElement('span');
      span.className = 'app-treeview-leaf';
      span.textContent = it.label;
      li.appendChild(span);
    }
    ul.appendChild(li);
  }
  return ul;
}

export function renderTree({ node }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-treeview-wrap';
  if (node.label) {
    const t = document.createElement('h3');
    t.className = 'app-treeview-title';
    t.textContent = node.label;
    wrap.appendChild(t);
  }
  wrap.appendChild(renderItems(Array.isArray(node.value) ? node.value : [], 0));
  return { el: wrap };
}
