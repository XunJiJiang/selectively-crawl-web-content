import express, { type Request } from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { writeData, writeDataURL } from './utils/writeData';
import { createLogger } from './utils/log';
import { convertToCN } from './utils/convertToCN';
import { strValidation } from './utils/strValidation';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;

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
interface PluginMeta {
  name: string;
  entry: string;
  linkWith: string[];
  handler?: Function;
}
let plugins: PluginMeta[] = [];

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
    try {
      name = pkg.name ?? path.join(PLUGIN_DIR, dir);
    } catch (e) {
      log.warn(`解析 ${dir}/package.json 失败:`, e);
      continue;
    }
    const entryRel = pkg.module;
    if (!entryRel || typeof entryRel !== 'string') {
      log.warn(`${dir} 缺少 module 字段`);
      continue;
    }
    const entryAbs = path.join(PLUGIN_DIR, dir, entryRel);
    if (!fs.existsSync(entryAbs) || !/\.(js|ts)$/.test(entryAbs)) {
      log.warn(`${dir} 的入口文件不存在或不是 js/ts 文件: ${entryRel}`);
      continue;
    }
    let mod: any;
    try {
      mod = require(entryAbs);
      if (mod.__esModule && mod.default) mod = mod.default;
    } catch (e) {
      log.warn(`动态导入 ${dir} 失败:`, e);
      continue;
    }
    if (typeof mod !== 'function') {
      log.warn(`${dir} 的默认导出不是函数`);
      continue;
    }
    const linkWith: string[] = Array.isArray(pkg['link-with']) ? pkg['link-with'] : [];
    plugins.push({
      name: name,
      entry: entryAbs,
      linkWith,
      handler: mod,
    });
    createLogger(`plugin:${name}`, path.relative(process.cwd(), path.join(PLUGIN_DIR, dir))).info(`加载插件 ${name}`);
  }
}

const log = createLogger('plugin', path.relative(process.cwd(), __dirname));

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
      pluginInfo: PluginMeta;
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
            (await plugin.handler(
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
                  writeData: (...args: Parameters<typeof writeData>) => writeData(...args),
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
      res.json({ success: false, message: '没有处理这个网址的插件', data: resInfo });
    }
  }
);

app.listen(PORT, () => {
  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务启动`);
});
