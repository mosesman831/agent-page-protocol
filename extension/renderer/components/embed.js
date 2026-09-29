/**
 * Embed node — opaque third-party viewport (SPEC-WEB-NODES §1.1).
 * Iframe boundary: sandbox attr is built ONLY from the node's declared
 * flags; absent sandbox = fully restricted iframe (no attr → all denied).
 */

export function renderEmbed({ node }) {
  const wrap = document.createElement('figure');
  wrap.className = 'app-embed';

  const frame = document.createElement('iframe');
  frame.className = 'app-embed-frame';
  frame.src = node.url;
  frame.title = node.description || 'Embedded content';
  frame.loading = 'lazy';
  const h = Number.isInteger(node.height) ? node.height : 320;
  frame.style.height = `${Math.min(2000, Math.max(16, h))}px`;
  if (Array.isArray(node.sandbox) && node.sandbox.length) {
    const map = {
      scripts: 'allow-scripts',
      forms: 'allow-forms',
      popups: 'allow-popups',
      'same-origin': 'allow-same-origin',
    };
    const flags = node.sandbox.map((f) => map[f]).filter(Boolean);
    if (flags.length) frame.setAttribute('sandbox', flags.join(' '));
  } else {
    frame.setAttribute('sandbox', '');
  }

  if (node.description) {
    const cap = document.createElement('figcaption');
    cap.className = 'app-embed-caption';
    cap.textContent = node.description;
    wrap.append(frame, cap);
  } else {
    wrap.appendChild(frame);
  }
  return { el: wrap };
}
