import express from 'express';
import { plugins } from '../../../plugin/load.ts';
import path from 'node:path';

const router = express.Router();

// 获取全部挂载了 ui 的插件信息
router.get('/pages', (req, res) => {
  const pluginsWithUI = plugins.filter(
    (plugin) => plugin.handler?.ui && plugin.handler.ui.entry,
  ) as (SCWC.IPluginMeta & {
    handler: SCWC.IPluginHandler & { ui: { entry: string } };
  })[];
  const pluginInfoList = pluginsWithUI.map((plugin) => {
    // 取最后一段作为 name
    const dir = path.basename(plugin.pluginDir);
    return {
      dir: dir,
      pluginId: plugin.pluginId,
    };
  });
  res.json({
    success: true,
    message: '获取插件页面信息成功',
    data: pluginInfoList,
  });
});

export default router;
