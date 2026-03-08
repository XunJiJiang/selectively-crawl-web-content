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

/** 退出信号发生次数 */
let sigintIsTriggered = 0;

/*
 * 关于这里为什么要在第三次 SIGINT 信号时才强制退出:
 * 1. 第一次 SIGINT 信号: 触发正常的退出流程, 调用插件的 onUnload 方法, 进行资源清理等操作.
 * 2. 第二次 SIGINT 信号: 由于未知问题，如果第一次 SIGINT 信号是由 ctrl+c 触发的
 *    若30ms内没有完成退出流程, 则会自动再次触发 SIGINT 信号, 这个 SIGINT 信号不是用户按下 ctrl+c 触发的
 *    这时不应该再次执行退出流程, 以免造成重复调用插件的 onUnload 方法等问题
 *    也不应该直接强制退出, 因为可能第一次 SIGINT 信号触发的退出流程还没有完成
 * 3. 第三次 SIGINT 信号: 此时的 SIGINT 信号一定是用户再次按下 ctrl+c 触发的, 这时才应该强制退出, 不执行退出处理器, 直接退出程序
 *
 * 关于为什么会有第二次 SIGINT 信号被自动触发的问题:
 *    原因未知. 无法最简复现.
 */

// 监听退出信号
process.on('SIGINT', async () => {
  sigintIsTriggered++;
  if (sigintIsTriggered > 2) {
    // 立即退出, 不执行退出处理器
    console.warn('强制退出');
    process.exit(0);
  }
  if (sigintIsTriggered > 1) {
    return;
  }

  for (const plugin of plugins) {
    // TODO: 当实现重启后, 调用时需要告知插件本次关闭为重启
    if (plugin.handler && typeof plugin.handler.onUnload === 'function') {
      const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));
      await plugin.handler.onUnload(log);
    }
  }

  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务停止`);
  process.exit(0);
});
