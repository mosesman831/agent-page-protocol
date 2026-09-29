/**
 * Table layout — v0.4 table StateNodes (§5.1): fields map (insertion order) +
 * positional value row arrays. Pagination + item_label supported.
 */

import {
  formatTableCell,
  getByPointer,
  stateNodePlain,
  statePathToPointer,
  tableFieldKeys,
} from '../../protocol/parse.js';
import { resolveTableMoney } from './commerce.js';

/**
 * @param {object} opts
 * @param {object} opts.section - present section
 * @param {object} opts.manifest
 * @param {Map} opts.bindings - Map<JSONPointer, Element>
 * @param {function} opts.onAction - (actionId, params) => void
 * @returns {HTMLElement}
 */
export function renderTable({ section, manifest, bindings, onAction }) {
  const wrap = document.createElement('section');
  wrap.className = 'app-section app-table-section';
  wrap.dataset.sectionId = section.id || '';

  const pointer = statePathToPointer(section.state_path || '');
  const node = getByPointer(manifest, pointer);

  const titleText = section.label || (node && typeof node === 'object' && node.label) || null;
  if (titleText) {
    const h = document.createElement('h2');
    h.className = 'app-section-title';
    h.textContent = titleText;
    wrap.appendChild(h);
  }

  if (node?.type === 'table' && node.item_label) {
    const meta = document.createElement('p');
    meta.className = 'app-table-item-label';
    meta.textContent = node.item_label;
    wrap.appendChild(meta);
  }

  const { rows, columns, fieldTypes } = extractTableModel(node, section);
  const pagination = node?.pagination || null;

  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'app-empty';
    empty.textContent = section.empty_message || 'No items';
    wrap.appendChild(empty);
    bindings.set(pointer, empty);
    appendPagination(wrap, pagination, node?.item_label);
    return wrap;
  }

  const scroller = document.createElement('div');
  scroller.className = 'app-table-scroll';

  const table = document.createElement('table');
  table.className = 'app-table';
  table.setAttribute('role', 'table');
  if (node?.item_label) {
    table.setAttribute('aria-label', `${node.item_label} table`);
  }

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const col of columns) {
    const th = document.createElement('th');
    th.textContent = col.label || col.key;
    th.scope = 'col';
    if (col.align) th.style.textAlign = col.align;
    if (col.width) th.style.width = col.width;
    hr.appendChild(th);
  }
  if (section.primary_action) {
    const th = document.createElement('th');
    th.textContent = 'Action';
    th.scope = 'col';
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const itemKey = section.item_key || columns[0]?.key || 'id';

  rows.forEach((row, index) => {
    const tr = document.createElement('tr');
    tr.className = 'app-table-row';
    if (section.primary_action) {
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      const activate = () => {
        const keyVal = row[itemKey] ?? index;
        onAction(section.primary_action, { [itemKey]: keyVal });
      };
      tr.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        activate();
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          activate();
        }
      });
    }

    columns.forEach((col, colIndex) => {
      const td = document.createElement('td');
      if (col.align) td.style.textAlign = col.align;
      const cellPointer = `${pointer}/value/${index}/${colIndex}`;
      const cellValue = row[col.key];
      const fieldType = fieldTypes[col.key] || col.type || 'any';
      td.textContent =
        col.format === 'currency'
          ? resolveTableMoney(cellValue, col.key, manifest?.state)
          : formatTableCell(cellValue, fieldType, col.format);
      bindings.set(cellPointer, td);
      tr.appendChild(td);
    });

    if (section.primary_action) {
      const td = document.createElement('td');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn app-btn-primary app-btn-sm';
      btn.textContent = 'Select';
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const keyVal = row[itemKey] ?? index;
        onAction(section.primary_action, { [itemKey]: keyVal });
      });
      td.appendChild(btn);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  scroller.appendChild(table);
  wrap.appendChild(scroller);
  appendPagination(wrap, pagination, node?.item_label);
  bindings.set(pointer, tbody);
  return wrap;
}

/**
 * Build row objects + column descriptors from a v0.4 table node (or array fallback).
 */
function extractTableModel(node, section) {
  if (!node) {
    return { rows: [], columns: [], fieldTypes: {} };
  }

  if (node.type === 'table') {
    const keys = tableFieldKeys(node);
    const fieldTypes = {};
    if (node.fields && typeof node.fields === 'object') {
      for (const [k, t] of Object.entries(node.fields)) fieldTypes[k] = t;
    }
    const rawRows = Array.isArray(node.value)
      ? node.value
      : Array.isArray(node.rows)
        ? node.rows
        : [];
    const rows = rawRows.map((row) => {
      if (Array.isArray(row)) {
        const obj = {};
        keys.forEach((k, i) => {
          obj[k] = row[i] ?? null;
        });
        return obj;
      }
      if (row && typeof row === 'object' && row.type === 'object') {
        return stateNodePlain(row) ?? {};
      }
      return stateNodePlain(row) ?? row ?? {};
    });

    const columns =
      section.columns?.length > 0
        ? section.columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c))
        : keys.map((key) => ({
            key,
            label: key,
            type: fieldTypes[key],
          }));

    return { rows, columns, fieldTypes };
  }

  if (node.type === 'array') {
    const rows = (node.value || []).map((item) => stateNodePlain(item) ?? item);
    const columns =
      section.columns?.length > 0
        ? section.columns
        : rows.length
          ? Object.keys(rows[0] || {}).map((key) => ({ key, label: key }))
          : [];
    return { rows, columns, fieldTypes: {} };
  }

  if (Array.isArray(node)) {
    const rows = node;
    const columns =
      section.columns?.length > 0
        ? section.columns
        : rows.length
          ? Object.keys(rows[0] || {}).map((key) => ({ key, label: key }))
          : [];
    return { rows, columns, fieldTypes: {} };
  }

  return { rows: [], columns: [], fieldTypes: {} };
}

function appendPagination(wrap, pagination, itemLabel) {
  if (!pagination || typeof pagination !== 'object') return;
  const bar = document.createElement('div');
  bar.className = 'app-table-pagination';
  bar.setAttribute('role', 'status');

  const parts = [];
  if (pagination.total != null) {
    const unit = itemLabel || 'items';
    parts.push(`${pagination.total} ${unit}`);
  }
  if (pagination.has_more) {
    parts.push('More available');
  } else if (pagination.total != null) {
    parts.push('End of results');
  }
  if (pagination.cursor) {
    parts.push(`cursor: ${pagination.cursor}`);
  }

  bar.textContent = parts.join(' · ') || '';
  if (bar.textContent) wrap.appendChild(bar);
}
