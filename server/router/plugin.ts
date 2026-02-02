import express from 'express';
import z from 'zod';
import { plugins } from '../plugin/load.ts';
import { getRootUrl } from './utils/index.ts';

const router = express.Router();

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
  if (!match) return null;
  return {
    pluginName: match[1],
    pluginId: match[2],
    channel: match[3],
  };
}

// 获取浏览器脚本插件配置接口
router.get('/config', (req, res) => {
  const pluginConfigs: {
    id: string;
    title: string;
    description: string;
    controls: SCWC.PluginItem[];
  }[] = [];
  for (const plugin of plugins) {
    if (
      plugin.handler &&
      plugin.handler.pluginConfig &&
      plugin.handler.pluginConfig.scripts &&
      plugin.handler.pluginConfig.scripts.title
    ) {
      pluginConfigs.push({
        id: plugin.pluginId,
        title: plugin.handler.pluginConfig.scripts.title,
        description: plugin.handler.pluginConfig.scripts.description ?? plugin.handler.pluginConfig.scripts.title,
        controls:
          plugin.handler.pluginConfig.scripts.controls.map(item => ({
            ...item,
            channel: getPluginChannel(plugin.name, plugin.pluginId, item.channel),
          })) ?? [],
      });
    }
  }
  res.json({
    code: 200,
    message: 'success',
    data: pluginConfigs,
  });
});

const toggleSchema = z.object({
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
  }),
});

// 插件通道触发接口
router.post('/toggle', async (req, res) => {
  const parsedBody = toggleSchema.safeParse(req.body);

  if (!parsedBody.success) {
    res.status(400).json({ code: 400, message: '请求体格式错误' });
    return;
  }

  const {
    type,
    channel,
    id: pluginId,
    context: { data, site },
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
  if (root.endsWith('/')) root = root.slice(0, -1);

  const siteInfo = {
    url: decodedSite,
    rootUrl: root,
    origin: new URL(decodedSite).origin,
    pathname: new URL(decodedSite).pathname,
  };

  // 解析通道
  const parsed = parsePluginChannel(channel);
  if (!parsed) {
    res.status(400).json({ code: 400, message: '无效的 channel 格式' });
    return;
  }

  const { pluginName, channel: pluginChannel } = parsed;

  const plugin = plugins.find(p => p.pluginId === pluginId && p.name === pluginName);

  if (!plugin) {
    res.status(404).json({ code: 404, message: `未找到插件: ${pluginId}` });
    return;
  }

  const pluginItem = plugin.handler?.pluginConfig?.scripts?.controls.find(item => item.channel === pluginChannel);

  // 调用插件的 trigger 处理函数
  if (pluginItem) {
    try {
      plugin.log.info(`触发插件通道: ${pluginChannel}`);
      plugin.log.info(`label: ${pluginItem.label}`);
      const result = await pluginItem.trigger(plugin.log, {
        data,
        site: siteInfo,
      });
      plugin.log.info('=======================================================');
      res.json({ code: 200, message: '插件通道触发成功', data: result });
    } catch (e) {
      plugin.log.error(`触发插件通道失败: ${e}`);
      res.status(500).json({ code: 500, message: '插件通道触发失败' });
    }
  }
});

export default router;
