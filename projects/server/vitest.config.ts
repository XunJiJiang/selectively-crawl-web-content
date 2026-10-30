import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      'scwc:deps': fileURLToPath(new URL('./plugin/sdk/dependencies.ts', import.meta.url)),
      'scwc:runtime': fileURLToPath(new URL('./plugin/sdk/runtime.ts', import.meta.url)),
      'scwc:shared/backend': fileURLToPath(new URL('../shared/backend.ts', import.meta.url)),
    },
  },
  test: {},
});
