import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv130 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv130Vector: TestVector = { meta: metaFor(130), run: runTv130 };
attachStandalone(tv130Vector);
