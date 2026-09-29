/**
 * Stepper componentHint — progress indicator over a number node with
 * min/max (SPEC-WEB-NODES §2). Current position = node.value.
 */

export function renderStepper({ node }) {
  const wrap = document.createElement('ol');
  wrap.className = 'app-stepper';
  const min = Number.isInteger(node.min) ? node.min : 1;
  const max = Number.isInteger(node.max) ? node.max : Math.max(min, min + 3);
  const cur = typeof node.value === 'number' ? node.value : min;
  for (let i = min; i <= max; i++) {
    const li = document.createElement('li');
    li.className = 'app-step';
    li.textContent = String(i);
    if (i < cur) li.classList.add('app-step-done');
    if (i === cur) li.classList.add('app-step-current');
    wrap.appendChild(li);
  }
  return { el: wrap };
}
