import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  openSync,
  closeSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { IndexFile, SessionFile, ToolConfig } from './types.js';

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

export function defaultHome(): string {
  return process.env.AGENT_PAGE_HOME?.trim() || join(homedir(), '.agent-page');
}

export function generateSessionId(): string {
  return `ses_${randomBytes(16).toString('base64url')}`;
}

function assertNoSecrets(obj: unknown, path = ''): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_SESSION_KEYS.has(k.toLowerCase())) {
      throw new SessionStoreError(
        'app.err.tool.session_corrupt',
        `Forbidden secret key in session: ${path}${k}`,
      );
    }
    if (v && typeof v === 'object') assertNoSecrets(v, `${path}${k}.`);
  }
}

export class SessionStoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SessionStoreError';
    this.code = code;
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

  constructor(home?: string, opts?: { sessionTtlMs?: number }) {
    this.home = home ?? defaultHome();
    this.sessionsDir = join(this.home, 'sessions');
    this.holdsDir = join(this.home, 'holds');
    this.cacheDir = join(this.home, 'cache');
    this.resumeDir = join(this.home, 'resume');
    this.cookiesDir = join(this.home, 'cookies');
    this.indexPath = join(this.home, 'index.json');
    this.configPath = join(this.home, 'config.json');
    this.sessionTtlMs = opts?.sessionTtlMs ?? 86_400_000;
  }

  ensureHome(): void {
    if (!existsSync(this.home)) {
      mkdirSync(this.home, { recursive: true, mode: 0o700 });
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
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
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
    if (process.env.AGENT_PAGE_ALLOW_INSECURE_HOME === '1') return;
    try {
      const mode = statSync(this.home).mode & 0o777;
      if (mode & 0o077) {
        throw new SessionStoreError(
          'app.err.tool.session_readonly',
          'AGENT_PAGE_HOME mode must be 0700',
        );
      }
    } catch (e) {
      if (e instanceof SessionStoreError) throw e;
    }
  }

  loadConfig(): ToolConfig {
    if (!existsSync(this.configPath)) return {};
    const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Record<string, unknown>;
    const secretNames = [
      'bearer',
      'token',
      'authorization',
      'password',
      'cookie',
      'api_key',
      'apiKey',
      'secret',
      'private_key',
    ];
    for (const k of Object.keys(raw)) {
      if (secretNames.includes(k)) {
        throw new SessionStoreError(
          'app.err.tool.config_secret',
          `Secret key not allowed in config.json: ${k}`,
        );
      }
    }
    return raw as ToolConfig;
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
    this.ensureHome();
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
    const path = this.lockPath(id);
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      let acquired = false;
      try {
        const fd = openSync(path, 'wx');
        closeSync(fd);
        acquired = true;
        try {
          chmodSync(path, 0o600);
        } catch {
          /* best-effort mode */
        }
        return await fn();
      } catch (e) {
        if (acquired) {
          try {
            unlinkSync(path);
          } catch {
            /* ignore */
          }
          throw e;
        }
        try {
          const st = statSync(path);
          if (Date.now() - st.mtimeMs > 30_000) {
            unlinkSync(path);
            continue;
          }
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 50));
      } finally {
        if (acquired) {
          try {
            unlinkSync(path);
          } catch {
            /* ignore */
          }
        }
      }
    }
    throw new SessionStoreError('app.err.tool.session_locked', `Session locked: ${id}`);
  }

  readSession(id: string): SessionFile {
    const path = this.sessionPath(id);
    if (!existsSync(path)) {
      throw new SessionStoreError('app.err.tool.session_missing', `Session not found: ${id}`);
    }
    this.assertSecureFile(path);
    let data: SessionFile;
    try {
      data = JSON.parse(readFileSync(path, 'utf8')) as SessionFile;
    } catch {
      throw new SessionStoreError('app.err.tool.session_corrupt', `Corrupt session: ${id}`);
    }
    assertNoSecrets(data);
    return data;
  }

  writeSession(session: SessionFile): void {
    assertNoSecrets(session);
    this.ensureHome();
    atomicWrite(this.sessionPath(session.id), JSON.stringify(session, null, 2) + '\n', 0o600);
    const index = this.readIndex();
    if (!index.sessions.includes(session.id)) {
      index.sessions.push(session.id);
    }
    index.current = session.id;
    this.writeIndex(index);
  }

  deleteSession(id: string): void {
    try {
      rmSync(this.sessionPath(id), { force: true });
    } catch {
      /* ignore */
    }
    try {
      rmSync(this.holdPath(id), { force: true });
    } catch {
      /* ignore */
    }
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
        }
      } catch {
        deleted.push(id);
      }
    }
    // Expire stale hold files (>1h past expires_at)
    if (existsSync(this.holdsDir)) {
      for (const name of readdirSync(this.holdsDir)) {
        if (!name.endsWith('.json')) continue;
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
    const fresh = this.readIndex();
    fresh.sessions = fresh.sessions.filter((id) => existsSync(this.sessionPath(id)));
    if (fresh.current && !fresh.sessions.includes(fresh.current)) {
      fresh.current = fresh.sessions[0] ?? null;
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
    this.writeIndex({
      schema: 'agent-page.index/1.0',
      current: null,
      sessions: [],
      home_version: '1.0',
    });
  }

  cacheKey(url: string): string {
    return createHash('sha256').update(url).digest('hex');
  }

  writePublicCache(
    url: string,
    entry: {
      etag?: string | null;
      version: string;
      ttl_ms: number;
      cache_control?: string | null;
      manifest: unknown;
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
          fetched_at: Date.now(),
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
  } | null {
    const path = join(this.cacheDir, `${this.cacheKey(url)}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as {
        etag: string | null;
        version: string;
        fetched_at: number;
        ttl_ms: number;
        manifest: unknown;
      };
    } catch {
      return null;
    }
  }

  deleteResume(origin: string): void {
    const path = join(this.resumeDir, `${createHash('sha256').update(origin).digest('hex')}.token`);
    try {
      rmSync(path, { force: true });
    } catch {
      /* ignore */
    }
  }

  private assertSecureFile(path: string): void {
    if (process.env.AGENT_PAGE_ALLOW_INSECURE_HOME === '1') return;
    try {
      const mode = statSync(path).mode & 0o777;
      if (mode & 0o077) {
        throw new SessionStoreError(
          'app.err.tool.session_readonly',
          `Insecure permissions on ${path}`,
        );
      }
    } catch (e) {
      if (e instanceof SessionStoreError) throw e;
    }
  }
}

function atomicWrite(path: string, data: string, mode: number): void {
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
