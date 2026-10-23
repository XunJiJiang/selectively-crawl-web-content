import { defineConfig, loadEnv } from 'vite';
import path from 'node:path';
import { parseCorePort } from './scripts/dev-options.ts';

const __dirname = import.meta.dirname;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../..'), '');
  const core = new URL(env.HOST ?? 'http://localhost');
  core.port = env.PORT ?? '3200';
  let target = env.SCWC_CORE_URL ?? core.origin;
  const corePort = env.SCWC_WEB_CORE_PORT;
  if (corePort !== undefined) {
    const override = new URL(target);
    override.port = parseCorePort(corePort);
    target = override.href;
  }
  return {
    plugins: [],
    define: {
      'import.meta.env.HOST': JSON.stringify(env.HOST),
      'import.meta.env.PORT': JSON.stringify(corePort ?? env.PORT),
    },
    base: '/web/',
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
      strictPort: true,
      hmr: { path: '__vite_hmr' },
      // 保留页面 Host / Origin，让核心的来源校验、页面授权与 iframe 保持同源。
      proxy: {
        '/web/local-config': {
          target,
          changeOrigin: false,
          bypass(req) {
            const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '');
            if (peer !== '::1' && !/^127\./.test(peer ?? '')) {
              return false;
            }
          },
        },
        '/web/api': { target, changeOrigin: false },
        '/web/page': { target, changeOrigin: false },
        '/web/resource': { target, changeOrigin: false },
        '/web/websocket': { target, changeOrigin: false, ws: true },
      },
    },
    test: {
      environment: 'jsdom',
    },
  };
});
