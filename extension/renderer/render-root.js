/**
 * Renderer root - layout algorithm §13.5, DOM strategy §14.7, a11y §13.7.
 * Mounts into a closed ShadowRoot or document body (view.html).
 */

import { createMessage, MessageType, isAppExtMessage } from '../protocol/messages.js';
import { formatStateValue, getByPointer, uuidModeToken } from '../protocol/parse.js';
import { formatScaledNumber } from '../protocol/money.js';
import { applyDiffDocument, BindingRegistry, patchBoundElements } from '../protocol/diff.js';
import {
  confirmationLevel,
  extractChallenge,
  extractConfirmationChallenge,
  extractHold,
  needsConfirmation,
  validateChallengeRecord,
  validateManifest,
} from '../protocol/validate.js';
import { CLIENT_NAME, showConfirmationModal } from '../ui/confirmation-modal.js';
import { showChallengeModal } from '../ui/challenge-modal.js';
import { showDelegateSheet } from '../ui/delegate-sheet.js';
import { renderTable } from './components/table.js';
import { renderForm, renderActionBar, fillTypeaheadDatalist } from './components/form.js';
import { renderDetail } from './components/detail.js';
import { renderList } from './components/list.js';
import { renderCard } from './components/card.js';
import { renderTreeFallback } from './components/tree-fallback.js';
import { renderOtpForm } from './components/otp-form.js';
import { renderConsent } from './components/consent.js';
import { renderHoldFrame } from './components/hold-frame.js';
import { renderOrder } from './components/order.js';
import { renderGeopoint } from './components/geopoint.js';
import { renderMedia } from './components/media.js';
import { renderCalendar } from './components/calendar.js';
import { renderStepper } from './components/stepper.js';

/**
 * @typedef {object} RenderHost
 * @property {ShadowRoot|Document|HTMLElement} root
 * @property {(msg: object) => Promise<object|void>|void} send - bridge to content/background
 * @property {string} origin
 * @property {string} [url]
 * @property {object} [settings]
 */

export class AppRenderer {
  /**
   * @param {RenderHost} host
   */
  constructor(host) {
    this.host = host;
    this.manifest = null;
    this.bindings = BindingRegistry.createElementMap();
    this.bindingRegistry = new BindingRegistry();
    this.pendingAction = null;
    this.history = [];
    this.mode = 'render';
    this.liveRegion = null;
    this.mainEl = null;
    this.shell = null;
    this._formApi = null;
    this._asyncPollTimer = null;
    this._lastTrack = null;
    this._suppressOrderActions = false;
    this._onMessage = this._onMessage.bind(this);
  }

  /** Mount empty shell and listen for bridge messages. */
  mount() {
    const root = this.host.root;
    const mountPoint = root instanceof ShadowRoot ? root : root.body || root;

    // Clear previous
    const prev = mountPoint.querySelector?.('.app-shell');
    prev?.remove();

    this.shell = document.createElement('div');
    this.shell.className = 'app-shell';
    this.shell.dataset.appRenderer = '0.5';

    this.shell.innerHTML = `
      <a class="app-skip" href="#app-main">Skip to content</a>
      <header class="app-header" role="banner">
        <div class="app-brand">APP</div>
        <h1 class="app-title" data-bind="page.title">Loading…</h1>
        <p class="app-desc" data-bind="page.description" hidden></p>
      </header>
      <nav class="app-nav" aria-label="Breadcrumb" hidden></nav>
      <main id="app-main" class="app-main" role="main"></main>
      <aside class="app-aside" aria-label="Related" hidden></aside>
      <div class="app-live" aria-live="polite" aria-atomic="true"></div>
      <div class="app-status" role="status"></div>
    `;

    mountPoint.appendChild(this.shell);
    this.mainEl = this.shell.querySelector('.app-main');
    this.liveRegion = this.shell.querySelector('.app-live');

    if (this.host.settings?.reduced_motion || this.host.settings?.reducedMotion) {
      this.shell.classList.add('app-reduced-motion');
    }

    // Listen for postMessage from content bridge (iframe / shadow host)
    window.addEventListener('message', this._onMessage);
    return this;
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    this.stopAsyncPoll();
    this.shell?.remove();
    this.bindings.clear();
    this.bindingRegistry.clear();
  }

  stopAsyncPoll() {
    if (this._asyncPollTimer != null) {
      clearTimeout(this._asyncPollTimer);
      this._asyncPollTimer = null;
    }
  }

  _onMessage(event) {
    const msg = event.data;
    if (!isAppExtMessage(msg)) return;
    switch (msg.type) {
      case MessageType.MANIFEST_READY:
        this.setManifest(msg.payload.manifest, msg.payload.version);
        break;
      case MessageType.MANIFEST_ERROR:
        this.showError(msg.payload.error);
        break;
      case MessageType.ACTION_RESULT:
        this.handleActionResult(msg.payload);
        break;
      case MessageType.SETTINGS_UPDATE:
        this.applySettings(msg.payload);
        break;
      case MessageType.EVENT_PUSH:
        this.handleEventPush(msg.payload?.event);
        break;
      case MessageType.SESSION_EPOCH:
        this.announce('Session epoch changed');
        break;
      case MessageType.CONFIRM_RESPONSE:
      case MessageType.CHALLENGE_RESPONSE:
      case MessageType.HOLD_RESPONSE:
        break;
      case MessageType.PONG:
        break;
      default:
        break;
    }
  }

