import { defineConfig, loadEnv } from 'vite';
// import { createRequire } from 'node:module';

// const require = createRequire(import.meta.url);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [],
    define: {
      'import.meta.env.HOST': JSON.stringify(env.HOST),
      'import.meta.env.PORT': JSON.stringify(env.PORT),
    },
    build: {
      outDir: '../dist',
      minify: false,
      emptyOutDir: true,
    },
    test: {
      environment: 'jsdom',
    },
  };
});
