import { defineConfig, loadEnv } from 'vite';
import { join, resolve } from 'node:path';
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
    build: {
      lib: {
        entry: resolve(import.meta.dirname, 'lib/index.ts'),
        name: 'webutils',
        format: ['iife'],
        // 将添加适当的扩展名后缀
        fileName: () => `web-utils.iife.${new Date().getTime().toString(36)}.js`,
      },
      rolldownOptions: {
        output: {
          name: 'webutils',
        },
      },
      outDir: join(__dirname, '..', 'server', 'public', 'lib'),
      emptyOutDir: true,
    },
    test: {
      environment: 'jsdom',
    },
  };
});
