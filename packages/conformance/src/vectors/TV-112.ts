import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv112 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv112Vector: TestVector = { meta: metaFor(112), run: runTv112 };
attachStandalone(tv112Vector);
