/**
 * Calendar componentHint — month grid over an array of {date,label?} items
 * or a daterange node (SPEC-WEB-NODES §2). Renders the month containing
 * the first item; items mark their day cells.
 */

export function renderCalendar({ node }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-calendar';
  const items = Array.isArray(node.value) ? node.value : [];
  const marked = new Map();
  let first = null;
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const d = typeof it.date === 'string' ? it.date : it.value?.from;
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    if (!marked.has(d)) marked.set(d, []);
    if (it.label) marked.get(d).push(String(it.label));
    if (!first) first = d;
  }
  // daterange node: shade from..to
  if (!items.length && node.type === 'daterange' && node.value?.from && node.value?.to) {
    first = node.value.from;
    const cur = new Date(`${node.value.from}T00:00:00Z`);
    const end = new Date(`${node.value.to}T00:00:00Z`);
    while (cur <= end) {
      marked.set(cur.toISOString().slice(0, 10), []);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  const base = first ? new Date(`${first}T00:00:00Z`) : new Date();
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();

  const title = document.createElement('h3');
  title.className = 'app-calendar-title';
  title.textContent = `${y}-${String(m + 1).padStart(2, '0')}`;
  wrap.appendChild(title);

  const table = document.createElement('table');
  table.className = 'app-calendar-grid';
  const head = document.createElement('tr');
  for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) {
    const th = document.createElement('th');
    th.textContent = d;
    head.appendChild(th);
  }
  table.appendChild(head);

  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const offset = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Mon=0
  let row = document.createElement('tr');
  for (let i = 0; i < offset; i++) row.appendChild(document.createElement('td'));
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const td = document.createElement('td');
    td.textContent = String(d);
    if (marked.has(iso)) {
      td.className = 'app-calendar-marked';
      const labels = marked.get(iso);
      if (labels.length) td.title = labels.join(', ');
    }
    row.appendChild(td);
    if (row.children.length === 7) {
      table.appendChild(row);
      row = document.createElement('tr');
    }
  }
  if (row.children.length) table.appendChild(row);
  wrap.appendChild(table);
  return { el: wrap };
}