  /**
   * Apply an Event Record from the content-script events owner (§14 / §24).
   */
  handleEventPush(eventDoc) {
    const ev = eventDoc?.event || eventDoc;
    if (!ev || typeof ev !== 'object') return;
    if (ev.type === 'heartbeat') return;
    if (ev.type === 'session.expired') {
      this.announce('Session expired', 'assertive');
      return;
    }
    if (ev.type === 'hold.cleared') {
      this.announce('Verification cleared');
    }
    if (ev.hint === 'drop') {
      this.showError({
        app: '1.1',
        error: { code: 'app.err.navigation.gone', message: 'Page removed', retryable: false },
      });
      return;
    }
    if (ev.hint === 'diff' && ev.diff) {
      // §14: an embedded diff that fails to validate/apply falls back to a
      // revalidation GET — never a fatal error.
      const ok = this.applyDiffLocal(ev.diff, { fromEvent: true });
      if (ok === false) {
        void this.requestManifest(ev.page_url || this.host.url);
      }
      return;
    }
    // revalidate or diff-without-body
    if (ev.page_url || this.host.url) {
      void this.requestManifest(ev.page_url || this.host.url);
    }
  }

  applySettings(payload) {
    this.host.settings = { ...this.host.settings, ...payload };
    if (payload.reduced_motion || payload.reducedMotion) {
      this.shell?.classList.add('app-reduced-motion');
    } else {
      this.shell?.classList.remove('app-reduced-motion');
    }
  }

  async requestManifest(url) {
    const msg = createMessage(MessageType.FETCH_MANIFEST, { url: url || this.host.url });
    return this.host.send(msg);
  }

  setManifest(manifest, version) {
    const v = validateManifest(manifest);
    if (!v.ok) {
      this.showError({
        app: '1.0',
        error: { code: v.code, message: v.message, retryable: false },
      });
      return;
    }
    this.manifest = v.manifest;
    if (version) this.manifest.page.version = version || this.manifest.page.version;
    this.bindings.clear();
    this.bindingRegistry.clear();
    this.render();
    this.announce(`Loaded ${this.manifest.page.title || this.manifest.page.id}`);
  }

  showError(errorDoc) {
    const code = errorDoc?.error?.code || 'app.err.internal';
    const message = errorDoc?.error?.message || 'Unknown error';
    if (this.mainEl) {
      this.mainEl.innerHTML = `
        <div class="app-error" role="alert">
          <h2>Error</h2>
          <p><code>${escapeHtml(code)}</code></p>
          <p>${escapeHtml(message)}</p>
        </div>`;
    }
    this.announce(`Error: ${message}`, 'assertive');
  }

  render() {
    const m = this.manifest;
    if (!m || !this.shell) return;

    // Page title (§13.7)
    const title = m.page.title || m.page.id;
    try {
      if (!(this.host.root instanceof ShadowRoot)) {
        document.title = title;
      }
    } catch {
      /* ignore */
    }
    const titleEl = this.shell.querySelector('.app-title');
    if (titleEl) titleEl.textContent = title;

    const descEl = this.shell.querySelector('.app-desc');
    if (descEl) {
      if (m.page.description) {
        descEl.textContent = m.page.description;
        descEl.hidden = false;
      } else {
        descEl.hidden = true;
      }
    }

    // Theme from present
    this.applyTheme(m.present?.theme);

    // Live region politeness
    const live = m.present?.a11y?.live_region || 'polite';
    if (this.liveRegion) {
      this.liveRegion.setAttribute('aria-live', live === 'assertive' ? 'assertive' : 'polite');
    }
    if (m.present?.a11y?.page_label) {
      this.mainEl?.setAttribute('aria-label', m.present.a11y.page_label);
    }

    // Soft error banner
    // Navigation breadcrumb
    this.renderNav(m.navigation);

    this.mainEl.innerHTML = '';
    this.bindings.clear();

    const present = m.present;
    if (!present) {
      this.mainEl.appendChild(
        renderTreeFallback({
          manifest: m,
          bindings: this.bindings,
          onAction: (id, params) => this.invokeAction(id, params),
        }),
      );
    } else {
      this.renderPresent(present);
    }

    this.renderSpecialState(m);

    // Soft error on manifest
    if (m.error?.code) {
      const banner = document.createElement('div');
      banner.className = 'app-banner app-banner-warn';
      banner.setAttribute('role', 'status');
      banner.textContent = `${m.error.code}: ${m.error.message || ''}`;
      this.mainEl.prepend(banner);
    }

    this.markTracked();
  }

