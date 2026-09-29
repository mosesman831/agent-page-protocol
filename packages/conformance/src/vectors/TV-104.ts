import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv104 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv104Vector: TestVector = { meta: metaFor(104), run: runTv104 };
attachStandalone(tv104Vector);
