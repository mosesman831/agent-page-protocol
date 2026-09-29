/**
 * Persist/load/delete holds; Mode A complete with EXACT raw bytes.
 * K3 MF-10 gate queue (CLIENT-TOOL-CONTRACT §9.4, SPEC D-10).
 *
 * Gates array is ordered earliest first (challenge -> hold -> consent -> confirmation).
 * APPEND, never overwrite. All gates in one file share body_sha256.
 * Different body_sha256 = separate hold file, never merge.
 * confirm / challenge / grant_consent resolve the EARLIEST uncleared gate.
 * If that gate is not the invoked kind, report pending order; do not auto-skip.
 * One raw body per action. Holds never auto-approve. Mode B uuid-mode rejected locally.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, type AppHttpClient, type PageManifest } from '@agent-page/client';
import { CONFIRMATION_TTL_MS, EXPIRY_SKEW_MS, GATE_PIPELINE_ORDER } from './types.js';
import type { GateKind, Hold, HoldFile, HoldGate, HoldKind, ToolHoldLevel } from './types.js';
import { atomicWrite, SessionStore } from './session-store.js';

export function isUuidModeToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && token.startsWith('uuid-mode:');
}

export function sha256Hex(bytes: Buffer | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function encodeRawBody(raw: string): { raw_body_b64: string; body_sha256: string } {
  const buf = Buffer.from(raw, 'utf8');
  return {
    raw_body_b64: buf.toString('base64'),
    body_sha256: sha256Hex(buf),
  };
}

export function decodeRawBody(b64: string): Buffer {
  return Buffer.from(b64, 'base64');
}

export function decodeRawBodyString(b64: string): string {
  return decodeRawBody(b64).toString('utf8');
}

export function holdKindToGateKind(kind: HoldKind): GateKind {
  switch (kind) {
    case 'mfa':
    case 'otp':
      return 'challenge';
    case 'human_verification':
      return 'hold';
    case 'consent':
      return 'consent';
    case 'confirmation':
      return 'confirmation';
    case 'delegate':
      return 'delegate';
    case 'auth':
      return 'auth';
    default:
      return 'confirmation';
  }
}

export function gateKindToHoldKind(
  kind: GateKind,
  fallback: Exclude<HoldKind, 'unknown'>,
): Exclude<HoldKind, 'unknown'> {
  switch (kind) {
    case 'challenge':
      return fallback === 'mfa' || fallback === 'otp' ? fallback : 'otp';
    case 'hold':
      return 'human_verification';
    case 'consent':
      return 'consent';
    case 'confirmation':
      return 'confirmation';
    case 'delegate':
      return 'delegate';
    case 'auth':
      return 'auth';
    default:
      return fallback;
  }
}

export type InvokedHoldCommand = 'confirm' | 'challenge' | 'grant_consent';

const INVOKED_GATES: Record<InvokedHoldCommand, readonly GateKind[]> = {
  confirm: ['confirmation', 'hold'],
  challenge: ['challenge'],
  grant_consent: ['consent'],
};

export function earliestUncleared(file: HoldFile): HoldGate | undefined {
  return file.gates.find((g) => g.status === 'pending');
}

export function pendingGateOrder(file: HoldFile): GateKind[] {
  return file.gates.filter((g) => g.status === 'pending').map((g) => g.kind);
}

/**
 * Resolve the earliest uncleared gate for an invoked command.
 * Does not auto-skip: mismatch reports pending order.
 */
export function resolveEarliestGate(file: HoldFile, invoked: InvokedHoldCommand): HoldGate {
  const earliest = earliestUncleared(file);
  if (!earliest) {
    throw new AppError('app.err.tool.hold_mismatch', {
      message: 'No pending gate on hold',
      details: { pending: { type: 'array', value: [] } },
    });
  }
  const allowed = INVOKED_GATES[invoked];
  if (!allowed.includes(earliest.kind)) {
    const order = pendingGateOrder(file).join(' -> ');
    throw new AppError('app.err.tool.hold_mismatch', {
      message: `Pending gate order: ${order}. Earliest uncleared is ${earliest.kind}, not ${invoked}.`,
      details: {
        pending: { type: 'string', value: order },
        earliest: { type: 'string', value: earliest.kind },
        invoked: { type: 'string', value: invoked },
      },
    });
  }
  return earliest;
}

function gateRank(kind: GateKind): number {
  const i = GATE_PIPELINE_ORDER.indexOf(kind);
  return i === -1 ? GATE_PIPELINE_ORDER.length + 1 : i;
}

