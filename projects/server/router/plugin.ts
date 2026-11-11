import { routeVersion } from './version.ts';
import { Router, type RequestHandler } from 'express';
import { query } from 'express-validator';
import z from 'zod';
import { plugins } from '../plugin/load.ts';
import { matchLink, getRootUrl } from './utils/index.ts';
import { pluginLogger } from '../plugin/log.ts';
import { pluginRefreshRule, shouldRefreshPlugin } from '../user-script/refresh.ts';
import { SCRIPT_CONFIG_RANGES, type ScriptContext } from '../../shared/script-ui.ts';
import type { PluginConfig } from '../../shared/types/plugin.d.ts';

/** /api/plugin */
const router = Router();

/**
 * 拼接插件通道
 * 格式: plugin:插件名称:插件ID:通道名称
 * @param pluginName 插件名称
 * @param pluginId 插件ID
 * @param channel 通道名称
 * @returns 拼接后的通道字符串
 */
function getPluginChannel(pluginName: string, pluginId: string, channel: string): string {
  return `plugin:${pluginName}:${pluginId}:${channel}`;
}

/**
 * 解析插件通道
 * @param fullChannel 完整通道字符串
 * @returns 解析结果对象
 */
function parsePluginChannel(fullChannel: string): {
  pluginName: string;
  pluginId: string;
  channel: string;
} | null {
  const match = fullChannel.match(/^plugin:([^:]+):([^:]+):(.+)$/);
  if (!match) {
    return null;
  }
  return {
    pluginName: match[1],
    pluginId: match[2],
    channel: match[3],
  };
}

const siteSchema = z.url();

