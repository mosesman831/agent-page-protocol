/**
 * Extra v0.4 state validation for conformance harness emit checks.
 */

import { validateStateRoot } from '@agent-page/server';

interface ValidationFailure {
  code: string;
  message: string;
  path?: string;
}

const MAX_SAFE_INT = 9007199254740991;

function extraStateChecks(state: unknown): ValidationFailure | null {
  const walk = (node: unknown, path: string): ValidationFailure | null => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    const n = node as Record<string, unknown>;
    if (n.type === 'number' && typeof n.value === 'number') {
      const v = n.value;
      if (Number.isInteger(v) && Math.abs(v) > MAX_SAFE_INT) {
        return {
          code: 'app.err.state.number_precision',
          message: `Integer ${v} exceeds 2^53-1`,
          path: `${path}/value`,
        };
      }
      if (Object.is(v, -0)) {
        (n as { value: number }).value = 0;
      }
    }
    if (n.type === 'file' && n.value && typeof n.value === 'object') {
      const fv = n.value as { url?: string };
      if (typeof fv.url === 'string') {
        try {
          const u = new URL(fv.url);
          const host = u.hostname.toLowerCase();
          const loopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
          if (u.protocol === 'http:' && !loopback) {
            return {
              code: 'app.err.state.invalid_file',
              message: 'http file URLs only allowed on loopback',
              path: `${path}/value/url`,
            };
          }
        } catch {
          return {
            code: 'app.err.state.invalid_file',
            message: 'invalid file url',
            path: `${path}/value/url`,
          };
        }
      }
    }
    if (n.type === 'array' || n.type === 'object' || n.type === 'table') {
      if (n.type === 'array' && Array.isArray(n.value)) {
        for (let i = 0; i < n.value.length; i++) {
          const err = walk(n.value[i], `${path}/value/${i}`);
          if (err) return err;
        }
      }
      if (n.type === 'object' && n.value && typeof n.value === 'object') {
        for (const [k, v] of Object.entries(n.value as Record<string, unknown>)) {
          const err = walk(v, `${path}/value/${k}`);
          if (err) return err;
        }
      }
      if (n.type === 'array' || n.type === 'table') {
        const pag = n.pagination as { cursor?: unknown; has_more?: boolean } | undefined;
        if (pag && pag.cursor === null && pag.has_more === true) {
          pag.has_more = false;
        }
      }
    }
    return null;
  };

  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  for (const [k, v] of Object.entries(state as Record<string, unknown>)) {
    const err = walk(v, `/state/${k}`);
    if (err) return err;
  }
  return null;
}

export function validateManifestState(state: unknown): ValidationFailure | null {
  const base = validateStateRoot(state);
  if (base) return base;
  return extraStateChecks(state);
}
