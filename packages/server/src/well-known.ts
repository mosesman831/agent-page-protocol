/**
 * Well-known discovery validation helpers (§4.1 / C15, v0.5 §3).
 * Capabilities MUST be an array of string StateNodes - never bare strings.
 * Accepts app 1.0 or 1.1. protocol_version is the MAXIMUM spoken.
 * 1.0 well-known with protocol_version 1.0 remains valid (TV-16).
 */

import type { PageManifest, StateNode, ValidationFailure } from './types.js';
import { validateStateRoot } from './validate-state.js';
import { parseFeatureFlags, validateFeatureImplications } from './features.js';
import { isSupportedProtocolVersion } from './media-types.js';

const WELL_KNOWN_PAGE_ID = 'well-known';

function fail(code: string, message: string, path?: string): ValidationFailure {
  return { code, message, path };
}

function isStringNode(node: unknown): node is { type: 'string'; value: string } {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as StateNode).type === 'string' &&
    typeof (node as { value?: unknown }).value === 'string'
  );
}

function isObjectNode(node: unknown): node is { type: 'object'; value: Record<string, StateNode> } {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as StateNode).type === 'object' &&
    typeof (node as { value?: unknown }).value === 'object' &&
    (node as { value?: unknown }).value !== null &&
    !Array.isArray((node as { value?: unknown }).value)
  );
}

function isArrayNode(node: unknown): node is { type: 'array'; value: unknown[] } {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as StateNode).type === 'array' &&
    Array.isArray((node as { value?: unknown }).value)
  );
}

function nestedString(obj: { value: Record<string, StateNode> }, key: string): string | undefined {
  const child = obj.value[key];
  return isStringNode(child) ? child.value : undefined;
}

/**
 * Validate a well-known agent-page manifest (C15 StateNode rules).
 */
export function validateWellKnownManifest(manifest: unknown): ValidationFailure | null {
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'Well-known must be a Page Manifest object',
    );
  }
  const m = manifest as PageManifest;

  if (typeof m.app !== 'string' || !isSupportedProtocolVersion(m.app)) {
    return fail('app.err.discovery.invalid_well_known', 'app must be "1.0" or "1.1"', '/app');
  }
  if (!m.page || typeof m.page !== 'object') {
    return fail('app.err.discovery.invalid_well_known', 'page is required', '/page');
  }
  if (m.page.id !== WELL_KNOWN_PAGE_ID) {
    return fail(
      'app.err.discovery.invalid_well_known',
      `page.id must be "${WELL_KNOWN_PAGE_ID}"`,
      '/page/id',
    );
  }
  if (typeof m.page.url !== 'string' || m.page.url.length === 0) {
    return fail('app.err.discovery.invalid_well_known', 'page.url is required', '/page/url');
  }
  if (typeof m.page.version !== 'string' || m.page.version.length === 0) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'page.version is required',
      '/page/version',
    );
  }

  const stateErr = validateStateRoot(m.state);
  if (stateErr) {
    return {
      code: 'app.err.discovery.invalid_well_known',
      message: stateErr.message,
      path: stateErr.path,
    };
  }

  const state = m.state ?? {};

  if (!isStringNode(state.site_name)) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.site_name must be a string StateNode',
      '/state/site_name',
    );
  }
  if (state.site_name.value.length < 1 || state.site_name.value.length > 100) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.site_name value must be 1-100 chars',
      '/state/site_name/value',
    );
  }

  if (
    !isStringNode(state.protocol_version) ||
    !isSupportedProtocolVersion(state.protocol_version.value)
  ) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.protocol_version must be string StateNode "1.0" or "1.1"',
      '/state/protocol_version',
    );
  }

  const caps = state.capabilities;
  if (!caps || typeof caps !== 'object' || (caps as StateNode).type !== 'array') {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.capabilities must be an array StateNode of string nodes',
      '/state/capabilities',
    );
  }
  const capValues = (caps as { value?: unknown }).value;
  if (!Array.isArray(capValues) || capValues.length > 64) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.capabilities.value must be an array of 0-64 string StateNodes',
      '/state/capabilities/value',
    );
  }
  for (let i = 0; i < capValues.length; i++) {
    if (!isStringNode(capValues[i])) {
      return fail(
        'app.err.discovery.invalid_well_known',
        'capabilities items must be string StateNodes (not bare strings)',
        `/state/capabilities/value/${i}`,
      );
    }
  }

  if (state.features !== undefined) {
    if (!isObjectNode(state.features)) {
      return fail(
        'app.err.discovery.invalid_well_known',
        'state.features must be an object StateNode',
        '/state/features',
      );
    }
    const flags = parseFeatureFlags(state.features);
    const implied = validateFeatureImplications(flags);
    if (!implied.ok) {
      return (
        implied.errors[0] ??
        fail('app.err.discovery.invalid_well_known', 'Invalid feature implications')
      );
    }

    if (flags.identity_flows) {
      if (!isObjectNode(state.flows)) {
        return fail(
          'app.err.discovery.invalid_well_known',
          'identity_flows requires state.flows object with login.entry_url',
          '/state/flows',
        );
      }
      const login = state.flows.value.login;
      if (!isObjectNode(login) || !nestedString(login, 'entry_url')) {
        return fail(
          'app.err.discovery.invalid_well_known',
          'identity_flows requires flows.login.entry_url',
          '/state/flows/value/login/value/entry_url',
        );
      }
    }

    if (flags.consent) {
      if (!isObjectNode(state.privacy)) {
        return fail(
          'app.err.discovery.invalid_well_known',
          'consent requires state.privacy with policy_url and purposes',
          '/state/privacy',
        );
      }
      if (!nestedString(state.privacy, 'policy_url')) {
        return fail(
          'app.err.discovery.invalid_well_known',
          'consent requires privacy.policy_url',
          '/state/privacy/value/policy_url',
        );
      }
      if (!isArrayNode(state.privacy.value.purposes)) {
        return fail(
          'app.err.discovery.invalid_well_known',
          'consent requires privacy.purposes',
          '/state/privacy/value/purposes',
        );
      }
    }
  } else {
    if (state.flows !== undefined && !isObjectNode(state.flows)) {
      return fail(
        'app.err.discovery.invalid_well_known',
        'state.flows must be an object StateNode',
        '/state/flows',
      );
    }
    if (state.privacy !== undefined && !isObjectNode(state.privacy)) {
      return fail(
        'app.err.discovery.invalid_well_known',
        'state.privacy must be an object StateNode',
        '/state/privacy',
      );
    }
  }

  if (state.events_url !== undefined && !isStringNode(state.events_url)) {
    return fail(
      'app.err.discovery.invalid_well_known',
      'state.events_url must be a string StateNode',
      '/state/events_url',
    );
  }

  return null;
}

/** Build a capabilities array StateNode from string capability ids. */
export function buildCapabilitiesNode(capabilities: string[]): StateNode {
  return {
    type: 'array',
    value: capabilities.map((c) => ({ type: 'string' as const, value: c })),
    label: 'Capabilities',
  };
}
