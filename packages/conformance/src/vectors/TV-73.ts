import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv73 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv73Vector: TestVector = { meta: metaFor(73), run: runTv73 };
attachStandalone(tv73Vector);
