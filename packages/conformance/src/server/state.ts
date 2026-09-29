/**
 * Mutable conformance server state.
 */

import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import {
  MemoryConfirmationStore,
  MemoryIdempotencyStore,
  type PageManifest,
} from '@agent-page/server';
import { seedPages } from './fixtures.js';

export interface AsyncJobRecord {
  status: 'pending' | 'running' | 'completed' | 'failed';
  pollIntervalMs: number;
  manifest: PageManifest;
  terminal: 'succeeded' | 'failed';
}

export interface V11Session {
  id: string;
  email: string;
  status: 'anonymous' | 'pending_mfa' | 'authenticated' | 'expired' | 'locked';
  access: string;
  refresh: string;
  family: string;
  resume: string;
  createdAt: number;
}

export interface V11Challenge {
  id: string;
  kind: 'otp' | 'totp' | 'backup_code' | 'webauthn' | 'magic_link';
  /** Param name carrying the code on continuation (default 'otp'). */
  param?: string;
  email: string;
  otp: string;
  attemptsRemaining: number;
  maxAttempts: number;
  expiresAt: number;
  spent: boolean;
  sessionId?: string;
}

export interface V11Hold {
  id: string;
  status: 'pending' | 'cleared' | 'expired' | 'failed';
  expiresAt: number;
  token?: string;
  tokenUsed: boolean;
  verifyPath: string;
  widgetUrl: string;
}

export interface V11IdemRecord {
  key: string;
  action: string;
  path: string;
  originalJson: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  challengeId?: string;
  continued: boolean;
  terminal: boolean;
}

export interface V11EventRecord {
  id: number;
  type: string;
  version?: string;
  pageUrl: string;
  data: Record<string, unknown>;
}

export interface V11SseClient {
  res: Response;
  lastId: number;
  pageUrl?: string;
}

export interface V11Runtime {
  loginFails: Map<string, number>;
  lockedUntil: Map<string, number>;
  sessions: Map<string, V11Session>;
  accessToSession: Map<string, string>;
  refreshToSession: Map<string, string>;
  resumeToSession: Map<string, string>;
  spentRefresh: Map<string, string>;
  revokedFamilies: Set<string>;
  challenges: Map<string, V11Challenge>;
  holds: Map<string, V11Hold>;
  holdIssued: number;
  pendingHoldId: string | null;
  oauthCodes: Map<string, { spent: boolean; state: string }>;
  consentVersion: number;
  consentGrants: Record<string, boolean>;
  order: { id: string; status: string; total: number; scale: number; currency: string };
  liveVersion: string;
  liveN: number;
  fileSlots: Map<string, { sha256: string; expired: boolean }>;
  idem: Map<string, V11IdemRecord>;
  events: V11EventRecord[];
  eventSeq: number;
  sseClients: Set<V11SseClient>;
  eventBus: EventEmitter;
  sessionEpoch: number;
  magicComplete: boolean;
  booking: {
    holdCleared: boolean;
    consentGranted: boolean;
    confirmed: boolean;
    confirmToken?: string;
  };
}

export interface ConformanceState {
  pages: Map<string, PageManifest>;
  validTokens: Set<string>;
  refreshMap: Map<string, string | null>;
  rateHits: Map<string, { count: number; windowStart: number }>;
  idempotency: MemoryIdempotencyStore;
  confirmation: MemoryConfirmationStore;
  inflightIdempotency: Map<string, boolean>;
  asyncJobs: Map<string, AsyncJobRecord>;
  navigateMismatch: boolean;
  /** Per-path GET counts for fixtures whose manifest changes on revalidation (TV-56). */
  pageGets: Map<string, number>;
  v11: V11Runtime;
  reset(port: number): void;
}

export function createV11Runtime(): V11Runtime {
  return {
    loginFails: new Map(),
    lockedUntil: new Map(),
    sessions: new Map(),
    accessToSession: new Map(),
    refreshToSession: new Map(),
    resumeToSession: new Map(),
    spentRefresh: new Map(),
    revokedFamilies: new Set(),
    challenges: new Map(),
    holds: new Map(),
    holdIssued: 0,
    pendingHoldId: null,
    oauthCodes: new Map([['splendid', { spent: false, state: 'abc' }]]),
    consentVersion: 1,
    consentGrants: { necessary: true, analytics: false, marketing: false },
    order: { id: 'ord_1', status: 'draft', total: 4200, scale: 2, currency: 'GBP' },
    liveVersion: 'v1',
    liveN: 0,
    fileSlots: new Map([
      ['file_fresh', { sha256: 'abc123def456', expired: false }],
      ['file_expired', { sha256: 'deadbeef', expired: true }],
    ]),
    idem: new Map(),
    events: [],
    eventSeq: 0,
    sseClients: new Set(),
    eventBus: new EventEmitter(),
    sessionEpoch: 0,
    magicComplete: false,
    booking: { holdCleared: false, consentGranted: false, confirmed: false },
  };
}

export function createState(port: number): ConformanceState {
  const state: ConformanceState = {
    pages: seedPages(port),
    validTokens: new Set(['access_valid']),
    refreshMap: new Map([
      ['refresh_ok', 'access_after_refresh'],
      ['refresh_fail', null],
    ]),
    rateHits: new Map(),
    idempotency: new MemoryIdempotencyStore(),
    confirmation: new MemoryConfirmationStore(),
    inflightIdempotency: new Map(),
    asyncJobs: new Map(),
    navigateMismatch: false,
    pageGets: new Map(),
    v11: createV11Runtime(),
    reset(nextPort) {
      this.idempotency.clear();
      this.confirmation.clear();
      this.rateHits.clear();
      this.inflightIdempotency.clear();
      this.asyncJobs.clear();
      this.navigateMismatch = false;
      this.pageGets.clear();
      this.validTokens = new Set(['access_valid']);
      this.refreshMap = new Map([
        ['refresh_ok', 'access_after_refresh'],
        ['refresh_fail', null],
      ]);
      this.pages = seedPages(nextPort);
      for (const c of this.v11.sseClients) {
        try {
          c.res.end();
        } catch {
          /* ignore */
        }
      }
      this.v11 = createV11Runtime();
    },
  };
  return state;
}
