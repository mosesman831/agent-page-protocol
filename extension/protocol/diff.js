/**
 * JSON Patch apply (RFC 6902) + Diff Document client algorithm (§7.6)
 * + incremental DOM binding updates via Map<JSONPointer, Element> (§14.7).
 */

import { deepClone, escapePointerToken, getByPointer, unescapePointerToken } from './parse.js';
import { isAllowedDiffPath, validateDiffDocument, validateManifest } from './validate.js';

function parentPath(pointer) {
  if (!pointer || pointer === '/') return '';
  const idx = pointer.lastIndexOf('/');
  if (idx <= 0) return '';
  return pointer.slice(0, idx);
}

function lastToken(pointer) {
  const idx = pointer.lastIndexOf('/');
  return unescapePointerToken(pointer.slice(idx + 1));
}

function ensureParent(doc, pointer) {
  const parent = getByPointer(doc, parentPath(pointer));
  if (parent == null || typeof parent !== 'object') {
    throw new Error(`Parent missing for path ${pointer}`);
  }
  return parent;
}

function removeAt(doc, pointer) {
  const parent = ensureParent(doc, pointer);
  const key = lastToken(pointer);
  if (Array.isArray(parent)) {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
      throw new Error(`Cannot remove missing index ${pointer}`);
    }
    parent.splice(idx, 1);
  } else {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new Error(`Cannot remove missing path ${pointer}`);
    }
    delete parent[key];
  }
}

function setAt(doc, pointer, value, mode) {
  if (pointer === '') {
    throw new Error('Cannot replace document root via patch in APP');
  }
  const parent = ensureParent(doc, pointer);
  const key = lastToken(pointer);
  if (Array.isArray(parent)) {
    if (key === '-') {
      if (mode !== 'add') throw new Error('`-` only valid for add');
      parent.push(value);
      return;
    }
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`Invalid array index ${pointer}`);
    }
    if (mode === 'add') {
      if (idx > parent.length) throw new Error(`Array index out of range ${pointer}`);
      parent.splice(idx, 0, value);
    } else {
      if (idx >= parent.length) throw new Error(`Cannot replace missing index ${pointer}`);
      parent[idx] = value;
    }
  } else if (mode === 'add') {
    parent[key] = value;
  } else {
    if (!Object.prototype.hasOwnProperty.call(parent, key)) {
      throw new Error(`Cannot replace missing path ${pointer}`);
    }
    parent[key] = value;
  }
}

function getRequired(doc, pointer) {
  const v = getByPointer(doc, pointer);
  if (v === undefined) throw new Error(`Missing path ${pointer}`);
  return v;
}

/**
 * Apply a single RFC 6902 operation to `doc` (mutates).
 */
export function applyOp(doc, op) {
  switch (op.op) {
    case 'test': {
      const actual = getByPointer(doc, op.path);
      if (!deepEqual(actual, op.value)) {
        throw new Error(`test failed at ${op.path}`);
      }
      return;
    }
    case 'remove':
      removeAt(doc, op.path);
      return;
    case 'add':
      setAt(doc, op.path, deepClone(op.value), 'add');
      return;
    case 'replace':
      setAt(doc, op.path, deepClone(op.value), 'replace');
      return;
    case 'move': {
      const val = deepClone(getRequired(doc, op.from));
      removeAt(doc, op.from);
      setAt(doc, op.path, val, 'add');
      return;
    }
    case 'copy': {
      const val = deepClone(getRequired(doc, op.from));
      setAt(doc, op.path, val, 'add');
      return;
    }
    default:
      throw new Error(`Unsupported op ${op.op}`);
  }
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(a[k], b[k]));
}

// URL normalization for equality (§8.1) — same algorithm as
// packages/client/src/navigate.ts normalizeAppUrl; the extension is a
// standalone ES module and cannot import the TS package, so the ~35 lines
// are mirrored here. Keep in sync.
const UNRESERVED = /[A-Za-z0-9\-._~]/;

