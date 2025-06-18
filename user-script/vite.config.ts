import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import monkey from 'vite-plugin-monkey';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  return {
    plugins: [
      react(),
      monkey({
        entry: 'src/main.tsx',
        userscript: {
          name: 'selectively crawl web content',
          namespace: 'XunJi',
          version: '1.0.1',
          author: 'XunJi & XunJiJiang',
          description: 'A user script to selectively crawl web content and save it to a local server.',
          match: ['*://*/*'],
          grant: ['unsafeWindow'],
        },
      }),
    ],
    define: {
      'import.meta.env.PORT': JSON.stringify(env.PORT),
    },
    build: {
      outDir: '../dist',
      minify: false,
      emptyOutDir: true,
    },
  };
});
