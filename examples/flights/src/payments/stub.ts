import { createHmac } from 'node:crypto';
import type { CreateSessionResult, PaymentOrderRef, ProviderAdapter } from './adapter.js';

export function stubSessionId(orderId: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(orderId, 'utf8').digest('hex');
  return `cs_stub_${hex.slice(0, 32)}`;
}

export function signWebhook(secret: string, rawBody: Buffer, unixTs: number): string {
  if (!Number.isInteger(unixTs) || unixTs < 0) throw new Error('unixTs required');
  const prefix = Buffer.from(`${unixTs}.`, 'utf8');
  const v1 = createHmac('sha256', secret)
    .update(Buffer.concat([prefix, rawBody]))
    .digest('hex');
  return `t=${unixTs},v1=${v1}`;
}

export function createStubAdapter(secret: string): ProviderAdapter {
  return {
    name: 'stub',
    async createSession(
      order: PaymentOrderRef,
      _returnBaseUrl: string,
    ): Promise<CreateSessionResult> {
      const session_id = stubSessionId(order.id, secret);
      return {
        session_id,
        checkout_url: `https://checkout.stub.test/c/${session_id}`,
      };
    },
  };
}