function normalizePercentEncoding(input) {
  return input.replace(/(%[0-9A-Fa-f]{2})+/g, (seq) => {
    let out = '';
    for (let i = 0; i < seq.length; i += 3) {
      const b = parseInt(seq.slice(i + 1, i + 3), 16);
      const ch = String.fromCharCode(b);
      out += UNRESERVED.test(ch) ? ch : `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    return out;
  });
}

function removeDotSegments(path) {
  const input = path.split('/');
  const output = [];
  for (const seg of input) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (output.length > 0) output.pop();
      continue;
    }
    output.push(seg);
  }
  const joined = '/' + output.join('/');
  if (path.endsWith('/') && joined !== '/') return `${joined}/`;
  return joined === '' ? '/' : joined;
}

export function normalizeAppUrl(url) {
  const u = new URL(url); // throws on unparseable input — callers catch
  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  if (
    (u.protocol === 'https:' && u.port === '443') ||
    (u.protocol === 'http:' && u.port === '80')
  ) {
    u.port = '';
  }
  u.pathname = normalizePercentEncoding(removeDotSegments(u.pathname));
  if (u.search) {
    u.search = u.search === '?' ? '' : normalizePercentEncoding(u.search);
  }
  let href = u.href;
  if (href.endsWith('?')) href = href.slice(0, -1);
  return href;
}

function urlsEqual(a, b) {
  try {
    return normalizeAppUrl(a) === normalizeAppUrl(b);
  } catch {
    return a === b;
  }
}

/**
 * Apply Diff Document to local manifest (§7.6). Atomic — rolls back on failure.
 */
export function applyDiffDocument(manifest, diffDoc) {
  const v = validateDiffDocument(diffDoc);
  if (!v.ok) {
    return { ok: false, code: v.code, message: v.message };
  }
  if (!manifest?.page?.version) {
    return { ok: false, code: 'app.err.diff.stale_base', message: 'No local manifest version' };
  }
  // Base identity triple: the diff must name THIS page — a version match
  // alone lets a diff authored for another page apply here.
  if (manifest.page.id !== diffDoc.base.page_id) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest page.id does not match diff base.page_id',
    };
  }
  if (!urlsEqual(manifest.page.url, diffDoc.base.page_url)) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest page.url does not match diff base.page_url',
    };
  }
  if (manifest.page.version !== diffDoc.base.version) {
    return {
      ok: false,
      code: 'app.err.diff.stale_base',
      message: 'Manifest version does not match diff base.version',
    };
  }

  for (const op of diffDoc.diff) {
    if (!isAllowedDiffPath(op.path, manifest)) {
      return {
        ok: false,
        code: 'app.err.diff.invalid_path',
        message: `Diff path not allowed: ${op.path}`,
      };
    }
  }

  // Atomic apply: mutate a working copy only; adopt result_version after ALL ops validate (C2 / §7.3).
  // Never patch /page/version via ops — isAllowedDiffPath forbids it; version set from result_version only.
  const working = deepClone(manifest);
  try {
    for (const op of diffDoc.diff) {
      if (op.path === '/page/version' || op.path?.startsWith('/page/version/')) {
        return {
          ok: false,
          code: 'app.err.diff.invalid_path',
          message: 'Cannot patch /page/version; use result_version',
        };
      }
      applyOp(working, op);
    }
    working.page.version = diffDoc.result_version;
    const mv = validateManifest(working);
    if (!mv.ok) {
      return { ok: false, code: mv.code, message: mv.message };
    }
    return {
      ok: true,
      manifest: mv.manifest || working,
      navigation_effect: diffDoc.navigation_effect ?? null,
      changedPaths: diffDoc.diff.map((o) => o.path),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Patch apply failed';
    if (msg.toLowerCase().includes('test failed')) {
      return { ok: false, code: 'app.err.diff.test_failed', message: msg };
    }
    return { ok: false, code: 'app.err.diff.apply_failed', message: msg };
  }
}

/**
 * Binding registry: Map<JSONPointer, Element | Element[] | update fn>
 * Used for incremental DOM updates after patching the manifest.
 */
export class BindingRegistry {
  constructor() {
    /** @type {Map<string, Set<function>>} */
    this.listeners = new Map();
  }

  clear() {
    this.listeners.clear();
  }

  /**
   * Register an update callback for a JSON Pointer path.
   * Also matches ancestor/descendant updates.
   */
  bind(pointer, updateFn) {
    if (!this.listeners.has(pointer)) {
      this.listeners.set(pointer, new Set());
    }
    this.listeners.get(pointer).add(updateFn);
    return () => this.listeners.get(pointer)?.delete(updateFn);
  }

  /**
   * Notify all bindings affected by changed paths.
   * `getValue(pointer)` should read from the updated manifest.
   */
  notify(changedPaths, getValue) {
    const notified = new Set();
    for (const path of changedPaths) {
      for (const [pointer, fns] of this.listeners) {
        if (
          path === pointer ||
          path.startsWith(pointer + '/') ||
          pointer.startsWith(path + '/') ||
          pointer === path
        ) {
          for (const fn of fns) {
            if (notified.has(fn)) continue;
            notified.add(fn);
            try {
              fn(getValue(pointer), pointer, path);
            } catch {
              /* ignore binding errors */
            }
          }
        }
      }
    }
  }

  /**
   * Convenience: Map-like register of Element text/content bindings.
   * @returns {Map<string, Element>}
   */
  static createElementMap() {
    return new Map();
  }
}

/**
 * Apply text/content updates to a Map<JSONPointer, Element> for state paths.
 */
export function patchBoundElements(elementMap, changedPaths, manifest, formatFn) {
  const touched = new Set();
  for (const path of changedPaths) {
    for (const [pointer, el] of elementMap) {
      if (path === pointer || path.startsWith(pointer + '/') || pointer.startsWith(path + '/')) {
        if (touched.has(el)) continue;
        touched.add(el);
        const node = getByPointer(manifest, pointer);
        if (typeof formatFn === 'function') {
          el.textContent = formatFn(node, pointer);
        } else if (node == null) {
          el.textContent = '';
        } else if (typeof node === 'object' && 'type' in node) {
          el.textContent = String(node.value ?? '');
        } else {
          el.textContent = String(node);
        }
        el.dataset.appPointer = pointer;
      }
    }
  }
  return touched;
}

/**
 * Build a JSON Pointer under /state from object field segments.
 */
export function pointerJoin(...parts) {
  return (
    '/' +
    parts
      .filter((p) => p !== '' && p != null)
      .map((p) => String(p).replace(/^\//, ''))
      .map((seg) => seg.split('/').filter(Boolean).map(escapePointerToken).join('/'))
      .join('/')
  );
}
