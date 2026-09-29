import type { TestVector } from './types.js';
import { metaFor } from './registry.js';
import { runTv106 } from './runs/v11.js';
import { attachStandalone } from './standalone.js';

export const tv106Vector: TestVector = { meta: metaFor(106), run: runTv106 };
attachStandalone(tv106Vector);
