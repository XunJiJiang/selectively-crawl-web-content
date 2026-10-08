import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/log.ts';
import { CommandError, registerCommand } from '../utils/command.ts';
import { addErrorHandler, createNamespacedCache } from '../utils/cache.ts';
import { v4 as uuid } from 'uuid';
import { registerPluginApi, registerPluginResources } from '../router/web/api/load.ts';
import { pluginWebSocketRegistry } from '../router/web/websocket.ts';
import { PluginProcessClient } from './process/client.ts';
import { resolveProcessOptions } from './process/options.ts';
import '../common/environment.ts';
import { APP_DIR, ENV_DIR, ROOT } from '../common/paths.ts';
import { parsedArgs, isDev } from '../common/setupParam.ts';
import { pluginDirectorySettings } from '../common/config.ts';
import { resolvePluginDirectory } from '../common/pluginDirectory.ts';
import { ensurePluginWeb } from './web/build.ts';

export function configuredPluginDirectory(confirm?: () => Promise<boolean>) {
  return resolvePluginDirectory(
    pluginDirectorySettings({
      env: process.env,
      args: parsedArgs,
      appDir: APP_DIR,
      root: ROOT,
      envDir: ENV_DIR,
      cwd: process.cwd(),
      isDev,
    }),
    confirm,
  );
}

/** 加载的插件列表 */
export const plugins: SCWC.IPluginMeta[] = [];

/** 未激活的插件列表 */
export const inactivePlugins: (SCWC.IPluginMeta & {
  // 未激活原因
  reason: string;
})[] = [];

/**
 * 初始化缓存错误处理
 * > 这个函数目前和插件没有关系, 可以修改成根据缓存命名空间判断错误来源
 * @param logger 日志实例
 */
export function initCacheErrorHandler(logger: SCWC.TLogger) {
  addErrorHandler('env', ({ /* channel, */ error }) => {
    logger.error(`Environment error: ${error.message}`);
  });
  addErrorHandler('memory', ({ /* channel, */ error }) => {
    logger.error(`Memory cache error: ${error.message}`);
  });
  addErrorHandler('redis', ({ /* channel, */ error }) => {
    logger.error(`Redis cache error: ${error.message}`);
  });
}

