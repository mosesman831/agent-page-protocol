import type { PaymentConfig } from './adapter.js';
import { providerRefOf, sessionIdOf, type SeamStatus } from './machine.js';
import type { OrderValue } from '../protocol.js';

export interface MirrorRow {
  id: string;
  payment_status: SeamStatus;
  order_status: string;
  session_id: string | null;
  provider_ref: string | null;
  currency: string | null;
  total: number | null;
  updated_at: string;
}

export function mirrorRow(order: OrderValue, paymentStatus: SeamStatus): MirrorRow {
  return {
    id: order.id,
    payment_status: paymentStatus,
    order_status: order.status,
    session_id: sessionIdOf(order),
    provider_ref: providerRefOf(order),
    currency: order.currency ?? null,
    total: order.total ?? null,
    updated_at: order.updated_at ?? new Date().toISOString(),
  };
}

/** Skip entirely when URL or service key is unset. Never throws. */
export async function mirrorOrder(config: PaymentConfig, row: MirrorRow): Promise<void> {
  if (!config.mirrorEnabled || !config.supabaseUrl || !config.supabaseKey) return;
  const url = `${config.supabaseUrl}/rest/v1/${config.supabaseTable}?on_conflict=id`;
  try {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${config.supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (response.status < 200 || response.status >= 300) {
      const text = await response.text();
      console.error(`payment mirror upsert failed: ${response.status} ${text.slice(0, 500)}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`payment mirror upsert failed: ${message.slice(0, 500)}`);
  }
}
