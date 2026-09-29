import { createStripeAdapter, PaymentProviderError } from './stripe.js';
import { createStubAdapter } from './stub.js';

export { PaymentProviderError };

export interface PaymentOrderRef {
  id: string;
  currency: string;
  total: number;
  scale: number;
  sku: string;
}

export interface CreateSessionResult {
  session_id: string;
  checkout_url: string;
}

export interface ProviderAdapter {
  readonly name: 'stub' | 'stripe';
  createSession(order: PaymentOrderRef, returnBaseUrl: string): Promise<CreateSessionResult>;
}

export interface PaymentConfig {
  provider: 'stub' | 'stripe';
  pspBaseUrl: string;
  stripeSecretKey: string | undefined;
  /** HMAC key. Defaults to dev-insecure when unset. */
  webhookSecret: string;
  /** True when the operator set a secret other than the dev default. */
  webhookSecretIsLive: boolean;
  supabaseUrl: string | undefined;
  supabaseKey: string | undefined;
  supabaseTable: string;
  mirrorEnabled: boolean;
}

export function loadPaymentConfig(env: NodeJS.ProcessEnv): PaymentConfig {
  const raw = env.PSP_PROVIDER;
  let provider: 'stub' | 'stripe';
  if (raw === undefined || raw === '') provider = 'stub';
  else if (raw === 'stub' || raw === 'stripe') provider = raw;
  else {
    console.error('PSP_PROVIDER must be stub or stripe');
    process.exit(1);
  }

  const pspBaseUrl = (env.PSP_BASE_URL ?? 'https://api.stripe.com').replace(/\/$/, '');
  const secretRaw = env.PAYMENT_WEBHOOK_SECRET;
  const webhookSecret = secretRaw === undefined || secretRaw === '' ? 'dev-insecure' : secretRaw;
  const webhookSecretIsLive = webhookSecret !== 'dev-insecure';

  const urlRaw = env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
  const keyRaw = env.SUPABASE_SERVICE_KEY ?? '';
  const hasUrl = urlRaw !== '';
  const hasKey = keyRaw !== '';
  if (hasUrl !== hasKey) {
    console.warn('SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set; payment mirror is off');
  }

  const supabaseTable = env.SUPABASE_ORDERS_TABLE ?? 'orders';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(supabaseTable)) {
    console.error('SUPABASE_ORDERS_TABLE must match ^[a-z][a-z0-9_]{0,62}$');
    process.exit(1);
  }

  const mirrorEnabled = hasUrl && hasKey;
  return {
    provider,
    pspBaseUrl,
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    webhookSecret,
    webhookSecretIsLive,
    supabaseUrl: mirrorEnabled ? urlRaw : undefined,
    supabaseKey: mirrorEnabled ? keyRaw : undefined,
    supabaseTable,
    mirrorEnabled,
  };
}

export function loadProvider(config: PaymentConfig): ProviderAdapter {
  if (config.provider === 'stripe') {
    return createStripeAdapter({
      secretKey: config.stripeSecretKey,
      baseUrl: config.pspBaseUrl,
    });
  }
  return createStubAdapter(config.webhookSecret);
}
