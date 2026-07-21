import express from 'express';
import { plugins } from '../../../plugin/load.ts';
import fs from 'node:fs';
import path from 'node:path';

const router = express.Router();

// /web/page/plugins/:pluginDir 访问插件的 UI 页面
// TODO: 插件页面在构建时需要设置基础路径为 /web/page/plugins/:pluginDir/
router.get(
  '/plugin/:pluginDir',
  (req: express.Request<{ pluginDir: string }>, res: express.Response) => {
    const pluginDir = req.params.pluginDir;
    const plugin = plugins.find(
      (p) => path.basename(p.pluginDir).trim() === pluginDir.toString().trim(),
    );
    if (!plugin) {
      res.redirect('/web/page/worry/404');
      return;
    }
    if (!plugin.handler?.ui?.entry) {
      res.redirect('/web/page/worry/404');
      return;
    }
    const entryPath = (() => {
      // 判断 entry 是否是绝对路径，如果是，则直接使用；如果不是，则拼接为相对于插件目录的路径
      if (path.isAbsolute(plugin.handler.ui.entry)) {
        return plugin.handler.ui.entry;
      } else {
        const pluginDir = path.dirname(plugin.entryFile);
        return path.join(pluginDir, plugin.handler.ui.entry);
      }
    })();
    if (!fs.existsSync(entryPath)) {
      res.redirect('/web/page/worry/404');
      return;
    }
    res.sendFile(entryPath);
  },
);

// 挂载 entryPath 目录的所有资源
router.get(
  '/plugins/:pluginDir/{*path}',
  (req: express.Request<{ pluginDir: string; path: string[] }>, res: express.Response) => {
    const pluginDir = req.params.pluginDir;
    const paths = req.params.path;
    const plugin = plugins.find((p) => path.basename(p.pluginDir) === pluginDir);
    if (!plugin) {
      res.status(404).send('not found');
      return;
    }
    if (!plugin.handler?.ui?.entry) {
      res.status(404).send('not found');
      return;
    }
    const entryPath = (() => {
      // 判断 entry 是否是绝对路径，如果是，则直接使用；如果不是，则拼接为相对于插件目录的路径
      if (path.isAbsolute(plugin.handler.ui.entry)) {
        return plugin.handler.ui.entry;
      } else {
        const pluginDir = path.dirname(plugin.entryFile);
        return path.join(pluginDir, plugin.handler.ui.entry);
      }
    })();
    const entryDir = path.dirname(entryPath);
    const assetFullPath = path.join(entryDir, ...paths);
    if (!fs.existsSync(assetFullPath)) {
      res.status(404).send('not found');
      return;
    }
    res.sendFile(assetFullPath);
  },
);

/** 错误定义 */
const errorDefinitions = {
  '404': {
    title: '404 Not Found',
    status: '404 Not Found',
    message: 'The requested resource could not be found.',
  },
  '500': {
    title: '500 Internal Server Error',
    status: '500 Internal Server Error',
    message: 'An unexpected error occurred on the server.',
  },
};

const __dirname = path.dirname(new URL(import.meta.url).pathname);

/** 错误页面模版 */
const errorPageTemplate = fs.readFileSync(path.join(__dirname, 'worry.html'), 'utf-8');

router.get('/worry/:id', (req: express.Request<{ id: string }>, res: express.Response) => {
  const worryId = req.params.id;
  if (!(worryId in errorDefinitions)) {
    // 转发到 /worry/404
    res.redirect('/worry/404');
    return;
  }
  const errorInfo = errorDefinitions[worryId as keyof typeof errorDefinitions];
  const renderedPage = errorPageTemplate
    .replace('{{title}}', errorInfo.title)
    .replace('{{status}}', errorInfo.status)
    .replace('{{message}}', errorInfo.message);
  res.status(parseInt(worryId)).send(renderedPage);
});

export default router;
