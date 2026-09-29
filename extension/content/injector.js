/**
 * Injector — mounts closed Shadow DOM renderer (§14.7).
 * Loaded as ES module via dynamic import from content-script.
 */

import { mountShadowRenderer } from '../renderer/render-root.js';
import { createMessage, MessageType } from '../protocol/messages.js';

/**
 * @param {object} opts
 * @param {'native'|'link'} opts.mode
 * @param {object} opts.pageState
 * @param {object} opts.settings
 * @param {{ send: Function }} opts.bridge
 */
export async function injectRenderer(opts) {
  const { mode, pageState, settings, bridge } = opts;

  // Host element
  let host = document.documentElement.querySelector(':scope > #app-ext-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'app-ext-root';
    host.setAttribute('data-app-ext', '1.0');
  }

  if (mode === 'native') {
    // Replace body content for pure APP documents (§14.7)
    try {
      document.documentElement.style.background = 'var(--app-bg, #0e1115)';
      if (document.body) {
        document.body.innerHTML = '';
        document.body.appendChild(host);
      } else {
        document.documentElement.appendChild(host);
      }
    } catch {
      document.documentElement.appendChild(host);
    }
  } else {
    // Overlay for HTML+link discovery without destroying the site
    host.className = 'app-ext-overlay-host';
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      pointerEvents: 'none',
    });
    // Panel inside shadow will re-enable pointer events
    if (!host.isConnected) {
      (document.body || document.documentElement).appendChild(host);
    }
  }

  const { renderer, shadow } = await mountShadowRenderer(host, {
    origin: pageState.origin,
    url: pageState.url,
    settings,
    stylesheetUrl: chrome.runtime.getURL('assets/styles.css'),
    send: (msg) => bridge.send(msg),
  });

  // Enable pointer events on shell for overlay mode
  if (mode === 'link') {
    const shell = shadow.querySelector('.app-shell');
    if (shell) {
      Object.assign(shell.style, {
        pointerEvents: 'auto',
        position: 'fixed',
        top: '0',
        right: '0',
        width: 'min(480px, 100vw)',
        height: '100vh',
        overflow: 'auto',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.35)',
        zIndex: '1',
      });
      // Dismiss / take-over controls
      const bar = document.createElement('div');
      bar.className = 'app-overlay-chrome';
      bar.innerHTML = `
        <button type="button" class="app-btn app-btn-secondary" data-act="close">Close</button>
        <button type="button" class="app-btn app-btn-primary" data-act="takeover">Take over page</button>
      `;
      shell.prepend(bar);
      bar.querySelector('[data-act="close"]')?.addEventListener('click', () => {
        host.remove();
      });
      bar.querySelector('[data-act="takeover"]')?.addEventListener('click', () => {
        document.body.innerHTML = '';
        document.body.appendChild(host);
        host.style.cssText = '';
        if (shell) shell.style.cssText = '';
        bar.remove();
      });
    }
  }

  // Fetch initial manifest
  const fetchMsg = createMessage(MessageType.FETCH_MANIFEST, { url: pageState.url });
  const result = await bridge.send(fetchMsg);
  if (result?.type === MessageType.MANIFEST_READY) {
    pageState.manifest = result.payload.manifest;
    pageState.version = result.payload.version;
    renderer.setManifest(result.payload.manifest, result.payload.version);
  } else if (result?.type === MessageType.MANIFEST_ERROR) {
    renderer.showError(result.payload.error);
  }

  return { renderer, shadow, host };
}