  /**
   * R1: mark elements carrying data-app-track/data-app-value that changed
   * since the previous render of this page. Adds .app-changed, data-app-prev,
   * and a <s class="app-price-was"> sibling for .app-price elements.
   */
  markTracked() {
    if (!this.mainEl) return;
    const prev = this._lastTrack;
    const pageId = this.manifest?.page?.id;
    const prevMap = prev && prev.pageId === pageId ? prev.map : new Map();
    const nextMap = new Map();
    for (const el of this.mainEl.querySelectorAll('[data-app-track]')) {
      const key = el.dataset.appTrack;
      const value = el.dataset.appValue ?? '';
      nextMap.set(key, value);
      if (prevMap.has(key) && prevMap.get(key) !== value) {
        const prevValue = prevMap.get(key);
        el.classList.add('app-changed');
        el.dataset.appPrev = prevValue;
        if (el.classList.contains('app-price')) {
          const was = document.createElement('s');
          was.className = 'app-price-was';
          was.dataset.appWas = '1';
          was.textContent = formatTrackValue(prevValue);
          el.parentNode?.insertBefore(was, el);
        }
      }
    }
    this._lastTrack = { pageId, map: nextMap };
  }

  /**
   * Mount 1.1 state-driven components: challenge OTP, consent, hold, order, geopoint.
   */
  renderSpecialState(m) {
    if (!this.mainEl || !m?.state) return;

    const challengeNode = m.state.challenge;
    if (challengeNode) {
      const parsed = validateChallengeRecord(challengeNode);
      if (
        parsed.ok &&
        (parsed.challenge.kind === 'otp' ||
          parsed.challenge.kind === 'totp' ||
          parsed.challenge.kind === 'backup_code')
      ) {
        const resendAction =
          parsed.challenge.raw?.resend_action?.value || parsed.challenge.raw?.resend_action;
        const { el } = renderOtpForm({
          challenge: parsed.challenge,
          actionId: 'submit_otp',
          onSubmit: (params) => this.invokeAction('submit_otp', params),
          onResend: resendAction ? () => this.invokeAction(String(resendAction), {}) : undefined,
          onAbandon: m.actions?.abandon ? () => this.invokeAction('abandon', {}) : undefined,
        });
        this.mainEl.prepend(el);
      }
    }

    const consentNode = m.state.consent;
    if (
      consentNode &&
      (consentNode.value?.required?.value === true || consentNode.value?.required === true)
    ) {
      const { el } = renderConsent({
        consentNode,
        privacyNode: m.state.privacy,
        onGrant: (purposes) => {
          void this.host.send(
            createMessage(MessageType.CONSENT_PROMPT, { purposes, origin: this.host.origin }),
          );
          this.invokeAction('grant_consent', { purposes });
        },
        onRejectOptional: m.actions?.reject_optional
          ? () => this.invokeAction('reject_optional', {})
          : undefined,
      });
      this.mainEl.prepend(el);
    }

    const holdNode = m.state.human_hold || m.state.hold;
    if (holdNode) {
      const frame = renderHoldFrame({
        hold: holdNode,
        origin: this.host.origin,
        onComplete: (payload) => {
          void this.host.send(
            createMessage(MessageType.HOLD_REQUEST, {
              hold: holdNode,
              origin: this.host.origin,
            }),
          );
          this.invokeAction('complete_hold', payload);
        },
        onAbort: () => {
          void this.host.send(createMessage(MessageType.HOLD_RESPONSE, { abort: true }));
          this.announce('Verification cancelled');
        },
      });
      this.mainEl.prepend(frame.el);
    }

    for (const [key, node] of Object.entries(m.state)) {
      if (node?.type === 'order') {
        const { el } = renderOrder({
          node,
          pointer: `/state/${key}`,
          actions: this._suppressOrderActions ? undefined : m.actions,
          onAction: (id, params) => this.invokeAction(id, params),
        });
        this.mainEl.appendChild(el);
      } else if (node?.type === 'geopoint') {
        const { el } = renderGeopoint({ node });
        el.dataset.stateKey = key;
        this.mainEl.appendChild(el);
      }
    }
  }

  applyTheme(theme) {
    if (!theme || !this.shell) return;
    const palette = theme.palette || [];
    if (palette[0]) this.shell.style.setProperty('--app-bg', palette[0]);
    if (palette[1]) this.shell.style.setProperty('--app-surface', palette[1]);
    if (palette[2]) this.shell.style.setProperty('--app-accent', palette[2]);
    if (theme.dark) this.shell.classList.add('app-theme-dark');
    else this.shell.classList.remove('app-theme-dark');
    if (theme.font_display) {
      this.shell.style.setProperty('--app-font-display', `"${theme.font_display}", Georgia, serif`);
    }
    if (theme.font_body) {
      this.shell.style.setProperty(
        '--app-font-body',
        `"${theme.font_body}", system-ui, sans-serif`,
      );
    }
  }