// 获取浏览器脚本插件配置接口
const getConfig: RequestHandler = async (req, res) => {
  pluginLogger.info(`收到插件配置请求`);
  const { error, data: site } = siteSchema.safeParse(req.query?.site);

  pluginLogger.info(`来源: ${decodeURIComponent(String(req.query?.site ?? ''))}`);

  if (error) {
    pluginLogger.error(`无效的 site 参数: ${req.query?.site}`);
    res.status(400).json({ code: 400, message: 'site 参数必须是有效的 URL' });
    return;
  }
  let previousSite: string | undefined;
  if (req.query?.previousSite !== undefined) {
    const previous = siteSchema.safeParse(req.query?.previousSite);
    if (!previous.success || new URL(previous.data).origin !== new URL(site).origin) {
      res.status(400).json({ code: 400, message: 'previousSite 必须是同一网站的有效 URL' });
      return;
    }
    previousSite = previous.data;
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
  if (root.endsWith('/')) {
    root = root.slice(0, -1);
  }

  const pluginConfigs: PluginConfig[] = [];
  const activeIds: string[] = [],
    updatedIds: string[] = [];
  for (const plugin of plugins) {
    if (!plugin.linkWith || !matchLink(decodedSite, plugin.linkWith)) {
      continue;
    }
    const scripts = plugin.handler?.pluginConfig?.scripts;
    if (!scripts) {
      continue;
    }
    activeIds.push(plugin.pluginId);

    if (req.query.pluginId && req.query.pluginId !== plugin.pluginId) {
      continue;
    }

    try {
      if (
        !req.query.pluginId &&
        !shouldRefreshPlugin(scripts, plugin.linkWith, previousSite, decodedSite)
      ) {
        continue;
      }
      const refreshRule = pluginRefreshRule(scripts, decodedSite);
      const urlObj = new URL(decodedSite);

      if (scripts.version && !['v1', 'v2'].includes(scripts.version)) {
        throw new Error(`插件配置版本 ${scripts.version} 不兼容，请升级插件及脚本或扩展`);
      }

      if (scripts.version === 'v2') {
        const uiHandler = plugin.handler?.scriptUI;
        if (!uiHandler) {
          throw new Error('插件配置 v2 后端未就绪');
        }
        const ui = await uiHandler.render({
          version: 'v2',
          site: siteInfo(decodedSite),
          data: [],
          values: {},
          previousInstanceId: z.string().uuid().optional().parse(req.query.instanceId),
          dirtyFields:
            req.query.dirtyFields === undefined
              ? undefined
              : z
                  .array(z.string().max(200))
                  .max(256)
                  .parse(JSON.parse(String(req.query.dirtyFields))),
          logger: plugin.logger,
        });
        updatedIds.push(plugin.pluginId);
        pluginConfigs.push({
          id: plugin.pluginId,
          version: 'v2',
          compatibleVersions: SCRIPT_CONFIG_RANGES,
          title: scripts.title,
          description: scripts.description ?? scripts.title,
          refreshRule,
          controls: [],
          ui,
          requireFullContent: scripts.requireFullContent ?? true,
        });
        continue;
      }

      const controls =
        typeof scripts.controls === 'function'
          ? await scripts.controls(plugin.logger, {
              site: {
                url: decodedSite,
                rootUrl: root,
                origin: urlObj.origin,
                pathname: urlObj.pathname,
                host: urlObj.host,
                hostname: urlObj.hostname,
              },
            })
          : (scripts.controls ?? []);
      updatedIds.push(plugin.pluginId);

      if (
        plugin.handler &&
        plugin.handler.pluginConfig &&
        plugin.handler.pluginConfig.scripts &&
        plugin.handler.pluginConfig.scripts.title &&
        controls.length > 0
      ) {
        pluginConfigs.push({
          id: plugin.pluginId,
          version: 'v1',
          compatibleVersions: SCRIPT_CONFIG_RANGES,
          refreshRule,
          title: plugin.handler.pluginConfig.scripts.title,
          description:
            plugin.handler.pluginConfig.scripts.description ??
            plugin.handler.pluginConfig.scripts.title,
          // 用于浏览器脚本判断是否为脚本设置, 存在该项的 config 将被认为是脚本设置
          // 插件项不能传递这个值
          controls:
            controls.map((item) => ({
              ...item,
              options: {
                ...item.options,
                relatedChannel:
                  item.options?.relatedChannel?.map((channel) =>
                    getPluginChannel(plugin.name, plugin.pluginId, channel),
                  ) ?? [],
              },
              channel: getPluginChannel(plugin.name, plugin.pluginId, item.channel),
              trigger: void 0,
              // 插件项不能传递这个值
              'script-config-symbol': void 0,
            })) ?? [],
        });
      }
    } catch (error) {
      plugin.logger.warn('读取插件控件失败，继续加载其他插件', error);
      if (scripts.version && scripts.version !== 'v1') {
        updatedIds.push(plugin.pluginId);
        pluginConfigs.push({
          id: plugin.pluginId,
          version: scripts.version,
          compatibleVersions: SCRIPT_CONFIG_RANGES,
          title: scripts.title,
          description: scripts.description ?? '',
          controls: [],
          configError: error instanceof Error ? error.message : '插件配置加载失败',
        });
      }
    }
  }
  res.json({
    code: 200,
    message: 'success',
    data: pluginConfigs,
    activeIds,
    updatedIds,
    compatibleVersions: SCRIPT_CONFIG_RANGES,
  });
};
router.get('/config', routeVersion('3.2.0'), query('site').isURL(), getConfig);
// Chrome 扩展后台的 GET 不携带 Origin；POST 使浏览器生成可验证的扩展来源。
router.post('/config', routeVersion('3.2.0'), query('site').isURL(), getConfig);

const toggleSchema = z.object({
  version: z.literal('v1').default('v1'),
  type: z.string(),
  channel: z.string(),
  id: z.string(),
  context: z.object({
    data: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        images: z.array(z.string()),
      }),
    ),
    site: z.string(),
    // 插件项触发时可能需要携带其他相关控制器的值
    // relatedValues 的键为相关控制器的通道名称, 值为该控制器当前的值
    // button 类型的控制器值只能为 null
    relatedValues: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
    // 当前控制器的值. button 类型的控制器值只能为 null
    // string | number | boolean | null
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
  }),
});

