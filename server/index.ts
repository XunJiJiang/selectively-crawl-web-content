import path from 'path';
import dotenv from 'dotenv';
import { listenProcessStdin, registerDefaultCommands } from './command/index.ts';
import { listen } from './router/index.ts';
import { loadPlugins, plugins } from './plugin/load.ts';
import { createLogger } from './utils/log.ts';

dotenv.config();

const __dirname = process.cwd();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;

// 系统日志实例
const serverLogger = createLogger('server', path.relative(process.cwd(), __dirname));

// 启动时加载插件
loadPlugins();

// 注册系统命令
registerDefaultCommands(serverLogger);

// 启动服务器
listen(PORT, () => {
  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务启动`);
});

// 监听命令行输入
listenProcessStdin(serverLogger);

// 监听退出信号
process.on('SIGINT', () => {
  for (const plugin of plugins) {
    if (plugin.handler && typeof plugin.handler.onUnload === 'function') {
      const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));
      plugin.handler.onUnload(log);
    }
  }

  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务停止`);
  process.exit(0);
});