  renderNav(navigation) {
    const nav = this.shell.querySelector('.app-nav');
    if (!nav) return;
    const crumbs = navigation?.breadcrumb || navigation?.items || [];
    if (!crumbs.length) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }
    nav.hidden = false;
    nav.innerHTML = '';
    const ol = document.createElement('ol');
    ol.className = 'app-breadcrumb';
    crumbs.forEach((item, i) => {
      const li = document.createElement('li');
      if (item.url && i < crumbs.length - 1) {
        const a = document.createElement('a');
        a.href = item.url;
        a.textContent = item.label || item.page_id || item.url;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.navigate(item.url, 'push');
        });
        li.appendChild(a);
      } else {
        li.textContent = item.label || item.page_id || 'Current';
        li.setAttribute('aria-current', 'page');
      }
      ol.appendChild(li);
    });
    nav.appendChild(ol);
  }

  renderPresent(present) {
    const layout = present.layout || 'list';
    let sections = present.sections || [];
    const m = this.manifest;
    this._suppressOrderActions = false;

    const container = document.createElement('div');
    container.className = `app-layout app-layout-${safeLayout(layout)}`;

    // W9: sectionless detail pages (e.g. flights booking) - synthesise a
    // detail section over the primary object node so price/media still render.
    if (layout === 'detail' && !sections.length) {
      const fallbackKey = pickDetailFallbackKey(m);
      if (fallbackKey) {
        const fbSection = {
          id: 'detail_fallback',
          state_path: fallbackKey,
          layout: 'detail',
        };
        const needsForm = Object.values(m.actions || {}).some(
          (a) => a && a.kind !== 'confirm' && a.input && Object.keys(a.input).length > 0,
        );
        if (needsForm) {
          // The form owns the actions (its inputs are required); detail renders
          // the record above it without its own action row.
          container.appendChild(
            renderDetail({
              section: fbSection,
              manifest: m,
              bindings: this.bindings,
              onAction: (id, params) => this.invokeAction(id, params),
              suppressActions: true,
            }),
          );
        } else {
          sections = [fbSection];
          this._suppressOrderActions = true; // detail renders manifest.actions
        }
      }
    }

    let formRendered = false;
    if (layout === 'form' || (!sections.length && m.actions)) {
      const { el, setErrors } = renderForm({
        actions: m.actions,
        manifest: m,
        bindings: this.bindings,
        onSubmit: (id, params) => this.invokeAction(id, params),
        onTypeahead: (opts) => this.runTypeahead(opts),
      });
      this._formApi = { setErrors };
      container.appendChild(el);
      formRendered = true;
      this._suppressOrderActions = true;
    }

    for (const section of sections) {
      const sectionLayout = section.layout || layout;
      const renderer = pickSectionRenderer(sectionLayout);
      container.appendChild(
        renderer({
          section,
          manifest: m,
          bindings: this.bindings,
          onAction: (id, params) => this.invokeAction(id, params),
          onTypeahead: (opts) => this.runTypeahead(opts),
        }),
      );
    }

    // Components map
    if (present.components && typeof present.components === 'object') {
      const compWrap = document.createElement('div');
      compWrap.className = 'app-components';
      for (const [key, hint] of Object.entries(present.components)) {
        if (!hint || hint.type === 'hidden') continue;
        const el = renderComponentHint(hint, key, m, this.bindings, (id, p) =>
          this.invokeAction(id, p),
        );
        if (el) compWrap.appendChild(el);
      }
      container.appendChild(compWrap);
    }

    // If no sections and no form was rendered - still show actions (R3: never
    // duplicate actions the form already rendered).
    if (!sections.length && layout !== 'form' && m.actions && !formRendered) {
      container.appendChild(
        renderActionBar({
          actions: m.actions,
          onAction: (id, params) => this.invokeAction(id, params),
        }),
      );
      this._suppressOrderActions = true;
    }

    this.mainEl.appendChild(container);
  }

  setBusy(busy) {
    if (!this.mainEl) return;
    this.mainEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    this.shell?.querySelectorAll('button[data-action-id], .app-form button').forEach((btn) => {
      btn.disabled = !!busy;
    });
    const status = this.shell?.querySelector('.app-status');
    if (status) {
      status.textContent = busy ? 'Working…' : '';
    }
  }

  announce(text, politeness) {
    if (!this.liveRegion) return;
    if (politeness) this.liveRegion.setAttribute('aria-live', politeness);
    this.liveRegion.textContent = '';
    // Force announcement
    requestAnimationFrame(() => {
      this.liveRegion.textContent = text;
    });
  }

  /**
   * @param {string} actionId
   * @param {object} [params]
   * @param {object} [opts]
   * @param {string} [opts.confirmationToken] Mode A challenge or Mode B uuid-mode token
   * @param {boolean} [opts.reuseBody] Re-POST identical body bytes (Mode A echo)
   * @param {boolean} [opts.skipLocalConfirm] Skip local dialog (already approved)
   * @param {string} [opts.challengeId]
   * @param {string} [opts.holdToken]
   */
  async invokeAction(actionId, params = {}, opts = {}) {
    // Back-compat: third arg may be a bare token string
    if (typeof opts === 'string') {
      opts = { confirmationToken: opts, reuseBody: true, skipLocalConfirm: true };
    }

    const m = this.manifest;
    if (!m) return;
    const actionDef = m.actions?.[actionId];
    if (!actionDef) {
      this.announce(`Unknown action: ${actionId}`, 'assertive');
      return;
    }

    // Delegate (§4.9 / MF-9): show amount + bank/IdP host; prefer resume_url
    if (actionDef.kind === 'delegate' && !opts.skipLocalConfirm) {
      const sheet = await showDelegateSheet(this.host.root, {
        actionId,
        actionDef,
        origin: this.host.origin,
        manifest: m,
        params,
      });
      if (!sheet.approved) {
        this.announce('Delegate cancelled');
        return;
      }
      const openUrl = sheet.targetUrl;
      if (openUrl) {
        await this.host.send(
          createMessage(MessageType.DELEGATE_OPEN, {
            url: openUrl,
            origin: sheet.targetHost || this.host.origin,
            resume_url: sheet.resumeUrl || actionDef.output?.resume_url || null,
          }),
        );
      }
      // Still POST the delegate action so the server can bind state / slot
    }

    // Confirmation policy §10.4
    let level = confirmationLevel(actionDef);
    if (this.host.settings?.alwaysAskConfirm && level === 0) {
      level = 4;
    }

    let token = opts.confirmationToken || null;
    if (level > 0 && !token && !opts.skipLocalConfirm && actionDef.kind !== 'delegate') {
      const { approved, modeBToken } = await showConfirmationModal(this.host.root, {
        level,
        actionId,
        actionDef,
        origin: this.host.origin,
        params,
        manifest: m,
        clientName: CLIENT_NAME,
        mintModeB: true,
      });
      if (!approved) {
        this.announce('Action cancelled');
        return;
      }
      // Mode B - session-bound UUID for renderer/extension only (§10.4.2)
      const confirmReq = createMessage(MessageType.CONFIRM_REQUEST, {
        level,
        action: actionId,
        preview: {
          side_effect: actionDef.side_effect,
          params,
          origin: this.host.origin,
        },
      });
      const confirmRes = await this.host.send(confirmReq);
      if (confirmRes?.type === MessageType.CONFIRM_RESPONSE) {
        if (!confirmRes.payload?.approved) {
          this.announce('Action blocked by policy');
          return;
        }
        token = uuidModeToken(confirmRes.payload.token || modeBToken);
      } else {
        token = modeBToken || uuidModeToken();
      }
    }

    this.pendingAction = { id: actionId, startedAt: Date.now(), params };
    this.setBusy(true);
    this.stopAsyncPoll();

    // Redact secret_params from planner-facing announce only; still send on wire
    const secretParams = new Set(actionDef.policy?.secret_params || []);
    void secretParams;

    const msg = createMessage(MessageType.INVOKE_ACTION, {
      action: actionId,
      params,
      confirmation_token: token || undefined,
      reuse_body: opts.reuseBody === true,
      challenge_id: opts.challengeId || undefined,
      hold_token: opts.holdToken || undefined,
    });

    try {
      const result = await this.host.send(msg);
      if (result && isAppExtMessage(result) && result.type === MessageType.ACTION_RESULT) {
        await this.handleActionResult(result.payload);
      }
    } catch (e) {
      this.showError({
        app: '1.0',
        error: {
          code: 'app.err.transport.network',
          message: e instanceof Error ? e.message : 'Network error',
          retryable: true,
        },
      });
    } finally {
      this.pendingAction = null;
      this.setBusy(false);
    }
  }

  async runTypeahead({ source, query, datalist, param }) {
    const actionId = source?.action;
    if (!actionId || !this.manifest?.actions?.[actionId]) return;
    const def = this.manifest.actions[actionId];
    if (def.kind !== 'query' || def.side_effect !== 'safe') return;
    const paramName = source.param || 'q';
    try {
      const msg = createMessage(MessageType.INVOKE_ACTION, {
        action: actionId,
        params: { [paramName]: query },
      });
      const result = await this.host.send(msg);
      if (!result || result.type !== MessageType.ACTION_RESULT) return;
      const doc = result.payload?.document;
      if (result.payload?.mode === 'diff' && doc) {
        this.applyDiffLocal(doc);
      } else if (doc?.state) {
        // Merge suggestions only — results_path is a state key (schema: ^[a-z][a-z0-9_]{0,63}$)
        const path = source.results_path;
        if (path && doc.state[path]) {
          if (!this.manifest.state) this.manifest.state = {};
          this.manifest.state[path] = doc.state[path];
        }
      }
      const resultsNode = this.manifest?.state?.[source.results_path];
      fillTypeaheadDatalist(datalist, resultsNode, source);
      void param;
    } catch {
      /* ignore typeahead errors */
    }
  }

  async handleActionResult(payload) {
    const { mode, document: doc, status } = payload || {};
    const resultVersion =
      payload?.result_version ||
      payload?.headers?.['x-app-result-version'] ||
      payload?.headers?.['X-APP-Result-Version'] ||
      null;

    if (mode === 'error' || (doc?.error?.code && !doc?.page)) {
      const code = doc?.error?.code;

      // 428 MFA challenge (§6.3) - distinct from confirmation
      if (code === 'app.err.auth.challenge_required') {
        const challenge = extractChallenge(doc);
        const actionId = this.pendingAction?.id || payload.action;
        const params = { ...(payload.params || this.pendingAction?.params || {}) };
        if (!challenge) {
          this.showError(doc);
          return;
        }
        await this.host.send(
          createMessage(MessageType.CHALLENGE_REQUEST, {
            challenge,
            action: actionId,
            origin: this.host.origin,
          }),
        );
        const result = await showChallengeModal(this.host.root, {
          challenge,
          origin: this.host.origin,
        });
        await this.host.send(
          createMessage(MessageType.CHALLENGE_RESPONSE, {
            id: challenge.id,
            ...result,
          }),
        );
        if (result.abort) {
          this.announce('Verification cancelled');
          return;
        }
        const paramName = challenge.param || 'otp';
        if (result.otp != null) params[paramName] = result.otp;
        if (result.credential) params.credential = result.credential;
        await this.invokeAction(actionId, params, {
          challengeId: challenge.id,
          reuseBody: false,
          skipLocalConfirm: true,
        });
        return;
      }

      // 428 human hold (§7)
      if (code === 'app.err.hold.human_required') {
        const hold = extractHold(doc);
        if (!hold) {
          this.showError(doc);
          return;
        }
        await this.host.send(
          createMessage(MessageType.HOLD_REQUEST, {
            hold,
            origin: this.host.origin,
          }),
        );
        // Prefer navigating to same-origin verify_url when present
        if (hold.verify_url) {
          try {
            const u = new URL(hold.verify_url, this.host.origin);
            if (u.origin === this.host.origin) {
              await this.navigate(u.href, 'push');
              return;
            }
          } catch {
            /* fall through to inline frame */
          }
        }
        const frame = renderHoldFrame({
          hold,
          origin: this.host.origin,
          onComplete: async (p) => {
            await this.host.send(
              createMessage(MessageType.HOLD_RESPONSE, {
                id: hold.id,
                cleared: true,
              }),
            );
            const resume = hold.resume_action || 'complete_hold';
            await this.invokeAction(resume, p, {
              holdToken: hold.id,
              skipLocalConfirm: true,
            });
          },
          onAbort: async () => {
            await this.host.send(
              createMessage(MessageType.HOLD_RESPONSE, {
                id: hold.id,
                abort: true,
              }),
            );
          },
        });
        this.mainEl?.prepend(frame.el);
        return;
      }

      // 403 consent required
      if (code === 'app.err.consent.required') {
        const purposes = doc.error?.details?.missing || [];
        await this.host.send(
          createMessage(MessageType.CONSENT_PROMPT, {
            purposes,
            origin: this.host.origin,
          }),
        );
        if (this.manifest?.actions?.grant_consent) {
          this.announce('Consent required');
        }
        this.showError(doc);
        return;
      }

      // 428 Mode A confirmation challenge - re-POST identical body bytes
      if (status === 428 || code === 'app.err.action.confirmation_required') {
        const challenge = extractConfirmationChallenge(doc);
        const actionId = this.pendingAction?.id || payload.action;
        const actionDef = this.manifest?.actions?.[actionId];
        const params = payload.params || this.pendingAction?.params || {};
        const { approved } = await showConfirmationModal(this.host.root, {
          level: confirmationLevel(actionDef) || 4,
          actionId,
          actionDef,
          origin: this.host.origin,
          params,
          manifest: this.manifest,
          clientName: CLIENT_NAME,
          mintModeB: false, // Mode A uses server challenge, not uuid-mode
        });
        if (approved && challenge) {
          await this.invokeAction(actionId, params, {
            confirmationToken: typeof challenge === 'string' ? challenge : String(challenge),
            reuseBody: true,
            skipLocalConfirm: true,
          });
        }
        return;
      }

      if (code?.startsWith('app.err.validation') && this._formApi) {
        const details = doc.error.details || {};
        const fieldErrors = details.fields || details.params || {};
        this._formApi.setErrors(fieldErrors);
      }
      this.showError(doc);
      return;
    }

    if (mode === 'async') {
      this.setManifest(doc, resultVersion || doc?.page?.version);
      this.announce('Operation in progress…');
      await this.pollAsyncStatus(payload);
      return;
    }

    if (mode === 'diff' || (doc && Array.isArray(doc.diff))) {
      this.applyDiffLocal(doc);
      return;
    }

    if (mode === 'full' || (doc && doc.page && doc.state)) {
      this.setManifest(doc, resultVersion || doc?.page?.version);
      return;
    }

    if (mode === 'redirect' && payload.url) {
      await this.navigate(payload.url, 'push');
    }
  }

  /**
   * Poll status_url no faster than poll_interval_ms (§6.9). Hard stop 120s.
   */
  async pollAsyncStatus(payload) {
    const statusUrl =
      payload.status_url ||
      payload.document?.state?.operation_status?.value?.status_url?.value ||
      payload.document?.state?.operation_status?.value?.status_url;
    if (!statusUrl) return;

    let interval = Math.max(500, Number(payload.poll_interval_ms) || 2000);
    const hardStop = Date.now() + 120_000;
    let attempt = 0;

    const tick = async () => {
      if (Date.now() >= hardStop) {
        this.announce('Operation timed out', 'assertive');
        return;
      }
      attempt += 1;
      try {
        const msg = createMessage(MessageType.FETCH_MANIFEST, { url: statusUrl });
        const res = await this.host.send(msg);
        if (res?.type === MessageType.MANIFEST_READY && res.payload?.manifest) {
          const doc = res.payload.manifest;
          this.setManifest(doc, res.payload.result_version || res.payload.version);
          const state =
            doc?.state?.operation_status?.value?.state?.value ||
            doc?.state?.operation_status?.value?.state;
          if (state === 'succeeded') {
            this.announce('Operation succeeded');
            return;
          }
          if (state === 'failed' || state === 'cancelled') {
            this.announce(`Operation ${state}`, 'assertive');
            return;
          }
          const next = Number(doc?.meta?.poll_interval_ms);
          if (Number.isFinite(next) && next >= 500) interval = next;
        }
      } catch {
        interval = Math.min(30_000, 200 * 2 ** Math.min(attempt, 8));
      }
      this._asyncPollTimer = setTimeout(tick, interval + Math.floor(Math.random() * 100));
    };

    this._asyncPollTimer = setTimeout(tick, interval);
  }

  applyDiffLocal(diffDoc, opts = {}) {
    if (!this.manifest) return false;

    // SSE pushes arrive before their own action response — a diff whose
    // result_version is already the live version is an echo, not stale_base.
    const cur = this.manifest.page?.version;
    if (diffDoc?.result_version && cur && String(diffDoc.result_version) === String(cur)) {
      return 'applied';
    }

    const prevPageId = this.manifest.page?.id;
    const result = applyDiffDocument(this.manifest, diffDoc);
    if (!result.ok) {
      // Event-pushed diffs degrade to a plain revalidation GET (§14) — no
      // error UI for a best-effort hint.
      if (opts.fromEvent) {
        this.requestManifest(this.host.url);
        return false;
      }
      this.showError({
        app: '1.0',
        error: { code: result.code, message: result.message, retryable: true },
      });
      // Re-fetch on stale
      if (result.code === 'app.err.diff.stale_base' || result.code === 'app.err.diff.test_failed') {
        this.requestManifest(this.host.url);
      }
      return false;
    }

    const prevActions = this.manifest.actions;
    this.manifest = result.manifest;

    const changed = result.changedPaths || [];
    const actionsChanged = changed.some((p) => p === '/actions' || p.startsWith('/actions/'));
    const presentChanged = changed.some((p) => p === '/present' || p.startsWith('/present/'));
    // F-7: a diff that moved the manifest to a different page id must repaint.
    const pageChanged = this.manifest.page?.id !== prevPageId;
    // R2: commerce/state-bearing paths repaint; only safe scalar leaf paths
    // (no bound ancestor/container hit) take the incremental patch path.
    const commerceChanged = changed.some((p) =>
      /\/(price|total|amount|status|payment|items|order)\b/.test(p),
    );
    const leafOnly =
      changed.length > 0 && changed.every((p) => isScalarNode(getByPointer(this.manifest, p)));
    let ancestorHit = false;
    for (const path of changed) {
      for (const ptr of this.bindings.keys()) {
        if (path !== ptr && (path.startsWith(ptr + '/') || ptr.startsWith(path + '/'))) {
          ancestorHit = true;
          break;
        }
      }
      if (ancestorHit) break;
    }

    if (
      pageChanged ||
      presentChanged ||
      actionsChanged ||
      commerceChanged ||
      !leafOnly ||
      ancestorHit
    ) {
      this.render();
    } else {
      // Incremental DOM update via bindings (§14.7)
      patchBoundElements(this.bindings, changed, this.manifest, (node) => formatStateValue(node));
      this.bindingRegistry.notify(changed, (pointer) => getByPointer(this.manifest, pointer));

      // Update title if changed
      if (changed.some((p) => p === '/page/title' || p.startsWith('/page/title'))) {
        const t = this.shell.querySelector('.app-title');
        if (t) t.textContent = this.manifest.page.title || this.manifest.page.id;
      }
    }

    this.announce('Updated');

    if (result.navigation_effect?.url) {
      this.navigate(result.navigation_effect.url, result.navigation_effect.mode || 'push');
    }

    void prevActions;
    return true;
  }

  async navigate(url, mode = 'push') {
    const msg = createMessage(MessageType.NAVIGATE, { url, mode });
    await this.host.send(msg);
  }
}

