import { defineConfig } from 'vitest/config';
import { testEnv } from './test/support/env.js';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    env: testEnv,
    globalSetup: ['./test/support/global-setup.ts'],
    // Os cenários compartilham banco e Redis.
    fileParallelism: false,
  },
});
