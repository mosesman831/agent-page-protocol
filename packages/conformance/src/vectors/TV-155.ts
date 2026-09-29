import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv155 } from './runs/index.js';

export const tv155Vector: TestVector = { meta: metaFor(155), run: runTv155 };
