/**
 * Semantic lint for Page Manifests — the cross-field rules JSON Schema
 * cannot express (v0.4 §3.3.5 / §5.7 / §10.5; v0.5 §10.2).
 *
 * lintManifest(doc) → [{ level: 'error'|'warn', rule, path, message }]
 *   error — the manifest violates a spec MUST (publish-time violation).
 *   warn  — suspicious or unverifiable statically; agents may degrade.
 */

const STATE_KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
const LOOPBACK_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/;

function isLoopbackOrHttps(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return true;
    if (u.protocol === 'http:') return LOOPBACK_HOST.test(u.hostname);
    return false;
  } catch {
    return true; // malformed URLs are the schema's job, not ours
  }
}

// Walk every StateNode in a manifest's state, yielding [path, node].
function* walkState(state, base = '') {
  for (const [key, node] of Object.entries(state ?? {})) {
    const path = base ? `${base}.${key}` : key;
    if (node && typeof node === 'object') {
      yield [path, node];
      if (
        node.type === 'object' &&
        node.value &&
        typeof node.value === 'object' &&
        !Array.isArray(node.value)
      ) {
        yield* walkState(node.value, path);
      }
      if (node.type === 'array' && Array.isArray(node.value)) {
        for (const item of node.value) {
          if (item && typeof item === 'object' && item.type === 'object' && item.value) {
            yield* walkState(item.value, path);
          }
        }
      }
    }
  }
}

// Resolve a present dot-path ("results" or "flight.segments") against state.
// Returns 'found' | 'missing' | 'opaque' (can't statically resolve).
function resolveStatePath(state, dotPath) {
  const segs = String(dotPath).split('.');
  let scope = state;
  for (const seg of segs) {
    const node = scope?.[seg];
    if (!node || typeof node !== 'object') return 'missing';
    if (node.type === 'object' && node.value && typeof node.value === 'object') {
      scope = node.value;
    } else if (segs[segs.length - 1] === seg) {
      return 'found'; // leaf node reached
    } else {
      return 'opaque'; // non-object node with deeper path — can't verify
    }
  }
  return 'found';
}

