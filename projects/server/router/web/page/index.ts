import { Router, type Request, type Response } from 'express';
import { plugins } from '../../../plugin/load.ts';
import fs from 'node:fs';
import { load } from 'cheerio';
import path from 'node:path';
import { SERVER_ROOT } from '../../../common/env.ts';

/** /web/page */
const router = Router();
/** /web/page/lib */
const libRouter = Router();
router.use('/lib', libRouter);
/** /web/page/resources */
const resourcesRouter = Router();
router.use('/resources', resourcesRouter);

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const LIB_DIR = path.join(PUBLIC_DIR, 'lib');
const RESOURCES_DIR = path.join(PUBLIC_DIR, 'resources');
/** 相对 resources 的路径；过滤指定对象及其全部子路径。 */
const RESOURCE_FILTERS = ['macos'];

function isResourceFiltered(root: string, file: string) {
  const relative = path.relative(root, file).split(path.sep).join('/').toLowerCase();
  return RESOURCE_FILTERS.some(
    (filter) => relative === filter || relative.startsWith(filter + '/'),
  );
}

/** 查找最新库文件 */
function findLatestLibFile(): string | null {
  const files = fs.readdirSync(LIB_DIR);
  const webutilsFiles = files.filter((file) => /^scwcutils\.iife\.[a-zA-Z0-9]+\.js$/.test(file));
  if (webutilsFiles.length === 0) {
    return null;
  }
  // 按照时间戳排序, 取最新的文件
  const latestFile = webutilsFiles.sort((a, b) => {
    const aTimestamp = parseInt(a.split('.')[2], 36);
    const bTimestamp = parseInt(b.split('.')[2], 36);
    return bTimestamp - aTimestamp;
  })[0];
  return latestFile;
}

// 挂载 web utils 库静态资源
libRouter.get(/^\/scwcutils\.iife\.[a-zA-Z0-9]+\.js$/, (_req, res) => {
  // 查找最新的 scwcutils.iife.*.js 文件, * 是 36 进制的时间戳, 取最新的文件
  const latestFile = findLatestLibFile();
  if (!latestFile) {
    res.status(404).send('not found');
    return;
  }
  const filePath = path.join(LIB_DIR, latestFile);
  res.sendFile(filePath);
});

function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function sendDocument(res: Response, html: string) {
  const latest = findLatestLibFile();
  if (!latest) {
    res.type('html').send(html);
    return;
  }
  const document = load(html);
  if (!document('script[data-scwc-bootstrap]').length) {
    document('head').prepend(`<script data-scwc-bootstrap src="/web/page/lib/${latest}"></script>`);
  }
  res.type('html').send(document.html());
}
async function servePlugin(req: Request, res: Response) {
  const plugin = plugins.find((p) => p.pluginId === req.params.pluginDir);
  if (!plugin?.handler?.ui?.entry) {
    res.status(404).send('not found');
    return;
  }
  try {
    const pluginRoot = fs.realpathSync(plugin.pluginDir);
    const entry = fs.realpathSync(
      path.resolve(path.dirname(plugin.entryFile), plugin.handler.ui.entry),
    );
    if (!inside(pluginRoot, entry)) {
      res.status(403).send('invalid UI root');
      return;
    }
    const root = path.dirname(entry);
    const parts = (req.params.path ?? []) as unknown as string[];
    const candidate = path.resolve(root, ...parts);
    if (!inside(root, candidate)) {
      res.status(403).send('invalid path');
      return;
    }
    let file: string | undefined;
    try {
      const real = fs.realpathSync(candidate);
      if (!inside(root, real)) {
        res.status(403).send('invalid path');
        return;
      }
      if (fs.statSync(real).isFile()) {
        file = real;
      }
    } catch {
      /* Missing asset: consider the explicit SPA fallback below. */
    }
    const metadata = JSON.parse(
      await fs.promises.readFile(path.join(pluginRoot, 'package.json'), 'utf8'),
    );
    const ui = metadata.scwc?.ui;
    const suffix = parts.join('/');
    const htmlNavigation = Boolean(req.accepts('html'));
    const resource = (ui?.assetPrefix ?? ['assets/']).some((prefix: string) =>
      suffix.startsWith(prefix),
    );
    const fallback =
      ui?.spa === true
        ? htmlNavigation && !resource
        : ui?.spa === false
          ? false
          : !path.basename(suffix).includes('.');
    if (!parts.length || file === entry || (!file && fallback)) {
      const content =
        (await plugin.handler.ui.html?.()) ?? (await fs.promises.readFile(entry, 'utf8'));
      sendDocument(res, content);
      return;
    }
    if (!file) {
      res.status(404).send('not found');
      return;
    }
    res.sendFile(file);
  } catch {
    res
      .status(503)
      .type('html')
      .send(
        '<!doctype html><html data-scwc-error="ui-unavailable"><body>插件页面不可用，请查看构建任务。</body></html>',
      );
  }
}
router.get('/plugin/:pluginDir', servePlugin);
router.get('/plugin/:pluginDir/{*path}', servePlugin);

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

/** 错误页面模版 */
const errorPageTemplate = fs.readFileSync(
  path.join(SERVER_ROOT, 'router/web/page/worry.html'),
  'utf-8',
);

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

// 处理 /web/page/resources/* 的请求
// 返回对应的资源文件
resourcesRouter.get('/{*path}', (req: Request<{ path: string[] }>, res: Response) => {
  const paths = req.params.path ?? [];
  if (paths.some((p) => p.includes('..'))) {
    res.status(400).send('invalid path');
    return;
  }
  const suffix = paths.join('/').replaceAll('\\', '/');
  const resourceFullPath = path.resolve(RESOURCES_DIR, suffix);
  if (!inside(RESOURCES_DIR, resourceFullPath)) {
    res.status(400).send('invalid path');
    return;
  }
  if (isResourceFiltered(RESOURCES_DIR, resourceFullPath)) {
    res.status(404).send('not found');
    return;
  }
  try {
    const root = fs.realpathSync(RESOURCES_DIR);
    const file = fs.realpathSync(resourceFullPath);
    if (!inside(root, file) || isResourceFiltered(root, file) || !fs.statSync(file).isFile()) {
      res.status(404).send('not found');
      return;
    }
    res.sendFile(file);
  } catch {
    res.status(404).send('not found');
  }
});

export default router;
