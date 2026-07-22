import { Router, type Request, type Response } from 'express';
import { plugins } from '../../../plugin/load.ts';
import path from 'node:path';
import pluginApiRouter from './load.ts';

// TODO: 注册插件 api

/** /web/api */
const router = Router();

// 请求插件的 safeId
router.get('/safeId/:pluginDir', (req: Request<{ pluginDir: string }>, res: Response) => {
  const pluginDir = req.params.pluginDir;
  const plugin = plugins.find(
    (p) => path.basename(p.pluginDir).trim() === pluginDir.toString().trim(),
  );
  if (!plugin) {
    res.status(404).send('not found');
    return;
  }
  res.json({
    success: true,
    message: '获取插件 safeId 成功',
    data: {
      safeId: plugin.safeId,
    },
  });
});

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

router.use('/plugin', pluginApiRouter);

export default router;
