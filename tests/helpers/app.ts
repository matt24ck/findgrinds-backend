import { createApp } from '../../src/app';

/** One Express instance per test file (module registry is per file in Jest). */
export const app = createApp();
