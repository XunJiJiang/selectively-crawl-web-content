import { defineConfig, loadEnv } from 'vite';
import monkey from 'vite-plugin-monkey';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [
      monkey({
        entry: 'src/main.ts',
        userscript: {
          name: 'selectively crawl web content',
          namespace: 'XunJi',
          version: require('./package.json').version,
          author: 'XunJi & XunJiJiang',
          description: 'A user script to selectively crawl web content and save it to a local server.',
          match: ['*://*/*'],
          grant: ['unsafeWindow'],
        },
      }),
    ],
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
