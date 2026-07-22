import { Router, type Request, type Response } from 'express';
import { plugins } from '../../../plugin/load.ts';
import fs from 'node:fs';
import path from 'node:path';
import { SERVER_ROOT } from '../../../common/env.ts';

/** /web/page */
const router = Router();
/** /web/page/lib */
const libRouter = Router();
router.use('/lib', libRouter);

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const LIB_DIR = path.join(PUBLIC_DIR, 'lib');

/** 查找最新库文件 */
function findLatestLibFile(): string | null {
  const files = fs.readdirSync(LIB_DIR);
  const webUtilsFiles = files.filter((file) => /^web-utils\.iife\.[a-zA-Z0-9]+\.js$/.test(file));
  if (webUtilsFiles.length === 0) {
    return null;
  }
  // 按照时间戳排序, 取最新的文件
  const latestFile = webUtilsFiles.sort((a, b) => {
    const aTimestamp = parseInt(a.split('.')[2], 36);
    const bTimestamp = parseInt(b.split('.')[2], 36);
    return bTimestamp - aTimestamp;
  })[0];
  return latestFile;
}

// 挂载 web utils 库静态资源
libRouter.get(/^\/web-utils\.iife\.[a-zA-Z0-9]+\.js$/, (_req, res) => {
  // 查找最新的 web-utils.iife.*.js 文件, * 是 36 进制的时间戳, 取最新的文件
  const latestFile = findLatestLibFile();
  if (!latestFile) {
    res.status(404).send('not found');
    return;
  }
  const filePath = path.join(LIB_DIR, latestFile);
  res.sendFile(filePath);
});

// /web/page/plugins/:pluginDir 访问插件的 UI 页面
// TODO: 插件页面在构建时需要设置基础路径为 /web/page/plugins/:pluginDir/
router.get('/plugin/:pluginDir', (req: Request<{ pluginDir: string }>, res: Response) => {
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
  const htmlContent = fs.readFileSync(entryPath, 'utf-8');
  const latestFile = findLatestLibFile();
  if (!latestFile) {
    // 不存在 web-utils 库文件, 直接返回 htmlContent
    res.send(htmlContent);
    return;
  }
  // 在 htmlContent 中  </body> 前插入 <script src="/web/page/lib/${latestFile}"></script>
  const modifiedHtmlContent = htmlContent.replace(
    '</body>',
    `<script src="/web/page/lib/${latestFile}"></script></body>`,
  );
  res.send(modifiedHtmlContent);
});

// 挂载 entryPath 目录的所有资源
router.get(
  '/plugin/:pluginDir/{*path}',
  (req: Request<{ pluginDir: string; path: string[] }>, res: Response) => {
    const pluginDir = req.params.pluginDir;
    const paths = req.params.path;
    const plugin = plugins.find(
      (p) => path.basename(p.pluginDir).trim() === pluginDir.toString().trim(),
    );
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

router.get('/worry/:id', (req: Request<{ id: string }>, res: Response) => {
  const worryId = req.params.id;
  if (!(worryId in errorDefinitions)) {
    // 转发到 /web/page/worry/404
    res.redirect('/web/page/worry/404');
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