// 插件通道触发接口
router.post('/toggle', routeVersion('3.2.0'), async (req, res) => {
  const parsedBody = toggleSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({ code: 400, message: '请求体格式错误' });
    return;
  }

  const {
    // type,
    channel,
    id: pluginId,
    context: { data, site, relatedValues, value },
  } = parsedBody.data;

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

  const urlObj = new URL(decodedSite);

  const siteInfo = {
    url: decodedSite,
    rootUrl: root,
    origin: urlObj.origin,
    pathname: urlObj.pathname,
    host: urlObj.host,
    hostname: urlObj.hostname,
  };

  // 解析通道
  const parsed = parsePluginChannel(channel);
  if (!parsed) {
    res.status(400).json({ code: 400, message: '无效的 channel 格式' });
    return;
  }

  const { pluginName, channel: pluginChannel } = parsed;

  const plugin = plugins.find((p) => p.pluginId === pluginId && p.name === pluginName);

  if (!plugin) {
    res.status(404).json({ code: 404, message: `未找到插件: ${pluginId}` });
    return;
  }

  const scripts = plugin.handler?.pluginConfig?.scripts;
  if (scripts?.version === 'v2') {
    res.status(409).json({ code: 409, message: '插件配置需要 v2 请求，请刷新插件配置' });
    return;
  }
  const controls =
    typeof scripts?.controls === 'function'
      ? await scripts.controls(plugin.logger, {
          site: siteInfo,
        })
      : (scripts?.controls ?? []);

  const pluginItem = controls.find((item) => item.channel === pluginChannel);

  // 调用插件的 trigger 处理函数
  if (pluginItem) {
    try {
      plugin.logger.info(`触发插件通道: ${pluginChannel}`);
      plugin.logger.info(`label: ${pluginItem.label}`);
      const result = await pluginItem.trigger(plugin.logger, {
        version: 'v1',
        data,
        value,
        relatedValues: (() => {
          const map: Record<string, string | number | boolean | null> = {};
          Object.entries(relatedValues).forEach(([channel, value]) => {
            const channelParts = parsePluginChannel(channel)?.channel;
            if (!channelParts) {
              return;
            }
            map[channelParts] = value;
          });
          return map;
        })(),
        site: siteInfo,
      });
      plugin.logger.info('=======================================================');
      res.json({ code: 200, message: '插件通道触发成功', data: result });
    } catch (e) {
      plugin.logger.error(`触发插件通道失败: ${e}`);
      res.status(500).json({ code: 500, message: '插件通道触发失败' });
    }
  } else {
    res.status(404).json({ code: 404, message: `未找到插件项: ${pluginChannel}` });
  }
});

export default router;

function siteInfo(site: string): ScriptContext['site'] {
  const url = new URL(site);
  return {
    url: site,
    rootUrl: getRootUrl(site).replace(/\/$/, ''),
    origin: url.origin,
    pathname: url.pathname,
    host: url.host,
    hostname: url.hostname,
  };
}
const eventSchema = z.object({
  version: z.literal('v2'),
  id: z.string().min(1),
  instanceId: z.string().uuid(),
  eventId: z.string().min(1).max(200),
  bindingId: z.string().min(1),
  readOnly: z.boolean().optional(),
  fields: z.record(
    z.string(),
    z.object({
      value: z.union([z.string().max(16384), z.boolean(), z.array(z.string().max(16384)).max(256)]),
      editSequence: z.number().int().nonnegative(),
    }),
  ),
  event: z
    .object({
      modifiers: z
        .object({ alt: z.boolean(), ctrl: z.boolean(), meta: z.boolean(), shift: z.boolean() })
        .optional(),
    })
    .optional(),
  data: z.array(z.object({ label: z.string(), value: z.string(), images: z.array(z.string()) })),
});
router.post('/event', routeVersion('3.2.0'), async (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success || typeof req.query.site !== 'string') {
    res.status(400).json({ code: 400, message: 'v2 事件请求格式错误' });
    return;
  }
  const plugin = plugins.find(
    (p) =>
      p.pluginId === parsed.data.id &&
      p.linkWith &&
      matchLink(req.query.site as string, p.linkWith),
  );
  if (!plugin?.handler?.scriptUI || plugin.handler.pluginConfig?.scripts?.version !== 'v2') {
    res.status(409).json({ code: 409, message: '插件配置协议不兼容，请刷新插件配置' });
    return;
  }
  try {
    const { id: _, data: crawlData, ...request } = parsed.data;
    const data = await plugin.handler.scriptUI.event(request, {
      version: 'v2',
      site: siteInfo(req.query.site),
      data: crawlData,
      values: {},
      logger: plugin.logger,
    });
    res.json({ code: 200, message: 'success', data });
  } catch (error) {
    res
      .status(400)
      .json({
        code: 400,
        errorCode: error instanceof Error && 'code' in error ? error.code : undefined,
        field: error instanceof Error && 'field' in error ? error.field : undefined,
        message: error instanceof Error ? error.message : '插件事件失败',
      });
  }
});
