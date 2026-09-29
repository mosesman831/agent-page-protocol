import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  rmSync,
  chmodSync,
  writeFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import type { Hold, HoldFile, HoldGate, HoldKind, GateKind } from './types.js';
import type { SessionStore } from './session-store.js';
import { SessionStoreError } from './session-store.js';

const GATE_ORDER: GateKind[] = ['challenge', 'hold', 'consent', 'confirmation', 'delegate', 'auth'];

export function holdKindToGateKind(kind: HoldKind): GateKind {
  if (kind === 'mfa' || kind === 'otp') return 'challenge';
  if (kind === 'human_verification') return 'hold';
  if (kind === 'confirmation') return 'confirmation';
  if (kind === 'consent') return 'consent';
  if (kind === 'delegate') return 'delegate';
  if (kind === 'auth') return 'auth';
  return 'confirmation';
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function encodeRawBody(rawBody: string): { raw_body_b64: string; body_sha256: string } {
  const buf = Buffer.from(rawBody, 'utf8');
  return {
    raw_body_b64: buf.toString('base64'),
    body_sha256: sha256Hex(buf),
  };
}

export function decodeRawBody(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function publicHoldFromFile(file: HoldFile): Hold {
  return {
    kind: file.kind,
    preflight: false,
    action: file.action,
    page_url: file.page_url,
    page_version: file.page_version,
    level: file.level,
    side_effect: file.side_effect,
    title: file.title ?? null,
    body: file.body ?? null,
    amount: file.amount ?? null,
    challenge: file.challenge,
    expires_at: file.expires_at,
    pii_params: file.pii_params ?? [],
    delegate: file.delegate ?? null,
    origin: file.origin,
    resume_hint: resumeHintFor(file.kind),
  };
}

export function resumeHintFor(kind: HoldKind): string {
  if (kind === 'confirmation' || kind === 'human_verification' || kind === 'delegate') {
    return 'agent-page confirm --approve';
  }
  if (kind === 'otp') return 'agent-page challenge submit --kind otp --value <code>';
  if (kind === 'mfa') return 'agent-page challenge submit --kind mfa';
  if (kind === 'consent') return 'agent-page act grant_consent';
  if (kind === 'auth') return 'agent-page open <login-url>';
  return 'agent-page confirm --approve';
}

export class HoldStore {
  constructor(private readonly store: SessionStore) {}

  path(sessionId: string): string {
    return this.store.holdPath(sessionId);
  }

  load(sessionId: string): HoldFile | null {
    const path = this.path(sessionId);
    if (!existsSync(path)) return null;
    try {
      const mode = statSync(path).mode & 0o777;
      if (mode & 0o077 && process.env.AGENT_PAGE_ALLOW_INSECURE_HOME !== '1') {
        throw new SessionStoreError(
          'app.err.tool.session_readonly',
          `Insecure hold file mode: ${path}`,
        );
      }
      return JSON.parse(readFileSync(path, 'utf8')) as HoldFile;
    } catch (e) {
      if (e instanceof SessionStoreError) throw e;
      return null;
    }
  }

  delete(sessionId: string): void {
    try {
      rmSync(this.path(sessionId), { force: true });
    } catch {
      /* ignore */
    }
  }

  /**
   * Persist or append a gate (MF-10). Same body_sha256 appends; different body replaces
   * only when treated as a new hold for that action body.
   */
  persist(
    sessionId: string,
    input: {
      kind: Exclude<HoldKind, 'unknown'>;
      action: string;
      page_url: string;
      page_version: string;
      post_url: string;
      challenge: string | null;
      challenge_param?: string | null;
      idempotency_key: string | null;
      if_match_version: string | null;
      raw_body: string;
      level?: Hold['level'];
      side_effect?: string;
      amount?: Hold['amount'];
      title?: string | null;
      body?: string | null;
      origin?: string;
      pii_params?: string[];
      expires_at?: string;
    },
  ): HoldFile {
    const { raw_body_b64, body_sha256 } = encodeRawBody(input.raw_body);
    const now = new Date().toISOString();
    const expires_at = input.expires_at ?? new Date(Date.now() + 300_000).toISOString();
    const gateKind = holdKindToGateKind(input.kind);
    const gate: HoldGate = {
      kind: gateKind,
      status: 'pending',
      at: now,
      challenge: input.challenge,
      hold_token: null,
      grant: null,
    };

    const existing = this.load(sessionId);
    let file: HoldFile;

    if (existing && existing.body_sha256 === body_sha256) {
      // Append gate; keep earliest-first order
      const gates = [...existing.gates];
      const already = gates.find(
        (g) => g.kind === gateKind && g.status === 'pending' && g.challenge === input.challenge,
      );
      if (!already) {
        gates.push(gate);
        gates.sort((a, b) => GATE_ORDER.indexOf(a.kind) - GATE_ORDER.indexOf(b.kind));
      }
      file = {
        ...existing,
        kind: input.kind,
        challenge: input.challenge ?? existing.challenge,
        challenge_param: input.challenge_param ?? existing.challenge_param ?? null,
        level: input.level ?? existing.level,
        side_effect: input.side_effect ?? existing.side_effect,
        amount: input.amount ?? existing.amount,
        title: input.title ?? existing.title,
        body: input.body ?? existing.body,
        expires_at,
        gates,
      };
    } else {
      file = {
        schema: 'agent-page.hold/1.0',
        kind: input.kind,
        action: input.action,
        page_url: input.page_url,
        page_version: input.page_version,
        post_url: input.post_url,
        challenge: input.challenge,
        challenge_param: input.challenge_param ?? null,
        idempotency_key: input.idempotency_key,
        if_match_version: input.if_match_version,
        raw_body_b64,
        body_sha256,
        level: input.level,
        side_effect: input.side_effect,
        amount: input.amount ?? null,
        created_at: now,
        expires_at,
        gates: [gate],
        title: input.title ?? null,
        body: input.body ?? null,
        origin: input.origin,
        pii_params: input.pii_params ?? [],
      };
    }

    this.write(sessionId, file);
    return file;
  }

  write(sessionId: string, file: HoldFile): void {
    this.store.ensureHome();
    const path = this.path(sessionId);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n', {
      encoding: 'utf8',
      mode: 0o600,
    });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
    chmodSync(path, 0o600);
  }

  /** Earliest uncleared gate (MF-10). */
  earliestPending(file: HoldFile): HoldGate | null {
    const pending = file.gates.filter((g) => g.status === 'pending');
    if (!pending.length) return null;
    pending.sort((a, b) => GATE_ORDER.indexOf(a.kind) - GATE_ORDER.indexOf(b.kind));
    return pending[0] ?? null;
  }

  clearEarliest(sessionId: string, expectedKinds?: GateKind[]): HoldFile | null {
    const file = this.load(sessionId);
    if (!file) return null;
    const earliest = this.earliestPending(file);
    if (!earliest) {
      this.delete(sessionId);
      return null;
    }
    if (expectedKinds && !expectedKinds.includes(earliest.kind)) {
      return file;
    }
    earliest.status = 'cleared';
    const still = file.gates.some((g) => g.status === 'pending');
    if (!still) {
      this.delete(sessionId);
      return null;
    }
    this.write(sessionId, file);
    return file;
  }

  isExpired(file: HoldFile): boolean {
    return Date.parse(file.expires_at) < Date.now() - 60_000;
  }
}