function safeLayout(layout) {
  const known = new Set(['list', 'grid', 'detail', 'form', 'dashboard', 'chat', 'table', 'card']);
  return known.has(layout) ? layout : 'list';
}

const SPECIAL_STATE_KEYS = new Set([
  'session',
  'challenge',
  'consent',
  'privacy',
  'hold',
  'notice',
]);

/**
 * W9: pick the object node a sectionless detail page should render. Skips
 * special-purpose keys and nodes already claimed by present.components.
 */
function pickDetailFallbackKey(m) {
  const handled = new Set(
    Object.values(m?.present?.components || {})
      .map((h) => h && h.state_path)
      .filter(Boolean),
  );
  for (const [key, node] of Object.entries(m?.state || {})) {
    if (node?.type !== 'object') continue;
    if (SPECIAL_STATE_KEYS.has(key) || handled.has(key)) continue;
    return key;
  }
  return null;
}

/** Scalar = primitive, null, or a state node whose value is not an object. */
function isScalarNode(v) {
  if (v == null || typeof v !== 'object') return true;
  if (Array.isArray(v)) return false;
  if ('type' in v) return v.value == null || typeof v.value !== 'object';
  return false;
}

/** Re-format a data-app-value "raw|unit|scale" triple for the was-price. */
function formatTrackValue(trackValue) {
  const [raw, unit, scaleRaw] = String(trackValue).split('|');
  const num = Number(raw);
  const scale = Number(scaleRaw);
  const s = Number.isInteger(scale) ? scale : 0;
  if (raw !== '' && Number.isFinite(num)) {
    if (unit && /^[A-Z]{3}$/.test(unit)) {
      return formatStateValue({ type: 'number', value: num, unit, scale: s });
    }
    return formatScaledNumber(num, s);
  }
  return raw;
}