/** APPEND a gate; keep earliest-first order. Never overwrite existing gates. */
export function appendGate(gates: HoldGate[], gate: HoldGate): HoldGate[] {
  const next = [...gates, gate];
  next.sort((a, b) => {
    const d = gateRank(a.kind) - gateRank(b.kind);
    if (d !== 0) return d;
    return Date.parse(a.at) - Date.parse(b.at);
  });
  return next;
}

export function markGateCleared(file: HoldFile, kind: GateKind): HoldFile {
  const earliest = earliestUncleared(file);
  if (!earliest || earliest.kind !== kind) {
    throw new AppError('app.err.tool.hold_mismatch', {
      message: 'Refusing to clear a gate that is not earliest uncleared',
    });
  }
  const gates = file.gates.map((g) => (g === earliest ? { ...g, status: 'cleared' as const } : g));
  const still = gates.find((g) => g.status === 'pending');
  return {
    ...file,
    gates,
    kind: still ? gateKindToHoldKind(still.kind, file.kind) : file.kind,
  };
}

export interface PersistHoldInput {
  sessionId: string;
  kind: Exclude<HoldKind, 'unknown'>;
  action: string;
  page_url: string;
  page_version: string;
  post_url: string;
  rawBody: string;
  challenge?: string | null;
  idempotency_key?: string | null;
  if_match_version?: string | null;
  level?: ToolHoldLevel;
  side_effect?: string;
  amount?: Hold['amount'];
  expires_at?: string;
  title?: string | null;
  body?: string | null;
  origin?: string;
  pii_params?: string[];
  preflight?: boolean;
  verify_url?: string;
  widget_url?: string;
  challenge_param?: string;
  attempts_remaining?: number;
  ttl_ms?: number;
  hold_token?: string | null;
  challenge_kind?: string;
  grant?: string[] | null;
  delegate?: Hold['delegate'];
  now?: Date;
}

function holdExpiresAt(input: PersistHoldInput, now: Date): string {
  if (input.expires_at) return input.expires_at;
  const ttl = input.ttl_ms ?? CONFIRMATION_TTL_MS;
  return new Date(now.getTime() + ttl).toISOString();
}

function newGate(input: PersistHoldInput, now: Date): HoldGate {
  return {
    kind: holdKindToGateKind(input.kind),
    status: 'pending',
    at: now.toISOString(),
    challenge: input.challenge ?? null,
    hold_token: input.hold_token ?? null,
    grant: input.grant ?? null,
  };
}

export class HoldStore {
  constructor(readonly store: SessionStore) {}

  primaryPath(sessionId: string): string {
    return this.store.holdPath(sessionId);
  }

  altPath(sessionId: string, bodySha256: string): string {
    return join(this.store.holdsDir, `${sessionId}.${bodySha256}.json`);
  }

  listFiles(sessionId: string): string[] {
    this.store.ensureHome();
    if (!existsSync(this.store.holdsDir)) return [];
    return readdirSync(this.store.holdsDir)
      .filter((n) => n === `${sessionId}.json` || n.startsWith(`${sessionId}.`))
      .filter((n) => n.endsWith('.json'))
      .map((n) => join(this.store.holdsDir, n));
  }

  load(sessionId: string): HoldFile | null {
    const path = this.primaryPath(sessionId);
    if (!existsSync(path)) return null;
    return this.readPath(path);
  }

