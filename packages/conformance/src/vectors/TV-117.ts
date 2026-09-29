import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv117 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv117Vector: TestVector = { meta: metaFor(117), run: runTv117 };
attachStandalone(tv117Vector);
