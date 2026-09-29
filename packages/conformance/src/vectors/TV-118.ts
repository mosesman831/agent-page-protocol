import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv118 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv118Vector: TestVector = { meta: metaFor(118), run: runTv118 };
attachStandalone(tv118Vector);
