/**
 * Presign upload slots (SPEC §11.2).
 *
 * Cross-origin PUT to put_url MUST NOT send APP session cookies (or APP
 * Authorization). The PUT is not an APP action: no APP JSON body, no CSRF.
 */

import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';

export const PRESIGN_DEFAULT_TTL_MS = 600_000;
export const PRESIGN_CROSS_ORIGIN_SEND_COOKIES = false;

export interface UploadSlot {
  fileId: string;
  putUrl: string;
  method: 'PUT' | 'POST';
  headerContentType: string;
  name: string;
  mime: string;
  size: number;
  expiresAt: number;
  expectedSha256?: string;
  consumed: boolean;
}

export interface PresignStore {
  get(fileId: string): Promise<UploadSlot | null>;
  set(slot: UploadSlot): Promise<void>;
}

export class MemoryPresignStore implements PresignStore {
  private readonly map = new Map<string, UploadSlot>();
  async get(fileId: string): Promise<UploadSlot | null> {
    return this.map.get(fileId) ?? null;
  }
  async set(slot: UploadSlot): Promise<void> {
    this.map.set(slot.fileId, slot);
  }
  clear(): void {
    this.map.clear();
  }
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const FILE_NAME_RE = /^[^/\\]+$/;

export function mintFileId(): string {
  return `fil_${randomBytes(12).toString('base64url')}`;
}

export function sha256Hex(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function allocateUploadSlot(
  store: PresignStore,
  opts: {
    name: string;
    mime: string;
    size: number;
    putUrl: string;
    method?: 'PUT' | 'POST';
    ttlMs?: number;
    now?: number;
    expectedSha256?: string;
  },
): Promise<UploadSlot> {
  if (
    typeof opts.name !== 'string' ||
    opts.name.length < 1 ||
    opts.name.length > 255 ||
    !FILE_NAME_RE.test(opts.name)
  ) {
    throw new AppError('app.err.validation.param_file', {
      message: 'Invalid file name',
      path: '/params/name',
    });
  }
  if (typeof opts.size !== 'number' || !Number.isInteger(opts.size) || opts.size < 1) {
    throw new AppError('app.err.validation.param_file', {
      message: 'Invalid file size',
      path: '/params/size',
    });
  }
  const now = opts.now ?? Date.now();
  const slot: UploadSlot = {
    fileId: mintFileId(),
    putUrl: opts.putUrl,
    method: opts.method ?? 'PUT',
    headerContentType: opts.mime,
    name: opts.name,
    mime: opts.mime,
    size: opts.size,
    expiresAt: now + (opts.ttlMs ?? PRESIGN_DEFAULT_TTL_MS),
    expectedSha256: opts.expectedSha256,
    consumed: false,
  };
  await store.set(slot);
  return slot;
}

export interface PresignReceipt {
  file_id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
}

/**
 * Verify a mutate receipt against the allocated slot.
 * Expired => 409 upload_expired. sha256/size/mime/name mismatch => 400 param_file.
 */
export async function verifyUploadReceipt(
  store: PresignStore,
  receipt: PresignReceipt,
  opts: { now?: number } = {},
): Promise<UploadSlot> {
  const now = opts.now ?? Date.now();
  const slot = await store.get(receipt.file_id);
  if (!slot) {
    throw new AppError('app.err.validation.param_file', {
      message: 'Unknown file_id',
      path: '/params/receipt/file_id',
    });
  }
  if (now >= slot.expiresAt) {
    throw new AppError('app.err.action.upload_expired', {
      message: 'Upload slot expired',
      path: '/params/receipt',
    });
  }
  if (slot.consumed) {
    throw new AppError('app.err.validation.param_file', {
      message: 'Upload slot already consumed',
      path: '/params/receipt/file_id',
    });
  }
  if (!SHA256_RE.test(receipt.sha256)) {
    throw new AppError('app.err.validation.param_file', {
      message: 'Invalid sha256',
      path: '/params/receipt/sha256',
    });
  }
  if (slot.expectedSha256 && slot.expectedSha256 !== receipt.sha256) {
    throw new AppError('app.err.validation.param_file', {
      message: 'sha256 mismatch',
      path: '/params/receipt/sha256',
    });
  }
  if (slot.size !== receipt.size) {
    throw new AppError('app.err.validation.param_file', {
      message: 'size mismatch',
      path: '/params/receipt/size',
    });
  }
  if (slot.mime !== receipt.mime) {
    throw new AppError('app.err.validation.param_file', {
      message: 'mime mismatch',
      path: '/params/receipt/mime',
    });
  }
  if (slot.name !== receipt.name) {
    throw new AppError('app.err.validation.param_file', {
      message: 'name mismatch',
      path: '/params/receipt/name',
    });
  }
  slot.consumed = true;
  await store.set(slot);
  return slot;
}

/** Headers allowed on a cross-origin presign PUT: Content-Type only. */
export function presignPutHeaders(slot: UploadSlot): Record<string, string> {
  return { 'Content-Type': slot.headerContentType };
}
