import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv44 } from './runs/index.js';

export const tv44Vector: TestVector = { meta: metaFor(44), run: runTv44 };
