/**
 * Toolbar popup — per-origin Accept rewriting + Render APP pages toggles.
 * Stored in chrome.storage.sync (§14.3, §14.6).
 */

const DEFAULTS = {
  renderAppPages: true,
  acceptRewriteOrigins: {}, // { [origin]: true }
  reducedMotion: false,
  themeOverride: null,
  alwaysAskConfirm: false,
  debug: false,
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return { ...DEFAULTS, ...stored };
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function $(id) {
  return document.getElementById(id);
}

async function init() {
  const settings = await getSettings();
  const tab = await activeTab();
  const origin = tab?.url ? originOf(tab.url) : null;

  $('origin-label').textContent = origin || 'No active page';
  $('render-toggle').checked = settings.renderAppPages !== false;
  $('accept-toggle').checked = !!(origin && settings.acceptRewriteOrigins?.[origin]);
  $('accept-toggle').disabled = !origin || origin.startsWith('chrome');
  $('always-ask').checked = !!settings.alwaysAskConfirm;
  $('reduced-motion').checked = !!settings.reducedMotion;

  $('render-toggle').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ renderAppPages: e.target.checked });
    notifySettings();
  });

  $('accept-toggle').addEventListener('change', async (e) => {
    if (!origin) return;
    const s = await getSettings();
    const map = { ...(s.acceptRewriteOrigins || {}) };
    if (e.target.checked) map[origin] = true;
    else delete map[origin];
    await chrome.storage.sync.set({ acceptRewriteOrigins: map });
    // Ask background to refresh DNR rules
    chrome.runtime.sendMessage({
      app_ext: '1.0',
      type: 'SETTINGS_UPDATE',
      request_id: crypto.randomUUID(),
      payload: { acceptRewriteOrigins: map },
    });
  });

  $('always-ask').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ alwaysAskConfirm: e.target.checked });
    notifySettings();
  });

  $('reduced-motion').addEventListener('change', async (e) => {
    await chrome.storage.sync.set({ reducedMotion: e.target.checked });
    notifySettings();
  });
}

async function notifySettings() {
  const settings = await getSettings();
  chrome.runtime.sendMessage({
    app_ext: '1.0',
    type: 'SETTINGS_UPDATE',
    request_id: crypto.randomUUID(),
    payload: {
      reduced_motion: settings.reducedMotion,
      theme_override: settings.themeOverride,
      renderAppPages: settings.renderAppPages,
      alwaysAskConfirm: settings.alwaysAskConfirm,
      acceptRewriteOrigins: settings.acceptRewriteOrigins,
    },
  });
}

init().catch((err) => {
  $('origin-label').textContent = `Error: ${err.message}`;
});
