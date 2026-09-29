import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv35 } from './runs/index.js';

export const tv35Vector: TestVector = { meta: metaFor(35), run: runTv35 };
