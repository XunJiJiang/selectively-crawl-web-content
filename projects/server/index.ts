import path from 'node:path';
import type { Server } from 'node:http';
import { cancelStdinInput, listenProcessStdin, registerDefaultCommands } from './command/index.ts';
import { createCoreBridge } from './command/ipc.ts';
import { listen } from './router/index.ts';
import {
  configuredPluginDirectory,
  initCacheErrorHandler,
  loadPlugins,
  plugins,
} from './plugin/load.ts';
import { createLogger } from './utils/log.ts';
import cacheController from './utils/cache.ts';
import { HOST, PORT, PORT_SEARCH_RANGE, ACTIVE_PORT, setListeningPort } from './common/env.ts';
import { parsedArgs } from './common/setupParam.ts';
import { serverLogger } from './common/logger.ts';

async function main() {
  let exiting = false;
  let server: Server | undefined;
  let pluginLoading = Promise.resolve();
  const shutdown = async (restart: boolean) => {
    if (exiting) {
      return;
    }
    exiting = true;
    server?.close();
    await pluginLoading.catch(() => undefined);
    for (const plugin of plugins) {
      try {
        await plugin.handler?.onUnload?.(
          createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry)),
          { isRestart: restart },
        );
      } catch (error) {
        plugin.logger.error('插件卸载失败', error);
      }
    }
    if (!restart) {
      await cacheController.clearAll(serverLogger);
    }
    serverLogger.info(restart ? '服务重启' : '服务停止', `${HOST}:${ACTIVE_PORT}`);
    process.exit(0);
  };
  process.on('SIGINT', () => {
    if (parsedArgs.interaction !== 'ipc' && cancelStdinInput()) {
      return;
    }
    void shutdown(false);
  });
  process.once('SIGTERM', () => {
    void shutdown(false);
  });
  const ipc = parsedArgs.interaction === 'ipc' ? createCoreBridge(shutdown) : undefined;
  if (ipc) {
    await ipc.handshake;
  }
  const directory = await configuredPluginDirectory(
    ipc ? () => ipc.confirm('环境中的 SCWC_PLUGIN_DIR 将会被覆盖，是否确认覆盖？') : undefined,
  );
  if (exiting) {
    return;
  }
  initCacheErrorHandler(serverLogger);
  registerDefaultCommands(serverLogger);
  server = await listen(
    PORT,
    (actualPort) => {
      setListeningPort(actualPort);
      if (actualPort !== PORT) {
        serverLogger.info(`起始端口 ${PORT} 被占用，已使用端口 ${actualPort}`);
      }
      serverLogger.info('服务启动', `${HOST}:${actualPort}`);
    },
    PORT_SEARCH_RANGE,
  );
  if (!ipc) {
    listenProcessStdin(serverLogger);
    process.on('message', (signal) => {
      if (signal === 'SIGINT-exit' || signal === 'SIGINT-restart') {
        void shutdown(signal === 'SIGINT-restart');
      }
    });
    process.stdin.on('error', (error) => {
      if (!exiting) {
        serverLogger.error(error);
      }
    });
  }
  pluginLoading = loadPlugins(directory);
  void pluginLoading.catch((error) => serverLogger.error('插件加载失败', error));
  ipc?.ready(ACTIVE_PORT);
}
void main().catch((error) => {
  serverLogger.error('服务启动失败', error instanceof Error ? error.message : error);
  process.exit(1);
});
