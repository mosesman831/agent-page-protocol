/**
 * index, session RW, locks, GC. 0600 files; home 0700 (CLIENT-TOOL-CONTRACT §9).
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  AppError,
  ManifestCache,
  extractOrigin,
  normalizeAppUrl,
  redactSecrets,
  type CacheEntry,
  type PageManifest,
} from '@agent-page/client';
import { defaultHome } from './config.js';
import {
  DEFAULT_SESSION_TTL_MS,
  LOCK_STALE_MS,
  LOCK_WAIT_MS,
  type IndexFile,
  type SessionFile,
} from './types.js';

const FORBIDDEN_SESSION_KEYS = new Set([
  'authorization',
  'bearer',
  'token',
  'password',
  'cookie',
  'api_key',
  'raw_body',
  'raw_body_b64',
  'confirmation',
  'csrf',
]);

const SESSION_ID_RE = /^ses_[A-Za-z0-9_-]{8,128}$/;

export function generateSessionId(): string {
  return `ses_${randomBytes(16).toString('base64url')}`;
}

export function isSessionId(id: string): boolean {
  return SESSION_ID_RE.test(id);
}

function assertNoSecrets(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_SESSION_KEYS.has(k.toLowerCase())) {
      throw new AppError('app.err.tool.session_corrupt', {
        message: `Forbidden secret key in session: ${path}${k}`,
      });
    }
    if (v && typeof v === 'object') assertNoSecrets(v, `${path}${k}.`);
  }
}

function allowInsecure(): boolean {
  return process.env.AGENT_PAGE_ALLOW_INSECURE_HOME === '1';
}

export function atomicWrite(path: string, data: string, mode: number): void {
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, data, { encoding: 'utf8', mode });
  chmodSync(tmp, mode);
  renameSync(tmp, path);
  try {
    chmodSync(path, mode);
  } catch {
    /* ignore */
  }
}

function assertMode(path: string, worldGroupMask: number, code: string, message: string): void {
  if (allowInsecure()) return;
  try {
    const mode = statSync(path).mode & 0o777;
    if (mode & worldGroupMask) {
      throw new AppError(code, { message });
    }
  } catch (e) {
    if (e instanceof AppError) throw e;
  }
}

export class SessionStore {
  readonly home: string;
  readonly sessionsDir: string;
  readonly holdsDir: string;
  readonly cacheDir: string;
  readonly resumeDir: string;
  readonly cookiesDir: string;
  readonly indexPath: string;
  readonly configPath: string;
  sessionTtlMs: number;
  readonly cache: ManifestCache;

  constructor(home?: string, opts?: { sessionTtlMs?: number; cache?: ManifestCache }) {
    this.home = home ?? defaultHome();
    this.sessionsDir = join(this.home, 'sessions');
    this.holdsDir = join(this.home, 'holds');
    this.cacheDir = join(this.home, 'cache');
    this.resumeDir = join(this.home, 'resume');
    this.cookiesDir = join(this.home, 'cookies');
    this.indexPath = join(this.home, 'index.json');
    this.configPath = join(this.home, 'config.json');
    this.sessionTtlMs = opts?.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
    this.cache = opts?.cache ?? new ManifestCache();
  }

