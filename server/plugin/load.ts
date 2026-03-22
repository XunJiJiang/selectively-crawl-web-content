import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/log.ts';
import { CommandError, registerCommand } from '../utils/command.ts';
import { createRequire } from 'node:module';
import { addErrorHandler } from '../utils/cache.ts';

const __dirname = process.cwd();

const require = createRequire(import.meta.url);

// 插件加载逻辑
const PLUGIN_DIR = path.join(__dirname, 'server', 'plugins');

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
  addErrorHandler('env', ({ channel, error }) => {
    logger.error(`Environment error: ${error.message}`);
  });
  addErrorHandler('memory', ({ channel, error }) => {
    logger.error(`Memory cache error: ${error.message}`);
  });
  addErrorHandler('redis', ({ channel, error }) => {
    logger.error(`Redis cache error: ${error.message}`);
  });
}

export async function loadPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) return;
  const dirs = fs
    .readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  for (const dir of dirs) {
    const pkgPath = path.join(PLUGIN_DIR, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const logger = createLogger(`plugin:${dir}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir)));
    let pkg: any;
    let name: string;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) {
      logger.warn(`解析 ${dir}/package.json 失败:`, e);
      continue;
    }

    if (pkg.enabled === false) {
      logger.info(`插件已禁用`);
      inactivePlugins.push({
        name: pkg.name ?? path.join(PLUGIN_DIR, dir),
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '插件已禁用',
        logger,
      });
      continue;
    }

    try {
      name = pkg.name ?? path.join(PLUGIN_DIR, dir);
    } catch (e) {
      logger.warn(`解析 ${dir}/package.json 失败:`, e);
      inactivePlugins.push({
        name: path.join(PLUGIN_DIR, dir),
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: 'package.json 中缺少 name 字段',
        logger,
      });
      continue;
    }
    const entryRel = pkg.main;
    if (!entryRel || typeof entryRel !== 'string') {
      logger.warn(`${dir} 缺少 main 字段`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: 'package.json 中缺少 main 字段',
        logger,
      });
      continue;
    }
    /** 插件入口文件绝对路径 */
    const entryAbs = path.join(PLUGIN_DIR, dir, entryRel);
    if (!fs.existsSync(entryAbs) || !/\.(js|ts)$/.test(entryAbs)) {
      logger.warn(`${dir} 的入口文件不存在或不是 js/ts 文件: ${entryRel}`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '入口文件不存在或不是 js/ts 文件',
        logger,
      });
      continue;
    }
    let mod: any;
    try {
      mod = require(entryAbs);
      if (mod.__esModule && mod.default) mod = mod.default;
    } catch (e) {
      logger.warn(`动态导入 ${dir} 失败:`, e);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '动态导入插件失败',
        logger,
      });
      continue;
    }
    if (!('onRequest' in mod) || typeof mod.onRequest !== 'function') {
      logger.warn(`${dir} 的默认导出不是合法插件`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '插件缺少 onRequest 方法',
        logger,
      });
      continue;
    }
    const linkWith: string[] = Array.isArray(pkg['link-with'])
      ? pkg['link-with'].map(item => {
          // 去除尾部斜杠
          if (item.endsWith('/')) {
            return item.slice(0, -1);
          } else {
            return item;
          }
        })
      : [];
    plugins.push({
      name: name,
      entry: entryAbs,
      linkWith,
      handler: mod,
      pluginId: dir,
      commandName: pkg['commandName'] ?? void 0,
      logger,
    });
    createLogger(`plugin:${name}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir))).info(`加载完成`);
  }

  for (const plugin of plugins) {
    if (!plugin.handler) {
      continue;
    }

    const logger = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));

    const commandConfig = plugin.handler.pluginConfig?.command;
    if (commandConfig) {
      const commandName = plugin.commandName;
      if (commandName) {
        try {
          registerCommand(
            logger,
            commandName,
            commandConfig.execute,
            plugin.pluginId,
            commandConfig.description,
            commandConfig.subCommands,
            commandConfig.options,
            commandConfig.exampleUsage,
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

    if (typeof plugin.handler.onLoad === 'function') {
      await plugin.handler.onLoad(logger, {});
    }
  }
}
