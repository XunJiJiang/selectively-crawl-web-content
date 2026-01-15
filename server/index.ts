import express, { type Request } from 'express';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { writeData, writeDataURL } from './utils/writeData';
import { createLogger } from './utils/log';
import { convertToCN } from './utils/convertToCN';
import { strValidation } from './utils/strValidation';
import { fetchImage } from './utils/fetchImage';
import {
  registerCommand,
  parseAndRunCommands,
  CommandError,
  SYSTEM_SYMBOL,
  printCommandHelp,
  printHelp,
} from './utils/command';

dotenv.config();

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(import.meta.url);

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;

// 修改为支持大体积json
app.use(express.json({ limit: '100mb' }));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// 插件加载逻辑
const PLUGIN_DIR = path.join(__dirname, 'plugins');

/** 加载的插件列表 */
let plugins: SCWC.PluginMeta[] = [];

/** 未激活的插件列表 */
let inactivePlugins: (SCWC.PluginMeta & {
  // 未激活原因
  reason: string;
})[] = [];

function loadPlugins() {
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
    });
    createLogger(`plugin:${name}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir))).info(`加载完成`);
  }

  for (const plugin of plugins) {
    if (plugin.handler && typeof plugin.handler.onLoad === 'function') {
      const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));
      plugin.handler.onLoad(log, {
        registerCommand: (callback, description, subCommands, options, exampleUsage) => {
          const commandName = plugin.commandName;
          if (commandName) {
            try {
              registerCommand(
                log,
                commandName,
                callback,
                plugin.pluginId,
                description,
                subCommands,
                options,
                exampleUsage
              );
            } catch (e) {
              if (e instanceof CommandError) {
                log.error(`注册命令 ${commandName} 失败: ${e.message}`);
              } else {
                log.error(`注册命令 ${commandName} 时出现未知错误: ${e}`);
              }
            }
          }
        },
      });
    }
  }
}

// 系统日志实例
const serverLogger = createLogger('server', path.relative(process.cwd(), __dirname));
// 插件日志实例
const pluginLogger = createLogger('plugin', path.relative(process.cwd(), __dirname));

function getRootUrl(url: string) {
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return '';
  }
}

// 启动时加载插件
loadPlugins();
// 注册系统命令
registerCommand(
  serverLogger,
  'exit',
  () => {
    process.exit(0);
  },
  SYSTEM_SYMBOL,
  '退出程序'
);
registerCommand(
  serverLogger,
  'help',
  (_options, log, originArgs) => {
    if (originArgs.length === 1) {
      printHelp();
    } else if (originArgs.length === 2) {
      printCommandHelp(originArgs[1]);
    } else {
      log.error('用法错误: help [命令名称]');
    }
  },
  SYSTEM_SYMBOL,
  '显示帮助信息'
);
registerCommand(
  pluginLogger,
  'plugin:list',
  () => {
    console.log('所有插件列表:');
    for (const plugin of plugins) {
      console.log(`- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`);
    }
    for (const plugin of inactivePlugins) {
      console.log(
        `- ${plugin.name}[disabled] (原因: ${plugin.reason}) (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`
      );
    }
  },
  SYSTEM_SYMBOL,
  '列出所有已加载的插件'
);
registerCommand(
  pluginLogger,
  'plugin:ps',
  () => {
    console.log('已加载插件列表:');
    for (const plugin of plugins) {
      console.log(`- ${plugin.name}[enabled] (跟踪网址: ${plugin.linkWith.join(', ') ?? '无'})`);
    }
  },
  SYSTEM_SYMBOL,
  '列出所有已加载的插件'
);

type DataItem = {
  label: string;
  value: string;
  images: string[]; // 图片数据，dataURL
};

app.post(
  '/save',
  async (
    req: Request<
      any,
      any,
      {
        site: string;
        data: DataItem[];
      }
    >,
    res: any
  ) => {
    const { site, data } = req.body;
    if (!site || !data) {
      return res.status(400).json({ success: false, message: '缺少site或data' });
    }

    // 对 site 进行解码，防止出现编码后的中文等字符
    let decodedSite = '';
    try {
      decodedSite = decodeURIComponent(site);
    } catch {
      decodedSite = site;
    }

    // 匹配插件
    let root = getRootUrl(decodedSite);
    // 统一去除尾部斜杠
    if (root.endsWith('/')) root = root.slice(0, -1);
    // 处理 linkWith 也去除尾部斜杠
    plugins.forEach(plugin => {
      if (plugin.linkWith) {
        plugin.linkWith = plugin.linkWith.map(link => (link.endsWith('/') ? link.slice(0, -1) : link));
      }
    });

    let called = false;
    const resInfo: {
      pluginInfo: SCWC.PluginMeta;
      info: string;
      type: 'success' | 'error';
    }[] = [];
    for (const plugin of plugins) {
      if (plugin.linkWith && plugin.linkWith.some(link => root.startsWith(link))) {
        const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));
        log.info(`处理网址: ${decodedSite}`);
        log.info(`插件入口: ${plugin.entry}`);
        try {
          plugin.handler &&
            (await plugin.handler.onRequest(
              {
                site: {
                  url: decodedSite,
                  rootUrl: root,
                  origin: new URL(decodedSite).origin,
                  pathname: new URL(decodedSite).pathname,
                },
                data,
                utils: {
                  strValidation: (str: string) => strValidation(str),
                  convertToCN: (str: string) => convertToCN(str),
                  fetchImage: (url: string) => fetchImage(url, log),
                  writeData: <D>(...args: Parameters<typeof writeData>) => <D>writeData(...args),
                  writeDataURL: (...args: Parameters<typeof writeDataURL>) => writeDataURL(...args),
                },
              },
              {
                ...log,
                toWeb: (info: string, type: 'success' | 'error' = 'success') => {
                  resInfo.push({
                    pluginInfo: plugin,
                    info,
                    type,
                  });
                },
              }
            ));
          called = true;
        } catch (e) {
          log.warn(`调用插件 ${plugin.name} 时出现错误:`, e);
        } finally {
          log.info(`=======================================================`);
        }
      }
    }
    if (called) {
      res.json({
        success: true,
        message: 'success',
        data: resInfo.map(item => ({ ...item, pluginInfo: { name: item.pluginInfo.name } })),
      });
    } else {
      res.json({
        success: false,
        message: '没有处理这个网址的插件',
        data: [],
      });
    }
  }
);

app.listen(PORT, () => {
  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务启动`);
});

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

process.stdin.setEncoding('utf-8');
process.stdin.on('data', input => {
  const inputStr = input.toString().trim();
  try {
    parseAndRunCommands(inputStr);
  } catch (e) {
    if (e instanceof CommandError) {
      serverLogger.error(`命令执行失败: ${e.message}`);
    } else {
      serverLogger.error(`命令执行时出现未知错误: ${e}`);
    }
  }
});
