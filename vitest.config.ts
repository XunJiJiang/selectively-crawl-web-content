import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['projects/server', 'projects/user-script', 'projects/web'],
  },
});