export function lintManifest(doc, { name = 'manifest' } = {}) {
  const findings = [];
  const push = (level, rule, path, message) =>
    findings.push({ level, rule, path, message, doc: name });

  const state = doc?.state ?? {};
  const actions = doc?.actions ?? {};
  const actionIds = new Set(Object.keys(actions));
  const stateKeys = new Set(Object.keys(state));

  // ---- present.sections -------------------------------------------------
  const sections = doc?.present?.sections ?? [];
  const sectionIds = new Set(sections.map((s) => s?.id).filter(Boolean));
  for (const sec of sections) {
    if (!sec || typeof sec !== 'object') continue;
    const at = `/present/sections/${sec.id ?? '?'}`;
    if (sec.state_path) {
      const r = resolveStatePath(state, sec.state_path);
      if (r === 'missing') {
        push(
          'error',
          'state_path_unresolved',
          `${at}/state_path`,
          `state_path '${sec.state_path}' does not resolve into /state`,
        );
      }
    }
    if (sec.primary_action && !actionIds.has(sec.primary_action)) {
      push(
        'error',
        'primary_action_unknown',
        `${at}/primary_action`,
        `primary_action '${sec.primary_action}' is not a key of /actions`,
      );
    }
    if (sec.layout === 'form' && !sec.primary_action) {
      push(
        'warn',
        'form_section_no_action',
        at,
        `layout 'form' without primary_action renders nothing`,
      );
    }
    if (sec.layout === 'table' && !sec.state_path) {
      push(
        'warn',
        'table_section_no_state',
        at,
        `layout 'table' without state_path has no data source`,
      );
    }
  }

  // ---- present.components ----------------------------------------------
  for (const key of Object.keys(doc?.present?.components ?? {})) {
    if (!stateKeys.has(key) && !sectionIds.has(key)) {
      push(
        'warn',
        'component_hint_orphan',
        `/present/components/${key}`,
        `component hint '${key}' matches neither a state key nor a section id`,
      );
    }
  }

  // ---- manifest-level soft error (v0.4 §3.3.5) --------------------------
  const softErr = doc?.error;
  if (softErr && typeof softErr === 'object') {
    for (const id of softErr.recoverable_actions ?? []) {
      if (!actionIds.has(id)) {
        push(
          'error',
          'recoverable_action_unknown',
          `/error/recoverable_actions`,
          `recoverable_actions '${id}' is not a key of /actions (§3.3.5)`,
        );
      }
    }
  }

  // ---- state node semantics ----------------------------------------------
  for (const [path, node] of walkState(state)) {
    if (node.type === 'enum' && node.value != null && Array.isArray(node.options)) {
      if (!node.options.includes(node.value)) {
        push(
          'error',
          'enum_value_not_in_options',
          `/state/${path}`,
          `enum value ${JSON.stringify(node.value)} not in options`,
        );
      }
    }
    if (node.secret === true && node.type !== 'string') {
      push(
        'error',
        'secret_non_string',
        `/state/${path}`,
        `secret:true is only meaningful on string nodes (§10.5)`,
      );
    }
    if (node.type === 'file' && typeof node.value === 'object' && node.value?.url) {
      if (!isLoopbackOrHttps(node.value.url)) {
        push(
          'error',
          'file_url_insecure',
          `/state/${path}`,
          `file url '${node.value.url}' is not https/loopback`,
        );
      }
    }
    if (node.type === 'table' && Array.isArray(node.fields) && Array.isArray(node.rows)) {
      const width = node.fields.length;
      node.rows.forEach((row, i) => {
        if (Array.isArray(row) && row.length !== width) {
          push(
            'error',
            'table_row_width',
            `/state/${path}/rows[${i}]`,
            `row has ${row.length} cells but table declares ${width} fields`,
          );
        }
      });
    }
  }

  // ---- consent purposes referenced by policies ---------------------------
  const consentNode = state.consent;
  const declaredPurposes = new Set(
    (consentNode?.type === 'object' ? consentNode.value?.purposes : undefined)?.map?.(
      (p) => p?.id?.value ?? p?.id,
    ) ?? [],
  );

  // ---- action definitions -------------------------------------------------
  for (const [aid, def] of Object.entries(actions)) {
    if (!def || typeof def !== 'object') continue;
    const at = `/actions/${aid}`;
    const inputKeys = new Set(Object.keys(def.input ?? {}));

    for (const pname of def.policy?.secret_params ?? []) {
      if (!inputKeys.has(pname)) {
        push(
          'error',
          'secret_param_undeclared',
          `${at}/policy/secret_params`,
          `secret_params '${pname}' is not an input param of '${aid}'`,
        );
      }
    }
    for (const pname of def.policy?.pii_params ?? []) {
      if (!inputKeys.has(pname)) {
        push(
          'error',
          'pii_param_undeclared',
          `${at}/policy/pii_params`,
          `pii_params '${pname}' is not an input param of '${aid}'`,
        );
      }
    }
    for (const purpose of def.policy?.consent_purposes ?? []) {
      if (declaredPurposes.size && !declaredPurposes.has(purpose)) {
        push(
          'warn',
          'consent_purpose_undeclared',
          `${at}/policy/consent_purposes`,
          `consent_purposes '${purpose}' not declared in state.consent.purposes`,
        );
      }
    }

    // options_source (v0.5 §10.2 publish-time constraints)
    for (const [pname, pdef] of Object.entries(def.input ?? {})) {
      const src = pdef?.options_source;
      if (!src) continue;
      const pat = `${at}/input/${pname}/options_source`;
      if (typeof src.action === 'string' && !actionIds.has(src.action)) {
        push(
          'error',
          'options_source_action_unknown',
          pat,
          `options_source action '${src.action}' is not a key of /actions`,
        );
      } else if (typeof src.action === 'string') {
        const target = actions[src.action];
        if (
          target &&
          (target.kind !== 'query' || target.side_effect !== 'safe' || target.idempotent !== true)
        ) {
          push(
            'error',
            'options_source_target_invalid',
            pat,
            `options_source target '${src.action}' must be kind:'query', side_effect:'safe', idempotent:true (§10.2)`,
          );
        }
        if (typeof src.param === 'string' && target?.input && !(src.param in target.input)) {
          push(
            'warn',
            'options_source_param_unknown',
            pat,
            `options_source param '${src.param}' is not an input of '${src.action}'`,
          );
        }
      }
      if (typeof src.results_path === 'string' && !STATE_KEY_RE.test(src.results_path)) {
        push(
          'error',
          'options_source_results_path',
          pat,
          `results_path '${src.results_path}' is not a valid state key`,
        );
      }
    }

    // confirm.amount_path resolves into state (v0.4 §10.4 L2)
    if (def.confirm?.amount_path) {
      const r = resolveStatePath(state, def.confirm.amount_path);
      if (r === 'missing') {
        push(
          'error',
          'amount_path_unresolved',
          `${at}/confirm/amount_path`,
          `amount_path '${def.confirm.amount_path}' does not resolve into /state`,
        );
      }
    }

    // navigate/delegate mutual exclusion (SPEC.md output rules)
    const navTo = def.output?.navigates_to;
    const delTo = def.output?.delegates_to;
    if (navTo && delTo) {
      push(
        'error',
        'output_navigate_and_delegate',
        `${at}/output`,
        `navigates_to and delegates_to MUST NOT both be non-null`,
      );
    }
    if (def.kind === 'navigate' && !navTo) {
      push('warn', 'navigate_no_target', `${at}`, `kind 'navigate' without output.navigates_to`);
    }
    if (def.requires_etag_match === true && (def.kind === 'query' || def.kind === 'navigate')) {
      push(
        'warn',
        'etag_match_on_read',
        `${at}/requires_etag_match`,
        `requires_etag_match on '${def.kind}' guards a read — usually for mutating actions`,
      );
    }
  }

  // ---- navigation items ----------------------------------------------------
  for (const item of doc?.navigation?.items ?? []) {
    if (item?.url && !isLoopbackOrHttps(item.url)) {
      push(
        'warn',
        'nav_url_insecure',
        `/navigation/items`,
        `navigation url '${item.url}' is not https/loopback`,
      );
    }
  }
  if (doc?.page?.url && !isLoopbackOrHttps(doc.page.url)) {
    push(
      'error',
      'page_url_insecure',
      `/page/url`,
      `page.url '${doc.page.url}' is not https/loopback (v0.4 §3.3.3)`,
    );
  }

  return findings;
}