  ensureHome(): void {
    if (!existsSync(this.home)) {
      mkdirSync(this.home, { recursive: true, mode: 0o700 });
      chmodSync(this.home, 0o700);
    } else {
      this.assertHomeMode();
    }
    for (const dir of [
      this.sessionsDir,
      this.holdsDir,
      this.cacheDir,
      this.resumeDir,
      this.cookiesDir,
    ]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
          chmodSync(dir, 0o700);
        } catch {
          /* ignore */
        }
      }
    }
    if (!existsSync(this.indexPath)) {
      atomicWrite(
        this.indexPath,
        JSON.stringify(
          {
            schema: 'agent-page.index/1.0',
            current: null,
            sessions: [],
            home_version: '1.0',
          },
          null,
          2,
        ) + '\n',
        0o600,
      );
    }
  }

  assertHomeMode(): void {
    assertMode(
      this.home,
      0o077,
      'app.err.tool.session_readonly',
      'AGENT_PAGE_HOME mode must be 0700',
    );
  }

  private assertSecureFile(path: string): void {
    assertMode(path, 0o077, 'app.err.tool.session_readonly', `Insecure permissions on ${path}`);
  }

  readIndex(): IndexFile {
    this.ensureHome();
    try {
      return JSON.parse(readFileSync(this.indexPath, 'utf8')) as IndexFile;
    } catch {
      return {
        schema: 'agent-page.index/1.0',
        current: null,
        sessions: [],
        home_version: '1.0',
      };
    }
  }

  writeIndex(index: IndexFile): void {
    if (!existsSync(this.home)) this.ensureHome();
    atomicWrite(this.indexPath, JSON.stringify(index, null, 2) + '\n', 0o600);
  }

  sessionPath(id: string): string {
    return join(this.sessionsDir, `${id}.json`);
  }

  holdPath(id: string): string {
    return join(this.holdsDir, `${id}.json`);
  }

  lockPath(id: string): string {
    return join(this.sessionsDir, `${id}.json.lock`);
  }

  async withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.ensureHome();
    const path = this.lockPath(id);
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const fd = openSync(path, 'wx');
        try {
          writeFileSync(fd, `${process.pid} ${Date.now()}\n`);
        } finally {
          closeSync(fd);
        }
        try {
          chmodSync(path, 0o600);
        } catch {
          /* ignore */
        }
        try {
          return await fn();
        } finally {
          try {
            unlinkSync(path);
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        if (e instanceof AppError) throw e;
        try {
          const st = statSync(path);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            unlinkSync(path);
            continue;
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    throw new AppError('app.err.tool.session_locked', {
      message: `Session locked: ${id}`,
    });
  }

  readSession(id: string): SessionFile {
    const path = this.sessionPath(id);
    if (!existsSync(path)) {
      throw new AppError('app.err.tool.session_missing', {
        message: `Session not found: ${id}`,
      });
    }
    this.assertSecureFile(path);
    let data: SessionFile;
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as SessionFile;
    } catch {
      throw new AppError('app.err.tool.session_corrupt', {
        message: `Corrupt session: ${id}`,
      });
    }
    assertNoSecrets(data);
    if (data.schema !== 'agent-page.session/1.0' || data.id !== id) {
      throw new AppError('app.err.tool.session_corrupt', {
        message: `Corrupt session: ${id}`,
      });
    }
    return data;
  }

  writeSession(session: SessionFile): void {
    assertNoSecrets(session);
    this.ensureHome();
    const now = new Date().toISOString();
    const next: SessionFile = {
      ...session,
      updated_at: now,
      last_used_at: session.last_used_at ?? now,
    };
    atomicWrite(this.sessionPath(next.id), JSON.stringify(next, null, 2) + '\n', 0o600);
    const index = this.readIndex();
    if (!index.sessions.includes(next.id)) {
      index.sessions.push(next.id);
    }
    index.current = next.id;
    this.writeIndex(index);
  }

  createSession(input: {
    origin: string;
    title?: string | null;
    protocol_version?: string;
    accepted_versions?: string[];
    capabilities?: string[];
    authMode?: SessionFile['auth']['mode'];
    envRef?: string | null;
    id?: string;
  }): SessionFile {
    const id = input.id ?? generateSessionId();
    if (!isSessionId(id)) {
      throw new AppError('app.err.tool.usage', { message: `Invalid session id: ${id}` });
    }
    const now = new Date().toISOString();
    const session: SessionFile = {
      schema: 'agent-page.session/1.0',
      id,
      created_at: now,
      updated_at: now,
      last_used_at: now,
      origin: input.origin,
      title: input.title ?? null,
      protocol_version: input.protocol_version ?? '1.0',
      accepted_versions: input.accepted_versions ?? ['1.1', '1.0'],
      capabilities: input.capabilities ?? [],
      auth: {
        mode: input.authMode ?? 'none',
        env_ref: input.envRef ?? null,
        cookie_jar: null,
      },
      resume: { present: false, expires_at: null, header: 'X-APP-Resume' },
      current: null,
      stack: [],
      last_action: null,
      watch: { last_event_id: null, subscribed: false },
      cache_policy: 'public_only',
      flags: { v05_features: false, strict: false },
    };
    this.writeSession(session);
    return session;
  }

  switchCurrent(id: string): SessionFile {
    const session = this.readSession(id);
    const index = this.readIndex();
    index.current = id;
    if (!index.sessions.includes(id)) index.sessions.push(id);
    this.writeIndex(index);
    return session;
  }

  deleteSession(id: string): void {
    try {
      rmSync(this.sessionPath(id), { force: true });
    } catch {
      /* ignore */
    }
    this.deleteHoldsForSession(id);
    try {
      unlinkSync(this.lockPath(id));
    } catch {
      /* ignore */
    }
    const index = this.readIndex();
    index.sessions = index.sessions.filter((s) => s !== id);
    if (index.current === id) {
      index.current = index.sessions.length ? this.mostRecentlyUsed(index.sessions) : null;
    }
    this.writeIndex(index);
  }

  deleteHoldsForSession(id: string): void {
    if (!existsSync(this.holdsDir)) return;
    for (const name of readdirSync(this.holdsDir)) {
      if (name === `${id}.json` || name.startsWith(`${id}.`)) {
        try {
          rmSync(join(this.holdsDir, name), { force: true });
        } catch {
          /* ignore */
        }
      }
    }
  }

  mostRecentlyUsed(ids: string[]): string | null {
    let best: string | null = null;
    let bestTs = 0;
    for (const id of ids) {
      try {
        const s = this.readSession(id);
        const ts = Date.parse(s.last_used_at);
        if (ts >= bestTs) {
          bestTs = ts;
          best = id;
        }
      } catch {
        /* ignore */
      }
    }
    return best;
  }

  currentSessionId(explicit?: string | null): string | null {
    if (explicit) return explicit;
    if (process.env.AGENT_PAGE_SESSION) return process.env.AGENT_PAGE_SESSION;
    return this.readIndex().current;
  }

  listSessions(): SessionFile[] {
    const index = this.readIndex();
    const out: SessionFile[] = [];
    for (const id of index.sessions) {
      try {
        out.push(this.readSession(id));
      } catch {
        /* drop missing */
      }
    }
    return out;
  }

  gc(): string[] {
    const index = this.readIndex();
    const deleted: string[] = [];
    const now = Date.now();
    const liveOrigins = new Set<string>();

    const surviving: string[] = [];
    for (const id of [...index.sessions]) {
      try {
        if (!existsSync(this.sessionPath(id))) {
          deleted.push(id);
          continue;
        }
        const s = this.readSession(id);
        if (now - Date.parse(s.last_used_at) > this.sessionTtlMs) {
          this.deleteSession(id);
          deleted.push(id);
        } else {
          surviving.push(id);
          liveOrigins.add(s.origin);
        }
      } catch {
        deleted.push(id);
      }
    }

    if (existsSync(this.holdsDir)) {
      for (const name of readdirSync(this.holdsDir)) {
        if (!name.endsWith('.json') || name.startsWith('.')) continue;
        try {
          const hold = JSON.parse(readFileSync(join(this.holdsDir, name), 'utf8')) as {
            expires_at?: string;
          };
          if (hold.expires_at && now - Date.parse(hold.expires_at) > 3_600_000) {
            rmSync(join(this.holdsDir, name), { force: true });
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (existsSync(this.cacheDir)) {
      for (const name of readdirSync(this.cacheDir)) {
        if (!name.endsWith('.json')) continue;
        const path = join(this.cacheDir, name);
        try {
          const entry = JSON.parse(readFileSync(path, 'utf8')) as {
            url?: string;
            manifest?: { page?: { url?: string } };
            private?: boolean;
          };
          if (entry.private === true) {
            rmSync(path, { force: true });
            continue;
          }
          const url = entry.url ?? entry.manifest?.page?.url;
          if (!url) continue;
          const origin = extractOrigin(url);
          if (!liveOrigins.has(origin) && surviving.length === 0) {
            rmSync(path, { force: true });
          }
        } catch {
          /* ignore */
        }
      }
    }

    const fresh = this.readIndex();
    fresh.sessions = fresh.sessions.filter((id) => existsSync(this.sessionPath(id)));
    if (fresh.current && !fresh.sessions.includes(fresh.current)) {
      fresh.current = this.mostRecentlyUsed(fresh.sessions);
    }
    this.writeIndex(fresh);
    return deleted;
  }

  resetAll(): void {
    this.ensureHome();
    for (const dir of [
      this.sessionsDir,
      this.holdsDir,
      this.cacheDir,
      this.resumeDir,
      this.cookiesDir,
    ]) {
      if (existsSync(dir)) {
        for (const name of readdirSync(dir)) {
          rmSync(join(dir, name), { force: true, recursive: true });
        }
      }
    }
    this.cache.clear();
    this.writeIndex({
      schema: 'agent-page.index/1.0',
      current: null,
      sessions: [],
      home_version: '1.0',
    });
  }

  cacheKey(url: string): string {
    let normalized = url;
    try {
      normalized = normalizeAppUrl(url);
    } catch {
      /* use raw */
    }
    return createHash('sha256').update(normalized).digest('hex');
  }

  writePublicCache(
    url: string,
    entry: {
      etag?: string | null;
      version: string;
      ttl_ms: number;
      cache_control?: string | null;
      manifest: unknown;
      fetched_at?: number;
    },
  ): void {
    this.ensureHome();
    const path = join(this.cacheDir, `${this.cacheKey(url)}.json`);
    atomicWrite(
      path,
      JSON.stringify(
        {
          schema: 'agent-page.cache/1.0',
          url,
          etag: entry.etag ?? null,
          version: entry.version,
          fetched_at: entry.fetched_at ?? Date.now(),
          ttl_ms: entry.ttl_ms,
          private: false,
          cache_control: entry.cache_control ?? null,
          manifest: entry.manifest,
        },
        null,
        2,
      ) + '\n',
      0o644,
    );
  }

  readPublicCache(url: string): {
    etag: string | null;
    version: string;
    fetched_at: number;
    ttl_ms: number;
    manifest: unknown;
    private?: boolean;
  } | null {
    const path = join(this.cacheDir, `${this.cacheKey(url)}.json`);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        etag: string | null;
        version: string;
        fetched_at: number;
        ttl_ms: number;
        manifest: unknown;
        private?: boolean;
      };
      if (parsed.private === true) return null;
      if (parsed.manifest && typeof parsed.manifest === 'object') {
        parsed.manifest = redactSecrets(parsed.manifest as PageManifest);
      }
      return parsed;
    } catch {
      return null;
    }
  }

  dumpCacheToDisk(): void {
    for (const { url, entry } of this.cache.dumpPublicEntries()) {
      this.writePublicCache(url, {
        etag: entry.etag ?? null,
        version: entry.version,
        ttl_ms: entry.ttlMs,
        cache_control: entry.cacheControl ?? null,
        manifest: redactSecrets(entry.manifest),
        fetched_at: entry.fetchedAt,
      });
    }
  }

  loadCacheFromDisk(): void {
    if (!existsSync(this.cacheDir)) return;
    const entries: Array<{ url: string; entry: CacheEntry }> = [];
    for (const name of readdirSync(this.cacheDir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(this.cacheDir, name), 'utf8')) as {
          url: string;
          etag?: string | null;
          version: string;
          fetched_at: number;
          ttl_ms: number;
          private?: boolean;
          cache_control?: string | null;
          manifest: PageManifest;
        };
        if (parsed.private === true) continue;
        entries.push({
          url: parsed.url,
          entry: {
            manifest: redactSecrets(parsed.manifest),
            etag: parsed.etag ?? undefined,
            version: parsed.version,
            fetchedAt: parsed.fetched_at,
            ttlMs: parsed.ttl_ms,
            private: false,
            cacheControl: parsed.cache_control ?? undefined,
          },
        });
      } catch {
        /* ignore */
      }
    }
    this.cache.loadEntries(entries);
  }

  deleteResume(origin: string): void {
    const path = join(this.resumeDir, `${createHash('sha256').update(origin).digest('hex')}.token`);
    try {
      rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
  }

  fileMode(path: string): number {
    return statSync(path).mode & 0o777;
  }
}
