import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv72 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv72Vector: TestVector = { meta: metaFor(72), run: runTv72 };
attachStandalone(tv72Vector);
