import { routeVersion } from '../version.ts';
import { uiAsset } from './workbench/declarative-ui.ts';
import { Router } from 'express';
import path from 'node:path';
import apiRouter from './api/index.ts';
import pageRouter from './page/index.ts';
import { isDev, isProd } from '../../common/setupParam.ts';
import { SERVER_ROOT } from '../../common/env.ts';
import { pluginResourceRouter } from './api/load.ts';
import { localConfig } from './local-config.ts';
import { redirectDevelopmentPage } from './workbench/dev-proxy.ts';
import { requireUserScript, userScriptPath } from '../../utils/user-script.ts';
import { installGuidePage } from '../../utils/extension-install-guide.ts';

/** /web */
const router = Router();
router.get('/local-config', routeVersion('3.2.0'), localConfig);
router.get('/browser-extension/install/:ticket', routeVersion('3.2.0'), (req, res) => {
  res.removeHeader('Access-Control-Allow-Origin');
  const page = installGuidePage(String(req.params.ticket));
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Content-Type-Options', 'nosniff');
  if (!page) {
    res
      .status(410)
      .type('text')
      .send('安装向导已过期，请重新执行 server install-extension 或 Web 的“安装浏览器扩展”。');
    return;
  }
  res.set('Content-Security-Policy', page.csp);
  res.type('html').send(page.html);
});
router.get('/userscript/scwc.user.js', routeVersion('3.2.0'), async (_req, res, next) => {
  try {
    await requireUserScript();
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').sendFile(userScriptPath);
  } catch (error) {
    next(error);
  }
});
router.get('/ui/assets/:pluginId/:owner/{*path}', routeVersion('3.2.0'), uiAsset);

/** 当前程序启动文件路径 */

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const WEB_DIR = path.join(PUBLIC_DIR, 'web');

if (isProd) {
  // 生产模式下, 挂载 /web 路径到 server/public/web 目录
  // 挂载 public/index.html
  router.get('/index.html', routeVersion('3.2.0'), (_req, res) => {
    const indexHtmlPath = path.join(WEB_DIR, 'index.html');
    res.sendFile(indexHtmlPath);
  });
  // 重载 / 请求到 /index.html
  router.get('/', routeVersion('3.2.0'), (_req, res) => {
    const indexHtmlPath = path.join(WEB_DIR, 'index.html');
    res.sendFile(indexHtmlPath);
  });
  // 处理 /assets/* 的请求
  router.get('/assets/{*path}', routeVersion('3.2.0'), (req, res) => {
    const assetPath = req.path.replace('/assets/', '');
    const filePath = path.join(WEB_DIR, 'assets', assetPath);
    res.sendFile(filePath);
  });
}

router.use('/api', apiRouter);
router.use('/resource/plugin', pluginResourceRouter);
router.use('/page', pageRouter);
if (isDev) {
  router.get(['/', '/index.html'], routeVersion('3.2.0'), redirectDevelopmentPage);
}

export default router;
