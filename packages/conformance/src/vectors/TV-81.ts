import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv81 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv81Vector: TestVector = { meta: metaFor(81), run: runTv81 };
attachStandalone(tv81Vector);