function pickSectionRenderer(layout) {
  switch (layout) {
    case 'table':
      return renderTable;
    case 'detail':
      return renderDetail;
    case 'card':
    case 'grid':
      return renderCard;
    case 'form':
      return (opts) => {
        // Section-level form still shows as detail+actions; fall through list-like
        const { el } = renderForm({
          actions: opts.manifest.actions,
          manifest: opts.manifest,
          bindings: opts.bindings,
          onSubmit: opts.onAction,
          primaryActionId: opts.section.primary_action,
          onTypeahead: opts.onTypeahead,
        });
        return el;
      };
    case 'list':
    default:
      return renderList;
  }
}

function boundNode(hint, key, manifest) {
  const path = hint.state_path || key;
  return getByPointer(manifest, `/state/${path.replace(/\./g, '/')}`) || manifest.state?.[path];
}

function renderComponentHint(hint, key, manifest, bindings, onAction) {
  const type = hint.type;
  if (type === 'consent') {
    const node = manifest.state?.consent;
    if (!node) return null;
    const { el } = renderConsent({
      consentNode: node,
      privacyNode: manifest.state?.privacy,
      onGrant: (purposes) => onAction('grant_consent', { purposes }),
    });
    return el;
  }
  if (type === 'order') {
    const path = hint.state_path || 'order';
    const pointer = `/state/${path.replace(/\./g, '/')}`;
    const node = getByPointer(manifest, pointer) || manifest.state?.[path];
    if (!node) return null;
    return renderOrder({ node, pointer, actions: manifest.actions, onAction }).el;
  }
  if (type === 'geopoint') {
    const path = hint.state_path || key;
    const node =
      getByPointer(manifest, `/state/${path.replace(/\./g, '/')}`) || manifest.state?.[path];
    if (!node) return null;
    return renderGeopoint({ node }).el;
  }
  if (type === 'gallery') {
    const node = boundNode(hint, key, manifest);
    if (!node || (node.type !== 'media' && node.type !== 'array')) return null;
    return renderMedia({ node }).el;
  }
  if (type === 'calendar') {
    const node = boundNode(hint, key, manifest);
    if (!node || (node.type !== 'array' && node.type !== 'daterange')) return null;
    return renderCalendar({ node }).el;
  }
  if (type === 'stepper') {
    const node = boundNode(hint, key, manifest);
    if (!node || node.type !== 'number') return null;
    return renderStepper({ node }).el;
  }
  if (type === 'otp' || type === 'challenge') {
    const node = manifest.state?.challenge;
    if (!node) return null;
    const parsed = validateChallengeRecord(node);
    if (!parsed.ok) return null;
    return renderOtpForm({
      challenge: parsed.challenge,
      onSubmit: (params) => onAction('submit_otp', params),
    }).el;
  }
  if (type === 'button') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `app-btn app-btn-${hint.variant || 'primary'}`;
    btn.textContent = hint.label || hint.action_id || key;
    btn.addEventListener('click', () => onAction(hint.action_id, hint.param_map || {}));
    return btn;
  }
  if (type === 'banner') {
    const el = document.createElement('div');
    el.className = 'app-banner';
    el.setAttribute('role', 'status');
    const pointer = hint.state_path ? `/state/${hint.state_path.replace(/\./g, '/')}` : null;
    if (pointer) {
      const node = getByPointer(manifest, pointer);
      el.textContent = formatStateValue(node);
      bindings.set(pointer, el);
    } else {
      el.textContent = hint.label || '';
    }
    return el;
  }
  if (type === 'price') {
    const el = document.createElement('div');
    el.className = 'app-price';
    const pointer = `/state/${(hint.state_path || '').replace(/\./g, '/')}`;
    const node = getByPointer(manifest, pointer);
    el.textContent = formatStateValue(node, 'currency');
    bindings.set(pointer, el);
    return el;
  }
  if (type === 'spinner') {
    const el = document.createElement('div');
    el.className = 'app-spinner';
    el.setAttribute('aria-hidden', 'true');
    return el;
  }
  return null;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Factory: mount renderer into closed shadow root on an element.
 */
export async function mountShadowRenderer(hostEl, options = {}) {
  const shadow = hostEl.attachShadow({ mode: 'closed' });

  // Inject styles
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = options.stylesheetUrl || chrome.runtime.getURL('assets/styles.css');
  shadow.appendChild(link);

  // R5: a @font-face declared inside a closed shadow root does not apply;
  // install the face at document level so the store font renders.
  const fontUrl =
    options.fontUrl || chrome.runtime.getURL('assets/fonts/SchibstedGrotesk-Variable.ttf');
  if (fontUrl && typeof FontFace === 'function' && document.fonts) {
    try {
      const face = new FontFace('Schibsted Grotesk', `url("${fontUrl}") format("truetype")`, {
        weight: '400 900',
        style: 'normal',
        display: 'swap',
      });
      document.fonts.add(face);
      face.load().catch(() => {});
    } catch {
      /* font is decorative */
    }
  }

  const renderer = new AppRenderer({
    root: shadow,
    origin: options.origin || location.origin,
    url: options.url || location.href,
    settings: options.settings || {},
    send: options.send,
  });
  renderer.mount();
  return { renderer, shadow };
}

export { needsConfirmation, confirmationLevel };
