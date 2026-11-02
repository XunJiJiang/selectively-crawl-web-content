import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  build: { outDir: '../../dist/browser-extension/chromium', emptyOutDir: true },
  test: {
    name: 'browser-extension',
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
