/**
 * Identity flow runner (SPEC-v0.5-extreme §4, §25.2).
 * Login/logout/signup/recovery are ordinary APP pages + actions.
 */

import type { ActionDispatcher } from './actions.js';
import { AppError } from './errors.js';
import { parseFeatures, readCapabilities, readStringNode, unwrapStateNode } from './features.js';
import type { AppHttpClient, AppResponseMeta } from './http.js';
import { hydrate, type HydrateContext } from './hydrate.js';
import type { ManifestCache } from './cache.js';
import type { ResumeStore } from './resume.js';
import type { FeatureFlags, FlowKind, InvokeResult, PageManifest } from './types.js';

export interface IdentityFlow {
  id: string;
  kind: FlowKind;
  entry_url: string;
  logout_url?: string;
  signup_url?: string;
  recovery_url?: string;
  mfa?: boolean;
}

export interface DiscoverResult {
  protocol: string;
  capabilities: string[];
  features: FeatureFlags;
  flows: Record<string, IdentityFlow>;
  eventsUrl?: string;
  manifest: PageManifest;
}

export interface IdentityHost {
  http: AppHttpClient;
  cache: ManifestCache;
  hydrate: HydrateContext;
  actions: ActionDispatcher;
  resume: ResumeStore;
  captureTokens(meta: AppResponseMeta, url: string): void;
}

export function wellKnownUrl(origin: string): string {
  const base = origin.endsWith('/') ? origin.slice(0, -1) : origin;
  return `${base}/.well-known/agent-page`;
}

export function parseFlows(manifest: PageManifest): Record<string, IdentityFlow> {
  const raw = unwrapStateNode(manifest.state?.flows) as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, IdentityFlow> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const rec = value as Record<string, unknown>;
    const entry = typeof rec.entry_url === 'string' ? rec.entry_url : undefined;
    const kind = (typeof rec.kind === 'string' ? rec.kind : 'password') as FlowKind;
    if (!entry) continue;
    const flow: IdentityFlow = { id, kind, entry_url: entry };
    if (typeof rec.logout_url === 'string') flow.logout_url = rec.logout_url;
    if (typeof rec.signup_url === 'string') flow.signup_url = rec.signup_url;
    if (typeof rec.recovery_url === 'string') flow.recovery_url = rec.recovery_url;
    if (typeof rec.mfa === 'boolean') flow.mfa = rec.mfa;
    out[id] = flow;
  }
  return out;
}

export function parseEventsUrl(manifest: PageManifest): string | undefined {
  return (
    readStringNode(manifest.state?.events_url) ??
    (typeof manifest.meta?.events_url === 'string' ? manifest.meta.events_url : undefined)
  );
}

export function parseProtocolVersion(manifest: PageManifest): string {
  return readStringNode(manifest.state?.protocol_version) ?? manifest.app;
}

export async function discoverOrigin(host: IdentityHost, origin: string): Promise<DiscoverResult> {
  const url = wellKnownUrl(origin);
  const manifest = await hydrate(host.hydrate, url, { force: true });
  const features = parseFeatures(manifest);
  return {
    protocol: parseProtocolVersion(manifest),
    capabilities: readCapabilities(manifest),
    features,
    flows: parseFlows(manifest),
    eventsUrl: parseEventsUrl(manifest),
    manifest,
  };
}

export function loginUrlFromError(err: AppError): string | undefined {
  const details = err.envelope.error.details;
  if (!details) return undefined;
  return readStringNode(details.login_url);
}

export function refreshAvailable(err: AppError): boolean {
  const details = err.envelope.error.details;
  if (!details) return false;
  const node = details.refresh_available;
  if (node && node.type === 'boolean') return node.value === true;
  return false;
}

function firstIdentityAction(manifest: PageManifest, prefer: string[]): string | undefined {
  for (const id of prefer) {
    if (manifest.actions?.[id]) return id;
  }
  for (const [id, def] of Object.entries(manifest.actions ?? {})) {
    if (def.side_effect === 'identity' && def.kind === 'mutate') return id;
  }
  return undefined;
}

export async function runLogin(
  host: IdentityHost,
  origin: string,
  params: Record<string, unknown>,
  options: { loginUrl?: string } = {},
): Promise<InvokeResult> {
  const discovered = await discoverOrigin(host, origin);
  if (!discovered.features.identity_flows) {
    throw new AppError('app.err.discovery.not_supported', {
      message: 'identity_flows is not advertised; login is out of APP (1.0 semantics)',
    });
  }
  const loginUrl = options.loginUrl ?? discovered.flows.login?.entry_url;
  if (!loginUrl) {
    throw new AppError('app.err.auth.flow_unknown', {
      message: 'No login.entry_url in well-known flows',
    });
  }
  const page = await hydrate(host.hydrate, loginUrl, {
    fromPageUrl: discovered.manifest.page.url,
    force: true,
  });
  const actionId = firstIdentityAction(page, ['submit_credentials', 'login']);
  if (!actionId) {
    throw new AppError('app.err.action.not_found', {
      message: 'Login page has no identity mutate action',
    });
  }
  return host.actions.invoke(page, actionId, params);
}

export async function runLogout(
  host: IdentityHost,
  origin: string,
  params: Record<string, unknown> = {},
): Promise<InvokeResult | PageManifest> {
  const discovered = await discoverOrigin(host, origin);
  const logoutUrl =
    discovered.flows.logout?.entry_url ??
    discovered.flows.login?.logout_url ??
    `${origin.replace(/\/$/, '')}/logout`;
  const page = await hydrate(host.hydrate, logoutUrl, { force: true });
  const actionId = firstIdentityAction(page, ['logout']);
  let result: InvokeResult | PageManifest = page;
  if (actionId) {
    result = await host.actions.invoke(page, actionId, params);
  }
  host.cache.invalidatePrivate();
  host.resume.clear(origin);
  return result;
}

export async function runSignup(
  host: IdentityHost,
  origin: string,
  params: Record<string, unknown>,
): Promise<InvokeResult> {
  const discovered = await discoverOrigin(host, origin);
  const url = discovered.flows.signup?.entry_url ?? discovered.flows.login?.signup_url;
  if (!url) {
    throw new AppError('app.err.auth.flow_unknown', { message: 'No signup_url' });
  }
  const page = await hydrate(host.hydrate, url, { force: true });
  const actionId = firstIdentityAction(page, ['submit_signup', 'signup']);
  if (!actionId) {
    throw new AppError('app.err.action.not_found', { message: 'Signup action not found' });
  }
  return host.actions.invoke(page, actionId, params);
}

export async function runRecovery(
  host: IdentityHost,
  origin: string,
  params: Record<string, unknown>,
): Promise<InvokeResult> {
  const discovered = await discoverOrigin(host, origin);
  const url = discovered.flows.recovery?.entry_url ?? discovered.flows.login?.recovery_url;
  if (!url) {
    throw new AppError('app.err.auth.flow_unknown', { message: 'No recovery_url' });
  }
  const page = await hydrate(host.hydrate, url, { force: true });
  const actionId = firstIdentityAction(page, ['start_recovery', 'recover']);
  if (!actionId) {
    throw new AppError('app.err.action.not_found', { message: 'Recovery action not found' });
  }
  return host.actions.invoke(page, actionId, params);
}

export async function runResume(
  host: IdentityHost,
  origin: string,
  token: string,
  pageUrl?: string,
): Promise<PageManifest> {
  host.resume.set(origin, token);
  const target = pageUrl ?? wellKnownUrl(origin);
  return hydrate(host.hydrate, target, { force: true, resumeToken: token });
}
