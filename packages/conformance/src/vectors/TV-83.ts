import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv83 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv83Vector: TestVector = { meta: metaFor(83), run: runTv83 };
attachStandalone(tv83Vector);
