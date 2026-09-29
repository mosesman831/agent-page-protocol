/**
 * Media node — gallery of image/video/audio items (SPEC-WEB-NODES §1.3).
 * Also serves the `gallery` componentHint.
 */

export function renderMedia({ node }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-media';
  if (node.label) {
    const t = document.createElement('h3');
    t.className = 'app-media-title';
    t.textContent = node.label;
    wrap.appendChild(t);
  }
  const grid = document.createElement('div');
  grid.className = 'app-media-grid';
  for (const item of Array.isArray(node.value) ? node.value : []) {
    const fig = document.createElement('figure');
    fig.className = 'app-media-item';
    const kind = item.kind || 'image';
    let el;
    if (kind === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.preload = 'metadata';
    } else if (kind === 'audio') {
      el = document.createElement('audio');
      el.controls = true;
    } else {
      el = document.createElement('img');
      el.loading = 'lazy';
    }
    el.src = item.url;
    if (item.alt) el.alt = item.alt;
    fig.appendChild(el);
    if (item.alt) {
      const cap = document.createElement('figcaption');
      cap.className = 'app-media-caption';
      cap.textContent = item.alt;
      fig.appendChild(cap);
    }
    grid.appendChild(fig);
  }
  wrap.appendChild(grid);
  return { el: wrap };
}
