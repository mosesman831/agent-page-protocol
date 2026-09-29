import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv53 } from './runs/index.js';

export const tv53Vector: TestVector = { meta: metaFor(53), run: runTv53 };
