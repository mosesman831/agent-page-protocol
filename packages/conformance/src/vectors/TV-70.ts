import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv70 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv70Vector: TestVector = { meta: metaFor(70), run: runTv70 };
attachStandalone(tv70Vector);
