/**
 * Order detail - status machine, integer total+scale, items (§12 / §24.3).
 */

import { ORDER_STATUSES } from '../../protocol/validate.js';
import { formatScaledMoney as formatMoney } from '../../protocol/money.js';

const STATUS_LABELS = {
  draft: 'Draft',
  pending: 'Pending',
  awaiting_payment: 'Awaiting payment',
  awaiting_3ds: 'Awaiting 3-D Secure',
  paid: 'Paid',
  fulfilling: 'Fulfilling',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancel_pending: 'Cancel pending',
  cancelled: 'Cancelled',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
  failed: 'Failed',
};

/**
 * Legal transitions (§12.2) for UI affordances.
 */
export const ORDER_TRANSITIONS = Object.freeze({
  draft: ['pending', 'cancelled'],
  pending: ['awaiting_payment', 'cancelled', 'failed'],
  awaiting_payment: ['awaiting_3ds', 'paid', 'failed', 'cancelled'],
  awaiting_3ds: ['paid', 'failed', 'awaiting_payment'],
  paid: ['fulfilling', 'refund_pending', 'cancelled'],
  fulfilling: ['shipped', 'refund_pending', 'cancelled'],
  shipped: ['delivered', 'refund_pending'],
  delivered: ['refund_pending'],
  refund_pending: ['refunded', 'paid'],
  cancel_pending: ['cancelled', 'awaiting_payment', 'fulfilling'],
  cancelled: [],
  refunded: [],
  failed: [],
});

/**
 * @param {object} opts
 * @param {object} opts.node - order StateNode or plain value
 * @param {(actionId: string, params?: object) => void} [opts.onAction]
 * @param {object} [opts.actions] - available ActionDefs on page
 */
export function renderOrder(opts) {
  const node = opts.node;
  const value =
    node?.type === 'order' || (node?.value && typeof node.value === 'object' && node.value.status)
      ? node.value
      : node?.value && typeof node.value === 'object'
        ? node.value
        : node || {};

  const wrap = document.createElement('section');
  wrap.className = 'app-section app-order';
  wrap.setAttribute('aria-label', node?.label || 'Order');

  const title = document.createElement('h2');
  title.className = 'app-section-title';
  title.textContent = node?.label || 'Order';
  wrap.appendChild(title);

  const status = value.status;
  const statusEl = document.createElement('div');
  statusEl.className = `app-chip app-order-status app-order-status-${safeStatus(status)}`;
  statusEl.dataset.appTrack = `${opts.pointer || ''}/status`;
  statusEl.dataset.appValue = String(status ?? '');
  statusEl.textContent = STATUS_LABELS[status] || String(status || 'unknown');
  wrap.appendChild(statusEl);

  if (value.total != null && Number.isInteger(value.scale)) {
    const total = document.createElement('div');
    total.className = 'app-order-total';
    const lbl = document.createElement('span');
    lbl.className = 'app-order-total-label';
    lbl.textContent = 'Total';
    const val = document.createElement('span');
    val.className = 'app-price';
    val.dataset.appTrack = `${opts.pointer || ''}/total`;
    val.dataset.appValue = `${value.total}|${value.currency ?? ''}|${value.scale}`;
    val.textContent = formatMoney(value.total, value.scale, value.currency);
    total.append(lbl, val);
    wrap.appendChild(total);
  }

  const dl = document.createElement('dl');
  dl.className = 'app-detail-list';

  addRow(dl, 'Order ID', value.id || '');
  if (value.currency) {
    addRow(dl, 'Currency', value.currency);
  }
  if (value.created_at) addRow(dl, 'Created', formatTs(value.created_at));
  if (value.updated_at) addRow(dl, 'Updated', formatTs(value.updated_at));
  if (value.payment?.status) {
    const payStatus = String(value.payment.status);
    addRow(
      dl,
      'Payment',
      payStatus.charAt(0).toUpperCase() + payStatus.slice(1).replace(/_/g, ' '),
    );
  }
  wrap.appendChild(dl);

  const items = Array.isArray(value.items) ? value.items : [];
  if (items.length) {
    const table = document.createElement('table');
    table.className = 'app-table app-order-items';
    table.innerHTML = `<thead><tr><th>SKU</th><th>Qty</th><th>Amount</th></tr></thead>`;
    const tbody = document.createElement('tbody');
    for (const item of items.slice(0, 128)) {
      const tr = document.createElement('tr');
      const amount =
        item.amount != null && Number.isInteger(value.scale)
          ? formatMoney(item.amount, value.scale, value.currency)
          : item.amount != null
            ? String(item.amount)
            : '';
      tr.innerHTML = `<td>${escapeHtml(item.sku || '')}</td><td>${escapeHtml(String(item.qty ?? ''))}</td><td>${escapeHtml(amount)}</td>`;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
  }

  if (opts.onAction && opts.actions) {
    const bar = document.createElement('div');
    bar.className = 'app-action-bar';
    for (const [id, def] of Object.entries(opts.actions)) {
      if (!def || def.kind === 'confirm') continue;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-btn app-btn-primary';
      btn.textContent = def.description || id;
      btn.dataset.actionId = id;
      btn.addEventListener('click', () => opts.onAction(id, { order_id: value.id }));
      bar.appendChild(btn);
    }
    if (bar.childNodes.length) wrap.appendChild(bar);
  }

  return { el: wrap, status, transitions: ORDER_TRANSITIONS[status] || [] };
}

export function isValidOrderTransition(from, to) {
  if (!ORDER_STATUSES.has(from) || !ORDER_STATUSES.has(to)) return false;
  const next = ORDER_TRANSITIONS[from] || [];
  if (next.includes(to)) return true;
  // * -> failed from non-terminal except delivered
  if (to === 'failed') {
    const terminal = new Set(['delivered', 'cancelled', 'refunded', 'failed']);
    return !terminal.has(from) && from !== 'delivered';
  }
  return false;
}

function formatTs(v) {
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function safeStatus(s) {
  return ORDER_STATUSES.has(s) ? s : 'unknown';
}

function addRow(dl, label, value) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  dl.append(dt, dd);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
