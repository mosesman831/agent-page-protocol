/**
 * Markdown node — safe subset renderer (SPEC-WEB-NODES §1.2).
 * Builds DOM via createElement/textContent only — raw value never touches
 * innerHTML. Supported: #..### headings, -/* lists, ``` code fences,
 * **bold**, *italic*, `code`, [label](https://...) links (https only).
 */

function appendInline(target, text) {
  // Split on **bold**, *italic*, `code`, [label](url)
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\))/g;
  for (const part of text.split(re)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      const b = document.createElement('strong');
      b.textContent = part.slice(2, -2);
      target.appendChild(b);
    } else if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const c = document.createElement('code');
      c.textContent = part.slice(1, -1);
      target.appendChild(c);
    } else if (part.startsWith('[')) {
      const m = part.match(/^\[([^\]\n]+)\]\(([^)\s]+)\)$/);
      if (m && /^https:\/\//.test(m[2])) {
        const a = document.createElement('a');
        a.href = m[2];
        a.textContent = m[1];
        a.rel = 'noopener noreferrer';
        a.target = '_blank';
        target.appendChild(a);
      } else {
        // Disallowed or malformed link — render the label as text
        target.appendChild(document.createTextNode(m ? m[1] : part));
      }
    } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      const i = document.createElement('em');
      i.textContent = part.slice(1, -1);
      target.appendChild(i);
    } else {
      target.appendChild(document.createTextNode(part));
    }
  }
}

export function renderMarkdown({ node }) {
  const wrap = document.createElement('div');
  wrap.className = 'app-markdown';
  const lines = String(node.value ?? '').split('\n');
  let list = null;
  let codeEl = null;
  for (const line of lines) {
    const fence = line.match(/^```/);
    if (fence) {
      if (codeEl) {
        codeEl = null;
      } else {
        codeEl = document.createElement('pre');
        codeEl.className = 'app-md-code';
        const inner = document.createElement('code');
        codeEl.appendChild(inner);
        wrap.appendChild(codeEl);
        codeEl._inner = inner;
      }
      list = null;
      continue;
    }
    if (codeEl) {
      codeEl._inner.textContent += `${line}\n`;
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = Math.min(h[1].length, 4);
      const el = document.createElement(`h${level}`);
      appendInline(el, h[2]);
      wrap.appendChild(el);
      list = null;
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!list) {
        list = document.createElement('ul');
        wrap.appendChild(list);
      }
      const item = document.createElement('li');
      appendInline(item, li[1]);
      list.appendChild(item);
      continue;
    }
    list = null;
    if (line.trim() === '') {
      continue;
    }
    const p = document.createElement('p');
    appendInline(p, line);
    wrap.appendChild(p);
  }
  return { el: wrap };
}
