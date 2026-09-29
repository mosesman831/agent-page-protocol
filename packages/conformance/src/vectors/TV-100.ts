import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv100 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv100Vector: TestVector = { meta: metaFor(100), run: runTv100 };
attachStandalone(tv100Vector);
