import path from 'node:path';
import express, { type Request } from 'express';
import z from 'zod';
import { strValidation } from '../utils/strValidation.ts';
import { convertToCN } from '../utils/convertToCN.ts';
import { fetchImage } from '../utils/fetchImage.ts';
import { writeData, writeDataURL } from '../utils/writeData.ts';
import pluginRouter from './plugin.ts';
import webRouter from './web/index.ts';
import { plugins } from '../plugin/load.ts';
import { createLogger } from '../utils/log.ts';
import { getRootUrl, matchLink } from './utils/index.ts';
import { TOKEN } from '../common/env.ts';
import { serverLogger } from '../common/logger.ts';
import { isSameDomain } from '../utils/url.ts';

export const app = express();

// 修改为支持大体积json
app.use(express.json({ limit: '100mb' }));

/** 当前服务所在主机和端口 */
// const baseUrl = `${HOST}:${PORT}`;

app.use((req, res, next) => {
  // CORS
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }

  // 如果是 /web/* 的 get 请求, 则不进行权限验证, 直接放行
  // /web/api 和 /web/api/* 的请求仍然需要进行权限验证
  if (
    (req.path === '/web' || req.path.startsWith('/web/')) &&
    req.method === 'GET' &&
    !(req.path === '/web/api') &&
    !req.path.startsWith('/web/api/')
  ) {
    next();
    return;
  }

  const origin = req.get('Origin');
  const referer = req.get('Referer');

  // origin 和 referer 必须至少存在一个, site参数必须存在
  // 且主机名相同, 才能通过验证
  if ((!origin && !referer) || !req.query?.site) {
    serverLogger.warn(`请求缺少主机信息: ${req.method} ${req.url}`);
    serverLogger.warn(`- origin: ${decodeURIComponent(origin ?? '未知')}`);
    serverLogger.warn(`- referer: ${decodeURIComponent(referer ?? '未知')}`);
    serverLogger.warn(`- site: ${decodeURIComponent(req.query?.site?.toString() ?? '未知')}`);
    res.status(400).json({ success: false, message: '验证不通过' });
    return;
  }
  if (!isSameDomain(origin ?? referer ?? '', req.query.site.toString())) {
    serverLogger.warn(`请求的主机不匹配: ${req.method} ${req.url}`);
    serverLogger.warn(`- origin: ${decodeURIComponent(origin ?? '未知')}`);
    serverLogger.warn(`- referer: ${decodeURIComponent(referer ?? '未知')}`);
    serverLogger.warn(`- site: ${decodeURIComponent(req.query.site.toString())}`);
    res.status(400).json({ success: false, message: '验证不通过' });
    return;
  }

  // 权限验证
  // 如果没有配置 TOKEN, 则不进行验证, 直接放行
  if (!TOKEN) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];

  if (!authHeader) {
    serverLogger.warn(
      `请求缺少 Authorization 头: ${req.method} ${req.url}, 来源: ${decodeURIComponent(req.query.site.toString())}`,
    );
    res.status(401).json({ success: false, message: '缺少 Authorization 头' });
    return;
  }

  const [type, token] = authHeader.toString().split(' ');
  if (type !== 'Bearer' || token !== TOKEN) {
    serverLogger.warn(
      `请求使用了无效的 token: ${req.method} ${req.url}, 来源: ${decodeURIComponent(req.query.site.toString())}`,
    );
    res.status(403).json({ success: false, message: '无效的 token' });
    return;
  }

  next();
});

/** /api */
const apiRouter = express.Router();
/** /api/metadata */
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
      unknown,
      unknown,
      {
        site: string;
        data: SCWC.TDataItem[];
      }
    >,
    res: express.Response<
      | {
          success: boolean;
          message: string;
          data: {
            pluginInfo: {
              name: string;
            };
            info: string;
            type: 'success' | 'error' | 'warn' | 'info';
          }[];
        }
      | { success: false; message: string; data: string[] }
    >,
  ) => {
    const parsedBody = scrapeSchema.safeParse(req.body);

    if (!parsedBody.success) {
      res.status(400).json({ success: false, message: '请求体格式错误', data: [] });
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
    if (root.endsWith('/')) {
      root = root.slice(0, -1);
    }

    let called = false;
    const resInfo: {
      pluginInfo: SCWC.IPluginMeta;
      info: string;
      type: 'success' | 'error' | 'warn' | 'info';
    }[] = [];
    for (const plugin of plugins) {
      // 当 plugin.linkWith 存在时，且匹配当前网址时才执行
      // 当 plugin.linkWith 为空数组时，视为匹配所有网址
      if (plugin.linkWith && matchLink(decodedSite, plugin.linkWith)) {
        const log = createLogger(
          `plugin:${plugin.name}`,
          path.relative(process.cwd(), plugin.entry),
        );
        log.info(`处理网址: ${decodedSite}`);
        // log.info(`插件入口: ${plugin.entry}`);
        try {
          if (plugin.handler) {
            await plugin.handler.onRequest(
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
                  writeData: <D>(...args: Parameters<typeof writeData>) => writeData(...args) as D,
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
            );
          }
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
        data: resInfo.map((item) => ({
          ...item,
          pluginInfo: { name: item.pluginInfo.name },
        })),
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
app.use('/web', webRouter);

export function listen(port: number, callback?: () => void) {
  app.listen(port, callback);
}
