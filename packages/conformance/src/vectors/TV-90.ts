import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv90 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv90Vector: TestVector = { meta: metaFor(90), run: runTv90 };
attachStandalone(tv90Vector);
