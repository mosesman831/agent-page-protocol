import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv86 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv86Vector: TestVector = { meta: metaFor(86), run: runTv86 };
attachStandalone(tv86Vector);
