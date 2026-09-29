import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv66 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv66Vector: TestVector = { meta: metaFor(66), run: runTv66 };
attachStandalone(tv66Vector);
