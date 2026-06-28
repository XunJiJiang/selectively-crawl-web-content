import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
// import { createRequire } from 'node:module';

// const require = createRequire(import.meta.url);

const __dirname = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [],
    define: {
      'import.meta.env.HOST': JSON.stringify(env.HOST),
      'import.meta.env.PORT': JSON.stringify(env.PORT),
    },
    base: mode === 'production' ? '/web/' : '/',
    root: path.join(__dirname),
    build: {
      rolldownOptions: {
        input: {
          index: path.join(__dirname, 'index.html'),
        },
      },
      outDir: path.join(__dirname, '..', 'server', 'public', 'web'),
      emptyOutDir: true,
    },
    server: {
      port: 3201,
    },
    test: {
      environment: 'jsdom',
    },
  };
});
