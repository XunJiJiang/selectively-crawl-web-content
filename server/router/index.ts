import path from 'node:path';
import express, { type Request } from 'express';
import z from 'zod';
import { strValidation } from '../utils/strValidation.ts';
import { convertToCN } from '../utils/convertToCN.ts';
import { fetchImage } from '../utils/fetchImage.ts';
import { writeData, writeDataURL } from '../utils/writeData.ts';
import pluginRouter from './plugin.ts';
import { plugins } from '../plugin/load.ts';
import { createLogger } from '../utils/log.ts';
import { getRootUrl } from './utils/index.ts';

export const app = express();

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

const apiRouter = express.Router();
const metadataRouter = express.Router();

const scrapeSchema = z.object({
  site: z.url(),
  data: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      images: z.array(z.string()),
    }),
  ),
});

metadataRouter.post(
  '/scrape',
  async (
    req: Request<
      any,
      any,
      {
        site: string;
        data: SCWC.DataItem[];
      }
    >,
    res: any,
  ) => {
    const parsedBody = scrapeSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({ success: false, message: '请求体格式错误' });
      return;
    }

    const { site, data } = parsedBody.data;

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
      type: 'success' | 'error' | 'warn' | 'info';
    }[] = [];
    for (const plugin of plugins) {
      if (plugin.linkWith && plugin.linkWith.some(link => root.startsWith(link))) {
        const log = createLogger(`plugin:${plugin.name}`, path.relative(process.cwd(), plugin.entry));
        log.info(`处理网址: ${decodedSite}`);
        // log.info(`插件入口: ${plugin.entry}`);
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
                toWeb: (info: string, type: 'success' | 'error' | 'warn' | 'info' = 'info') => {
                  resInfo.push({
                    pluginInfo: plugin,
                    info,
                    type,
                  });
                },
              },
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
        data: ['没有处理这个网址的插件'],
      });
    }
  },
);

apiRouter.use('/metadata', metadataRouter);
apiRouter.use('/plugin', pluginRouter);
app.use('/api', apiRouter);

export function listen(port: number, callback?: () => void) {
  app.listen(port, callback);
}