  loadByBody(sessionId: string, bodySha256: string): HoldFile | null {
    for (const path of this.listFiles(sessionId)) {
      try {
        const file = this.readPath(path);
        if (file.body_sha256 === bodySha256) return file;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  loadAll(sessionId: string): HoldFile[] {
    const out: HoldFile[] = [];
    for (const path of this.listFiles(sessionId)) {
      try {
        out.push(this.readPath(path));
      } catch {
        /* ignore */
      }
    }
    return out;
  }

  private readPath(path: string): HoldFile {
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as HoldFile;
    } catch {
      throw new AppError('app.err.tool.session_corrupt', {
        message: `Corrupt hold file: ${path}`,
      });
    }
  }

  pathFor(file: HoldFile, sessionId: string): string {
    const primary = this.load(sessionId);
    if (primary && primary.body_sha256 === file.body_sha256) {
      return this.primaryPath(sessionId);
    }
    if (!primary) return this.primaryPath(sessionId);
    return this.altPath(sessionId, file.body_sha256);
  }

  writeFile(sessionId: string, file: HoldFile, dest?: string): void {
    this.store.ensureHome();
    const path = dest ?? this.pathFor(file, sessionId);
    atomicWrite(path, JSON.stringify(file, null, 2) + '\n', 0o600);
  }

  /**
   * Persist a gate. Same body_sha256 APPENDS to the existing file.
   * Different body_sha256 writes a separate file and never merges.
   */
  persist(input: PersistHoldInput): HoldFile {
    if (isUuidModeToken(input.challenge)) {
      throw new AppError('app.err.action.confirmation_invalid', {
        message: 'Agents must not use Mode B uuid-mode confirmation',
      });
    }
    const now = input.now ?? new Date();
    const encoded = encodeRawBody(input.rawBody);
    const gate = newGate(input, now);

    const existingSameBody = this.loadByBody(input.sessionId, encoded.body_sha256);
    if (existingSameBody) {
      const merged: HoldFile = {
        ...existingSameBody,
        challenge: input.challenge ?? existingSameBody.challenge,
        idempotency_key: input.idempotency_key ?? existingSameBody.idempotency_key,
        if_match_version: input.if_match_version ?? existingSameBody.if_match_version,
        expires_at: holdExpiresAt(input, now),
        title: input.title ?? existingSameBody.title,
        body: input.body ?? existingSameBody.body,
        hold_token: input.hold_token ?? existingSameBody.hold_token,
        delegate: input.delegate ?? existingSameBody.delegate,
        verify_url: input.verify_url ?? existingSameBody.verify_url,
        widget_url: input.widget_url ?? existingSameBody.widget_url,
        challenge_param: input.challenge_param ?? existingSameBody.challenge_param,
        attempts_remaining: input.attempts_remaining ?? existingSameBody.attempts_remaining,
        challenge_kind: input.challenge_kind ?? existingSameBody.challenge_kind,
        gates: appendGate(existingSameBody.gates, gate),
      };
      const earliest = earliestUncleared(merged);
      if (earliest) merged.kind = gateKindToHoldKind(earliest.kind, merged.kind);
      this.writeFile(input.sessionId, merged);
      return merged;
    }

    const file: HoldFile = {
      schema: 'agent-page.hold/1.0',
      kind: input.kind,
      action: input.action,
      page_url: input.page_url,
      page_version: input.page_version,
      post_url: input.post_url,
      challenge: input.challenge ?? null,
      idempotency_key: input.idempotency_key ?? null,
      if_match_version: input.if_match_version ?? input.page_version,
      raw_body_b64: encoded.raw_body_b64,
      body_sha256: encoded.body_sha256,
      level: input.level,
      side_effect: input.side_effect,
      amount: input.amount ?? null,
      created_at: now.toISOString(),
      expires_at: holdExpiresAt(input, now),
      gates: [gate],
      title: input.title ?? null,
      body: input.body ?? null,
      origin: input.origin,
      pii_params: input.pii_params,
      preflight: input.preflight,
      verify_url: input.verify_url,
      widget_url: input.widget_url,
      challenge_param: input.challenge_param,
      attempts_remaining: input.attempts_remaining,
      ttl_ms: input.ttl_ms,
      hold_token: input.hold_token ?? null,
      challenge_kind: input.challenge_kind,
      delegate: input.delegate ?? null,
    };

    const primary = this.load(input.sessionId);
    if (!primary) {
      this.writeFile(input.sessionId, file, this.primaryPath(input.sessionId));
    } else if (primary.body_sha256 !== encoded.body_sha256) {
      this.writeFile(input.sessionId, file, this.altPath(input.sessionId, encoded.body_sha256));
    } else {
      this.writeFile(input.sessionId, file, this.primaryPath(input.sessionId));
    }
    return file;
  }

  delete(sessionId: string, bodySha256?: string): void {
    if (bodySha256) {
      const primary = this.load(sessionId);
      if (primary && primary.body_sha256 === bodySha256) {
        rmSync(this.primaryPath(sessionId), { force: true });
        const rest = this.loadAll(sessionId);
        if (rest[0]) {
          this.writeFile(sessionId, rest[0], this.primaryPath(sessionId));
          const alt = this.altPath(sessionId, rest[0].body_sha256);
          if (existsSync(alt)) rmSync(alt, { force: true });
        }
        return;
      }
      rmSync(this.altPath(sessionId, bodySha256), { force: true });
      return;
    }
    this.store.deleteHoldsForSession(sessionId);
  }

  isExpired(file: HoldFile, now = Date.now()): boolean {
    const exp = Date.parse(file.expires_at);
    if (!Number.isFinite(exp)) return false;
    return now > exp + EXPIRY_SKEW_MS;
  }

  requireFresh(file: HoldFile): HoldFile {
    if (this.isExpired(file)) {
      throw new AppError('app.err.action.confirmation_invalid', {
        message: 'Hold expired',
      });
    }
    return file;
  }

  /**
   * Mode A complete: POST the EXACT stored raw bytes. Never re-stringify.
   * extraHeaders carry X-APP-Confirmation / X-APP-Challenge / X-APP-Hold-Token.
   */
  async completeModeA(
    http: AppHttpClient,
    file: HoldFile,
    extra: {
      confirmation?: string;
      extraHeaders?: Record<string, string>;
      rawBodyOverride?: string;
    } = {},
  ): Promise<Awaited<ReturnType<AppHttpClient['postAction']>>> {
    this.requireFresh(file);
    if (isUuidModeToken(extra.confirmation) || isUuidModeToken(file.challenge)) {
      throw new AppError('app.err.action.confirmation_invalid', {
        message: 'Agents must not use Mode B uuid-mode confirmation',
      });
    }
    const rawBytes = extra.rawBodyOverride
      ? Buffer.from(extra.rawBodyOverride, 'utf8')
      : decodeRawBody(file.raw_body_b64);
    if (!extra.rawBodyOverride) {
      const sha = sha256Hex(rawBytes);
      if (sha !== file.body_sha256) {
        throw new AppError('app.err.tool.internal', {
          message: 'Hold body_sha256 mismatch; refusing to POST mutated bytes',
        });
      }
    }
    const rawBody = rawBytes.toString('utf8');
    return http.postAction(file.post_url, null, {
      pageUrl: file.page_url,
      ifMatchVersion: file.if_match_version ?? file.page_version,
      idempotencyKey: file.idempotency_key ?? undefined,
      confirmation: extra.confirmation,
      extraHeaders: extra.extraHeaders,
      rawBody,
    });
  }
}

export function publicHoldFromFile(file: HoldFile): Hold {
  const earliest = earliestUncleared(file);
  const kind = earliest ? gateKindToHoldKind(earliest.kind, file.kind) : file.kind;
  const hint =
    kind === 'confirmation' || kind === 'human_verification'
      ? 'agent-page confirm --approve'
      : kind === 'otp' || kind === 'mfa'
        ? 'agent-page challenge submit --kind otp --value <code>'
        : kind === 'consent'
          ? 'agent-page act grant_consent'
          : null;
  return {
    kind,
    preflight: !!file.preflight,
    action: file.action,
    page_url: file.page_url,
    page_version: file.page_version,
    level: file.level,
    side_effect: file.side_effect,
    title: file.title ?? null,
    body: file.body ?? null,
    amount: file.amount ?? null,
    challenge: earliest?.challenge ?? file.challenge ?? null,
    expires_at: file.expires_at,
    pii_params: file.pii_params ?? [],
    delegate: file.delegate ?? null,
    origin: file.origin,
    resume_hint: hint,
  };
}

export function assertNotUuidMode(token: string | null | undefined): void {
  if (isUuidModeToken(token)) {
    throw new AppError('app.err.action.confirmation_invalid', {
      message: 'Agents must not use Mode B uuid-mode confirmation',
    });
  }
}

export function resumeHintForKind(kind: HoldKind): string | null {
  switch (kind) {
    case 'confirmation':
    case 'human_verification':
      return 'agent-page confirm --approve';
    case 'otp':
      return 'agent-page challenge submit --kind otp --value <code>';
    case 'mfa':
      return 'agent-page challenge submit --kind mfa';
    case 'consent':
      return 'agent-page act grant_consent';
    default:
      return null;
  }
}

export function holdFromChallengeError(
  manifest: PageManifest,
  action: string,
  extra: Partial<Hold> = {},
): Hold {
  return {
    kind: extra.kind ?? 'confirmation',
    preflight: extra.preflight ?? false,
    action,
    page_url: manifest.page.url,
    page_version: manifest.page.version,
    level: extra.level,
    side_effect: extra.side_effect,
    title: extra.title ?? null,
    body: extra.body ?? null,
    amount: extra.amount ?? null,
    challenge: extra.challenge ?? null,
    expires_at: extra.expires_at ?? null,
    pii_params: extra.pii_params ?? [],
    delegate: extra.delegate ?? null,
    origin: extra.origin,
    resume_hint: extra.resume_hint ?? resumeHintForKind(extra.kind ?? 'confirmation'),
  };
}
