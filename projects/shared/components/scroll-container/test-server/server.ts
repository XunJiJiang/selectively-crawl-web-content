import { parseArgs } from 'node:util';
import path from 'node:path';
import { createServer, searchForWorkspaceRoot } from 'vite';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '4399' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (values.help) {
  console.log(
    '滚动容器测试页：node projects/shared/components/scroll-container/test-server/server.ts [--port 4399]',
  );
} else {
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port 必须是 1–65535 之间的整数');
  }
  const root = import.meta.dirname;
  const workspace = searchForWorkspaceRoot(root);
  const server = await createServer({
    configFile: false,
    root,
    cacheDir: path.join(workspace, 'node_modules/.vite-scroll-container-demo'),
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      fs: { allow: [workspace] },
    },
  });
  let closing = false;
  const close = () => {
    if (closing) {
      return;
    }
    closing = true;
    void server.close().then(() => process.exit(0));
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await server.listen();
  console.log(`\n滚动容器测试页：http://127.0.0.1:${port}/\n按 Ctrl+C 停止。\n`);
}
