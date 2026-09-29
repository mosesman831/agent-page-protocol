/**
 * Tree fallback when /present is absent (§13).
 * Renders typed state as an expandable tree + action forms.
 */

import { formatStateValue } from '../../protocol/parse.js';
import { renderForm } from './form.js';
import { renderTable } from './table.js';
import { renderEmbed } from './embed.js';
import { renderMarkdown } from './markdown.js';
import { renderMedia } from './media.js';
import { renderTree } from './tree.js';

const NODE_RENDERERS = {
  embed: (node) => renderEmbed({ node }).el,
  markdown: (node) => renderMarkdown({ node }).el,
  media: (node) => renderMedia({ node }).el,
  tree: (node) => renderTree({ node }).el,
};

export function renderTreeFallback({ manifest, bindings, onAction }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-tree-fallback';

  const stateSection = document.createElement('section');
  stateSection.className = 'app-section';
  const h = document.createElement('h2');
  h.className = 'app-section-title';
  h.textContent = 'State';
  stateSection.appendChild(h);

  const tree = document.createElement('ul');
  tree.className = 'app-tree';
  tree.setAttribute('role', 'tree');

  for (const [key, node] of Object.entries(manifest.state || {})) {
    if (node?.type === 'table') {
      const section = {
        id: key,
        label: node.label || key,
        state_path: key,
        empty_message: 'No items',
      };
      const tableEl = renderTable({ section, manifest, bindings, onAction });
      const li = document.createElement('li');
      li.className = 'app-tree-node';
      li.appendChild(tableEl);
      tree.appendChild(li);
      continue;
    }
    tree.appendChild(renderNode(key, node, `/state/${key}`, bindings));
  }
  stateSection.appendChild(tree);
  wrap.appendChild(stateSection);

  if (manifest.actions && Object.keys(manifest.actions).length) {
    const actionsSection = document.createElement('section');
    actionsSection.className = 'app-section';
    const ah = document.createElement('h2');
    ah.className = 'app-section-title';
    ah.textContent = 'Actions';
    actionsSection.appendChild(ah);

    // One form per action (or combined if single)
    const ids = Object.keys(manifest.actions);
    if (ids.length === 1) {
      const { el } = renderForm({
        actions: manifest.actions,
        manifest,
        bindings,
        onSubmit: onAction,
        primaryActionId: ids[0],
      });
      actionsSection.appendChild(el);
    } else {
      for (const id of ids) {
        const subset = { [id]: manifest.actions[id] };
        const { el } = renderForm({
          actions: subset,
          manifest,
          bindings,
          onSubmit: onAction,
          primaryActionId: id,
        });
        actionsSection.appendChild(el);
      }
    }
    wrap.appendChild(actionsSection);
  }

  return wrap;
}

function renderNode(key, node, pointer, bindings) {
  const li = document.createElement('li');
  li.className = 'app-tree-node';
  li.setAttribute('role', 'treeitem');

  const label = document.createElement('div');
  label.className = 'app-tree-label';

  const name = document.createElement('span');
  name.className = 'app-tree-key';
  name.textContent = node?.label || key;

  const type = document.createElement('span');
  type.className = 'app-tree-type';
  type.textContent = node?.type || typeof node;

  label.append(name, type);

  if (!node || typeof node !== 'object' || !node.type) {
    const val = document.createElement('span');
    val.className = 'app-tree-value';
    val.textContent = String(node);
    label.appendChild(val);
    li.appendChild(label);
    bindings.set(pointer, val);
    return li;
  }

  if (node.type === 'object') {
    const fields = node.value || node.fields || {};
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.appendChild(label);
    details.appendChild(summary);
    const children = document.createElement('ul');
    children.setAttribute('role', 'group');
    for (const [k, v] of Object.entries(fields)) {
      children.appendChild(renderNode(k, v, `${pointer}/value/${k}`, bindings));
    }
    details.appendChild(children);
    li.appendChild(details);
    bindings.set(pointer, li);
    return li;
  }

  if (node.type === 'array') {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.appendChild(label);
    details.appendChild(summary);
    const children = document.createElement('ul');
    children.setAttribute('role', 'group');
    (node.value || []).forEach((item, i) => {
      children.appendChild(renderNode(String(i), item, `${pointer}/value/${i}`, bindings));
    });
    details.appendChild(children);
    li.appendChild(details);
    bindings.set(pointer, li);
    return li;
  }

  if (node.type === 'table') {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.appendChild(label);
    details.appendChild(summary);
    const pre = document.createElement('pre');
    pre.className = 'app-tree-value';
    pre.textContent = formatStateValue(node);
    details.appendChild(pre);
    li.appendChild(details);
    bindings.set(pointer, pre);
    return li;
  }

  if (NODE_RENDERERS[node.type]) {
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.appendChild(label);
    details.appendChild(summary);
    details.appendChild(NODE_RENDERERS[node.type](node));
    li.appendChild(details);
    bindings.set(pointer, li);
    return li;
  }

  const val = document.createElement('span');
  val.className = 'app-tree-value';
  val.textContent = formatStateValue(node);
  label.appendChild(val);
  li.appendChild(label);
  bindings.set(pointer, val);
  return li;
}
