import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/log.ts';
import { CommandError, registerCommand } from '../utils/command.ts';
import { createRequire } from 'node:module';

const __dirname = process.cwd();

const require = createRequire(import.meta.url);

// 插件加载逻辑
const PLUGIN_DIR = path.join(__dirname, 'server', 'plugins');

/** 加载的插件列表 */
export const plugins: SCWC.PluginMeta[] = [];

/** 未激活的插件列表 */
export const inactivePlugins: (SCWC.PluginMeta & {
  // 未激活原因
  reason: string;
})[] = [];

export function loadPlugins() {
  if (!fs.existsSync(PLUGIN_DIR)) return;
  const dirs = fs
    .readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
  for (const dir of dirs) {
    const pkgPath = path.join(PLUGIN_DIR, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;
    const log = createLogger(`plugin:${dir}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir)));
    let pkg: any;
    let name: string;
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch (e) {
      log.warn(`解析 ${dir}/package.json 失败:`, e);
      continue;
    }

    if (pkg.enabled === false) {
      log.info(`插件被设置为禁用，跳过加载`);
      inactivePlugins.push({
        name: pkg.name ?? path.join(PLUGIN_DIR, dir),
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '插件被设置为禁用',
        log,
      });
      continue;
    }

    try {
      name = pkg.name ?? path.join(PLUGIN_DIR, dir);
    } catch (e) {
      log.warn(`解析 ${dir}/package.json 失败:`, e);
      inactivePlugins.push({
        name: path.join(PLUGIN_DIR, dir),
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: 'package.json 中缺少 name 字段',
        log,
      });
      continue;
    }
    const entryRel = pkg.main;
    if (!entryRel || typeof entryRel !== 'string') {
      log.warn(`${dir} 缺少 main 字段`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: 'package.json 中缺少 main 字段',
        log,
      });
      continue;
    }
    /** 插件入口文件绝对路径 */
    const entryAbs = path.join(PLUGIN_DIR, dir, entryRel);
    if (!fs.existsSync(entryAbs) || !/\.(js|ts)$/.test(entryAbs)) {
      log.warn(`${dir} 的入口文件不存在或不是 js/ts 文件: ${entryRel}`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '入口文件不存在或不是 js/ts 文件',
        log,
      });
      continue;
    }
    let mod: any;
    try {
      mod = require(entryAbs);
      if (mod.__esModule && mod.default) mod = mod.default;
    } catch (e) {
      log.warn(`动态导入 ${dir} 失败:`, e);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '动态导入插件失败',
        log,
      });
      continue;
    }
    if (!('onRequest' in mod) || typeof mod.onRequest !== 'function') {
      log.warn(`${dir} 的默认导出不是合法插件`);
      inactivePlugins.push({
        name,
        entry: '',
        linkWith: [],
        pluginId: dir,
        reason: '插件缺少 onRequest 方法',
        log,
      });
      continue;
    }
    const linkWith: string[] = Array.isArray(pkg['link-with']) ? pkg['link-with'] : [];
    plugins.push({
      name: name,
      entry: entryAbs,
      linkWith,
      handler: mod,
      pluginId: dir,
      commandName: pkg['commandName'] ?? void 0,
      log,
    });
    createLogger(`plugin:${name}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir))).info(`加载完成`);
  }

  for (const plugin of plugins) {
    if (!plugin.handler) {
      continue;
    }

    const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));

    const commandConfig = plugin.handler.pluginConfig?.command;
    if (commandConfig) {
      const commandName = plugin.commandName;
      if (commandName) {
        try {
          registerCommand(
            log,
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
            log.error(`注册命令 ${commandName} 失败: ${e.message}`);
            if (e.needPrintOriginal) {
              log.error(e);
            }
          } else {
            log.error(`注册命令 ${commandName} 时出现未知错误: ${e}`);
          }
        }
      }
    }

    if (typeof plugin.handler.onLoad === 'function') {
      plugin.handler.onLoad(log, {});
    }
  }
}
