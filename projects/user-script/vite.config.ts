import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import monkey from 'vite-plugin-monkey';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const __dirname = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['HOST', 'PORT']);
  return {
    plugins: [
      monkey({
        entry: 'src/main.ts',
        build: { fileName: 'scwc.user.js' },
        userscript: {
          name: 'selectively crawl web content',
          namespace: 'XunJi',
          version: require('./package.json').version,
          author: 'XunJi & XunJiJiang',
          description:
            'A user script to selectively crawl web content and save it to a local server.',
          match: ['*://*/*'],
          grant: ['unsafeWindow'],
        },
      }),
    ],
    define: {
      'import.meta.env.HOST': JSON.stringify(env.HOST ?? 'http://localhost'),
      'import.meta.env.PORT': JSON.stringify(env.PORT ?? '3200'),
    },
    root: path.join(__dirname),
    build: {
      outDir: path.join(__dirname, '..', '..', 'dist', 'user-script'),
      minify: false,
      emptyOutDir: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: [path.join(__dirname, 'src/test/setup.ts')],
    },
  };
});
