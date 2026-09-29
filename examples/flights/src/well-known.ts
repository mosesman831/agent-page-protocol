import { buildCapabilitiesNode, type ActionHandler, type PageManifest } from '@agent-page/server';
import {
  asManifest,
  boolNode,
  buildFeaturesNode,
  enumNode,
  numberNode,
  stringNode,
} from './protocol.js';

export function buildWellKnownManifest(origin: string): PageManifest {
  return asManifest({
    app: '1.1',
    page: {
      id: 'well-known',
      url: `${origin}/.well-known/agent-page`,
      title: 'Site Agent Manifest',
      version: 'v1',
      etag: 'W/"wk-1"',
      description: 'Acme Flights site discovery (APP 1.1 dual-speak)',
      language: 'en',
    },
    state: {
      site_name: { type: 'string', value: 'Acme Flights' },
      site_type: { type: 'string', value: 'travel' },
      protocol_version: { type: 'string', value: '1.1' },
      capabilities: buildCapabilitiesNode([
        'search',
        'booking',
        'user_account',
        'diffs',
        'present',
        'pagination',
        'async_actions',
        'auth_session',
        'auth_bearer',
      ]),
      features: buildFeaturesNode(),
      entry_urls: {
        type: 'object',
        value: {
          home: { type: 'string', value: `${origin}/` },
          search: { type: 'string', value: `${origin}/flights` },
          login: { type: 'string', value: `${origin}/login` },
          consent: { type: 'string', value: `${origin}/consent` },
        },
      },
      events_url: { type: 'string', value: `${origin}/app-events` },
      locale_default: { type: 'string', value: 'en-GB' },
      time_zone_default: { type: 'string', value: 'Europe/London' },
      flows: {
        type: 'object',
        label: 'Identity flows',
        value: {
          login: {
            type: 'object',
            value: {
              kind: enumNode('password', ['password', 'oauth', 'passkey', 'magic_link', 'mixed']),
              entry_url: stringNode(`${origin}/login`),
              logout_url: stringNode(`${origin}/logout`),
              mfa: boolNode(true),
            },
          },
          logout: {
            type: 'object',
            value: {
              kind: enumNode('password', ['password', 'oauth', 'passkey', 'magic_link', 'mixed']),
              entry_url: stringNode(`${origin}/logout`),
            },
          },
        },
      },
      privacy: {
        type: 'object',
        label: 'Privacy',
        value: {
          policy_url: stringNode(`${origin}/consent`),
          retention_days: numberNode(365),
          controller: stringNode('Acme Flights Ltd'),
          lawful_basis_default: enumNode('consent', [
            'consent',
            'contract',
            'legitimate_interest',
            'legal_obligation',
            'vital',
            'public_task',
          ]),
          purposes: {
            type: 'array',
            item_label: 'purpose',
            value: [
              {
                type: 'object',
                value: {
                  id: stringNode('necessary'),
                  label: stringNode('Strictly necessary'),
                  required: boolNode(true),
                  retention_days: numberNode(1),
                },
              },
              {
                type: 'object',
                value: {
                  id: stringNode('analytics'),
                  label: stringNode('Analytics'),
                  required: boolNode(false),
                  retention_days: numberNode(365),
                },
              },
              {
                type: 'object',
                value: {
                  id: stringNode('marketing'),
                  label: stringNode('Marketing'),
                  required: boolNode(false),
                  retention_days: numberNode(90),
                },
              },
            ],
          },
        },
      },
    },
    actions: {
      open_search: {
        description: 'Open the flight search page',
        kind: 'navigate',
        input: {},
        output: { navigates_to: `${origin}/flights` },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 5000,
        auth: 'none',
        param_mode: 'strict',
      },
      search: {
        description: 'Search for flights by query parameters',
        kind: 'navigate',
        input: {
          q: { type: 'string', required: true, description: 'Free-text search' },
        },
        output: { navigates_to: `${origin}/search?q={q}` },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 10000,
        auth: 'none',
        param_mode: 'strict',
      },
      open_login: {
        description: 'Open the login flow',
        kind: 'navigate',
        input: {},
        output: { navigates_to: `${origin}/login` },
        side_effect: 'safe',
        idempotent: true,
        timeout_ms: 5000,
        auth: 'none',
        param_mode: 'strict',
      },
    },
    meta: { cache: { public: true, max_age: 300 } },
  });
}

export function createWellKnownHandlers(origin: string): Record<string, ActionHandler> {
  return {
    open_search: async () => ({
      type: 'navigate',
      url: `${origin}/flights`,
      mode: 'push',
    }),
    search: async ({ params }) => ({
      type: 'navigate',
      url: `${origin}/search?q=${encodeURIComponent(String(params.q ?? ''))}`,
      mode: 'push',
    }),
    open_login: async () => ({
      type: 'navigate',
      url: `${origin}/login`,
      mode: 'push',
    }),
  };
}