export async function loadPlugins(directory?: string) {
  directory = path.resolve(directory ?? (await configuredPluginDirectory()));
  if (!fs.existsSync(directory)) {
    return;
  }
  const dirs = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const loadOne = async (dir: string): Promise<void> => {
    const pkgPath = path.join(directory, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      return;
    }
    const logger = createLogger(
      `plugin:${dir}`,
      path.relative(process.cwd(), path.join(directory, dir)),
    );
    let pkg: {
      name?: string;
      main?: string;
      enabled?: boolean;
      'link-with'?: string[];
      commandName?: string;
      runtime?: unknown;
    } = {};
    let name = '';
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) {
      logger.warn(`解析 ${dir}/package.json 失败:`, e);
      return;
    }

    if (pkg.enabled === false) {
      logger.info(`插件已禁用`);
      inactivePlugins.push({
        name: pkg.name ?? path.join(directory, dir),
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: '插件已禁用',
        logger,
        entryFile: path.join(directory, dir, pkg.main ?? ''),
        pluginDir: path.join(directory, dir),
      });
      return;
    }

    try {
      name = pkg.name ?? path.join(directory, dir);
    } catch (e) {
      logger.warn(`解析 ${dir}/package.json 失败:`, e);
      inactivePlugins.push({
        name: path.join(directory, dir),
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: 'package.json 中缺少 name 字段',
        logger,
        entryFile: path.join(directory, dir, pkg.main ?? ''),
        pluginDir: path.join(directory, dir),
      });
      return;
    }
    const entryRel = pkg.main;
    if (!entryRel || typeof entryRel !== 'string') {
      logger.warn(`${dir} 缺少 main 字段`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: 'package.json 中缺少 main 字段',
        logger,
        entryFile: path.join(directory, dir, pkg.main ?? ''),
        pluginDir: path.join(directory, dir),
      });
      return;
    }
    /** 插件入口文件绝对路径 */
    const entryAbs = path.join(directory, dir, entryRel);
    if (!fs.existsSync(entryAbs) || !/\.(js|ts)$/.test(entryAbs)) {
      logger.warn(`${dir} 的入口文件不存在或不是 js/ts 文件: ${entryRel}`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: '入口文件不存在或不是 js/ts 文件',
        logger,
        entryFile: path.join(directory, dir, pkg.main ?? ''),
        pluginDir: path.join(directory, dir),
      });
      return;
    }
    let mod: SCWC.IHostedPluginHandler;
    let processClient: PluginProcessClient | undefined;
    try {
      const runtime = resolveProcessOptions(pkg.runtime);
      // Every plugin entry stays outside the HTTP process, including when settings are omitted.
      processClient = new PluginProcessClient({
        pluginId: dir,
        entry: entryAbs,
        pluginDir: path.join(directory, dir),
        name,
        logger,
        runtime,
        cache: () => createNamespacedCache(`plugin:${dir}`, logger),
      });
      mod = await processClient.start();
      await ensurePluginWeb(path.join(directory, dir), entryAbs, mod, logger);
    } catch (error) {
      await processClient?.stop(true);
      logger.warn(`加载 ${dir} 失败:`, error);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: error instanceof Error ? error.message : String(error),
        logger,
        entryFile: entryAbs,
        pluginDir: path.join(directory, dir),
        runtime: processClient?.info,
      });
      return;
    }
    if (!mod || typeof mod.onRequest !== 'function') {
      logger.warn(`${dir} 的默认导出不是合法插件`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        safeId: uuid(),
        pluginId: dir,
        reason: '插件缺少 onRequest 方法',
        logger,
        entryFile: path.join(directory, dir, pkg.main ?? ''),
        pluginDir: path.join(directory, dir),
      });
      return;
    }
    const linkWith: string[] = Array.isArray(pkg['link-with'])
      ? pkg['link-with'].map((item) => {
          // 去除尾部斜杠
          if (item.endsWith('/')) {
            return item.slice(0, -1);
          } else {
            return item;
          }
        })
      : [];
    const plugin: SCWC.IPluginMeta = {
      name: mod.name ?? name,
      entry: entryAbs,
      linkWith,
      handler: mod,
      runtime: processClient?.info,
      safeId: uuid(),
      pluginId: dir,
      commandName: pkg['commandName'] ?? void 0,
      logger,
      entryFile: path.join(directory, dir, pkg.main ?? ''),
      pluginDir: path.join(directory, dir),
    };
    if (!(await activatePlugin(plugin))) {
      return;
    }
    plugins.push(plugin);
    createLogger(`plugin:${name}`, path.relative(process.cwd(), path.join(directory, dir))).info(
      `加载完成`,
    );
  };
  let cursor = 0;
  const worker = async () => {
    while (cursor < dirs.length) {
      await loadOne(dirs[cursor++]);
    }
  };
  await Promise.all([worker(), worker()]);
}

async function activatePlugin(plugin: SCWC.IPluginMeta): Promise<boolean> {
  if (!plugin.handler) {
    return false;
  }

  const logger = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));

  try {
    // The child has already completed onLoad before publishing its manifest.
    // 注册插件命令
    const commandConfig = plugin.handler.pluginConfig?.command;
    if (commandConfig) {
      const commandName = plugin.commandName;
      if (commandName) {
        try {
          registerCommand(
            logger,
            commandName,
            // TODO: 当没有定义 execute 时, 可以提供一个默认的执行函数, 例如打印命令描述和用法等信息
            commandConfig.execute ??
              (() => {
                /* */
              }),
            plugin.pluginId,
            commandConfig.description,
            commandConfig.subCommands,
            commandConfig.options,
            commandConfig.exampleUsage,
            () => !plugin.runtime || ['ready', 'unresponsive'].includes(plugin.runtime.status),
          );
        } catch (e) {
          if (e instanceof CommandError) {
            logger.error(`注册命令 ${commandName} 失败: ${e.message}`);
            if (e.needPrintOriginal) {
              logger.error(e);
            }
          } else {
            logger.error(`注册命令 ${commandName} 时出现未知错误: ${e}`);
          }
        }
      }
    }

    // 注册插件的 api
    registerPluginApi(plugin);
    registerPluginResources(plugin);
    pluginWebSocketRegistry.register(plugin);
    return true;
  } catch (error) {
    logger.error('插件激活失败', error);
    try {
      await plugin.handler.onUnload?.(logger, { isRestart: false });
    } catch (unloadError) {
      logger.warn('清理失败的插件时发生错误', unloadError);
    }
    inactivePlugins.push({
      ...plugin,
      reason: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
