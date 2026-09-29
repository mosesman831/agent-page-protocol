import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv144 } from './runs/index.js';

export const tv144Vector: TestVector = { meta: metaFor(144), run: runTv144 };
