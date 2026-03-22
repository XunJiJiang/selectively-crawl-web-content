import path from 'path';
import dotenv from 'dotenv';
import { listenProcessStdin, registerDefaultCommands } from './command/index.ts';
import { listen } from './router/index.ts';
import { initCacheErrorHandler, loadPlugins, plugins } from './plugin/load.ts';
import { createLogger } from './utils/log.ts';

dotenv.config();

const __dirname = process.cwd();

const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;

// 系统日志实例
const serverLogger = createLogger('server', path.relative(process.cwd(), __dirname));

// 初始化缓存错误处理
initCacheErrorHandler(serverLogger);

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

/*
 * 当使用 npm run start 或 bun run start 启动时, 存在问题:
 *   当用户按下 ctrl+c 时, 会触发两次 SIGINT 信号
 * 直接使用 tsx 或 bun 运行时, 则不会有第二次 SIGINT 信号被自动触发的问题, 可以正常在第一次 SIGINT 信号时退出.
 * 可能因为 bun、npm、yarn 等间接启动方式会通过 npm 的子进程机制（spawn）启动脚本,
 * npm（或 bun）作为父进程，收到 ctrl+c 后，会向所有子进程发送 SIGINT，但有时会因为进程管理或事件冒泡机制，导致 SIGINT 被触发两次。
 */

/**
 * 注意: 下面的解决办法可能并不属于官方行为, 可能在未来的版本中会被修改
 * 确认生效版本: bun v1.3.6; node v22.16.0 - v25.8.0
 * 现在的解决办法:
 * 1. 实际处理退出逻辑的 SIGINT 监听器使用 process.once 来确保只执行一次
 * 2. 此时用户按下 ctrl+c 后, 仍然会触发两次 SIGINT 信号, 导致立刻退出并输出 'error: script "start" exited with code 130'
 *    通过添加一个空的 SIGINT 监听器可以避免多次触发导致的立刻退出, 因为没有立刻退出, 也不会输出 'error: script "start" exited with code 130'
 * 3. 但此时会报 'Error: read EIO' 错误, 而且这个错误不会正常显示在控制台, 而是按 'up' 键尝试输入上次的命令时才会显示
 *    例如, 上次命令 'bun start', 在结束后不会显示错误, 但当按 'up' 键时会显示下面内容
 *    可以看到上次实际上的命令 'bun start' 被接在了错误信息的后面
 *    这并不会影响正常使用, 但看起来不太好
 * 4. 通过捕获 stdin 的 error 事件, 可以捕获到这个错误, 并且可以判断如果错误码是 EIO 就忽略掉, 这样就不会在按 'up' 键时显示这个错误了
 *```bash
 *❯ node:events:486
 *      throw er; // Unhandled 'error' event
 *      ^
 *
 *Error: read EIO
 *    at TTY.onStreamRead (node:internal/stream_base_commons:216:20)
 *Emitted 'error' event on ReadStream instance at:
 *    at emitErrorNT (node:internal/streams/destroy:170:8)
 *    at emitErrorCloseNT (node:internal/streams/destroy:129:3)
 *    at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
 *  errno: -5,
 *  code: 'EIO',
 *  syscall: 'read'
 *}
 *
 *Node.js v25.8.0
 *bun start
 *```
 */

// 监听退出信号
process.once('SIGINT', async () => {
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

/** SIGINT 触发次数 */
let sigintCount = 0;

// 监听 SIGINT 信号, 实现再次按下 ctrl+c 时强制退出
process.on('SIGINT', () => {
  sigintCount++;
});

process.stdin.on('error', err => {
  if (sigintCount > 0 && 'code' in err && err.code === 'EIO') {
    // 这是在某些环境（如 Windows）中按下 Ctrl+C 时 stdin 关闭导致的错误，可以安全忽略
    return;
  }

  console.error(err);
});
