import express, { type Request } from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { createLogger } from './utils/log';

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

/**
 * 处理 dataURL
 * 将其转换为图片文件并保存到指定目录
 * @param dataUrl base64编码的dataURL字符串
 * @param filePath 保存路径或函数
 * 如果是函数, 接收一个对象参数, 包含以下字段:
 * - fullname: 完整文件名, 包含扩展名
 * - filename: 不包含扩展名的文件名
 * - ext: 文件扩展名
 * - datePrefix: 日期前缀, 格式为 YYYYMMDDHHmmss
 * - 返回值为最终保存的文件路径
 * @returns 如果成功, 返回保存的文件路径; 如果失败, 返回 false
 */
function writeDataURL(
  dataUrl: string,
  filePath: string | ((props: { fullname: string; filename: string; ext: string; datePrefix: string }) => string)
): false | string {
  if (/^https?:\/\//.test(dataUrl)) {
    return dataUrl;
  }

  try {
    // 解析dataURL
    const match = /^data:image\/(\w+);base64,(.+)$/.exec(dataUrl);
    if (!match) return false;
    const ext = match[1] || 'png';
    const base64 = match[2];
    const buf = Buffer.from(base64, 'base64');

    const _filePath = (() => {
      const datePrefix = new Date()
        .toISOString()
        .replace(/[-:.TZ]/g, '')
        .slice(0, 14); // e.g. 20250620153045
      const filename = `${datePrefix}_${uuidv4()}`;
      const fullname = `${filename}.${ext}`;
      if (typeof filePath === 'function') {
        return filePath({
          fullname,
          filename,
          ext,
          datePrefix,
        });
      } else {
        return path.join(filePath, fullname);
      }
    })();

    fs.writeFileSync(_filePath, buf);
    return _filePath;
  } catch (e) {
    log.warn('写入图片失败:', e);
    return false;
  }
}

/**
 * 保存数据
 * @param dirPath 保存位置
 * @param data
 * @returns
 */
function writeData<D>(
  dirPath: string,
  data: D
):
  | false
  | {
      data: D;
    } {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    // 确保images目录存在
    const imagesDir = path.join(dirPath, 'images');
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

    const dataJsonPath = path.join(dirPath, 'data.json');
    let raw: unknown[];

    // 检查 data.json 是否存在且根元素为数组或为空
    if (fs.existsSync(dataJsonPath)) {
      const _raw = fs.readFileSync(dataJsonPath, 'utf-8');
      try {
        raw = JSON.parse(_raw);
        if (!Array.isArray(raw) && _raw.trim() !== '') {
          return false;
        }
        if (!Array.isArray(raw)) {
          raw = [];
        }
      } catch {
        return false;
      }
    } else {
      fs.writeFileSync(dataJsonPath, '', 'utf-8');
      raw = [];
    }

    // 判断 data 若是数组, 是否存在 DataItem
    if (
      Array.isArray(data) &&
      data.length &&
      data.some(item => typeof item === 'object' && item !== null && 'images' in item)
    ) {
      // 处理所有图片
      const newData = data.map((item: unknown) => {
        if (typeof item !== 'object' || item === null || !('images' in item) || !Array.isArray(item.images))
          return item;
        const newImages: string[] = [];
        for (const imgDataUrl of item.images) {
          const filePath = writeDataURL(imgDataUrl, imagesDir);
          if (!filePath) continue;
          newImages.push(filePath);
        }
        return { ...item, images: newImages };
      });
      raw.push(newData);
    } else {
      // 非DataItem[]，直接写入data.json
      raw.push(data);
    }
    fs.writeFileSync(dataJsonPath, JSON.stringify(raw, null, 2), 'utf-8');

    return {
      data: raw[raw.length - 1] as D, // 返回最新写入的数据
    };
  } catch (e) {
    log.warn('写入json文件失败:', e);
    return false;
  }
}

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
                writeData: (...args: Parameters<typeof writeData>) => writeData(...args),
                writeDataURL: (...args: Parameters<typeof writeDataURL>) => writeDataURL(...args),
              },
              log
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
      res.json({ success: true, message: 'success' });
    } else {
      res.json({ success: false, message: '没有处理这个网址的插件' });
    }
  }
);

app.listen(PORT, () => {
  const log = createLogger('server', `http://localhost:${PORT}`);
  log.pathInfo(`服务启动`);
});
