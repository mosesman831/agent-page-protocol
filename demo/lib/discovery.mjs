/**
 * /.well-known/agent-page discovery manifest for the demo server.
 * Shared by serve.mjs (HTTP) and the schema wire corpus (validation).
 */

const str = (value, label) => ({ type: 'string', value, ...(label ? { label } : {}) });

export function wellKnownManifest(origin, opts = {}) {
  return {
    app: '1.1',
    page: {
      id: 'well-known',
      url: `${origin}/.well-known/agent-page`,
      title: 'APP Demo Sites',
      version: 'wk-1',
    },
    state: {
      site_name: str('APP Demo Sites'),
      site_type: str('demo'),
      protocol_version: str('1.1'),
      capabilities: {
        type: 'array',
        value: ['search', 'checkout', 'booking', 'user_account', 'present'].map((c) => str(c)),
      },
      // §3.4 features object: what the lab/middleware actually supports.
      features: {
        type: 'object',
        label: 'Protocol features',
        value: {
          consent: { type: 'boolean', value: true },
          events_sse: { type: 'boolean', value: true },
          events_longpoll: { type: 'boolean', value: true },
          typeahead: { type: 'boolean', value: true },
          bulk_actions: { type: 'boolean', value: true },
          geopoint: { type: 'boolean', value: true },
          quantity: { type: 'boolean', value: true },
          datetime_range: { type: 'boolean', value: true },
          commerce: { type: 'boolean', value: true },
          order_state: { type: 'boolean', value: true },
          deep_focus: { type: 'boolean', value: true },
          locale_tz: { type: 'boolean', value: true },
          identity_flows: { type: 'boolean', value: true },
          mfa: { type: 'boolean', value: true },
          ...(opts.auth ? { auth_oauth: { type: 'boolean', value: true } } : {}),
        },
      },
      entry_urls: {
        type: 'object',
        value: {
          home: str(`${origin}/`),
          british_airways: str(`${origin}/app/ba/home`),
          hotel_booking: str(`${origin}/app/hotel/search`),
          google_classroom: str(`${origin}/app/gc/home`),
          protocol_lab: str(`${origin}/app/lab/home`),
        },
      },
      // SPEC-AUTH §2: endpoint + supported-scope advertisement when the
      // delegated-auth profile is mounted (full server only).
      ...(opts.auth
        ? {
            endpoints: {
              type: 'object',
              label: 'Auth endpoints',
              value: {
                token_endpoint: str(`${origin}/app-oauth/token`, 'Token endpoint'),
                authorization_endpoint: str(
                  `${origin}/app/oauth/authorize`,
                  'Authorization endpoint',
                ),
              },
            },
            scopes_supported: {
              type: 'array',
              label: 'Supported scopes',
              value: ['read', 'class:safe', 'class:identity', 'class:financial'].map((s) => str(s)),
            },
          }
        : {}),
    },
    actions: {},
  };
}
