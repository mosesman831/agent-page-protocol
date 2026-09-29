import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv65 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv65Vector: TestVector = { meta: metaFor(65), run: runTv65 };
attachStandalone(tv65Vector);
