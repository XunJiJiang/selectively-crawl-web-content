import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    name: 'shared',
    environment: 'jsdom',
    include: ['**/*.test.ts'],
  },
});
