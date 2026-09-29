import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv123 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv123Vector: TestVector = { meta: metaFor(123), run: runTv123 };
attachStandalone(tv123Vector);
