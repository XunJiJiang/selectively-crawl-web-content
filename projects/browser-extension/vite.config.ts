import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  define: { __SCWC_VERSION__: JSON.stringify(require('../../package.json').version) },
  build: { outDir: '../../dist/browser-extension/chromium', emptyOutDir: true },
  test: {
    name: 'browser-extension',
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
