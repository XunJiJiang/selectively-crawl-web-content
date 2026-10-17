import { Router } from 'express';
import path from 'node:path';
import apiRouter from './api/index.ts';
import pageRouter from './page/index.ts';
import { isDev, isProd } from '../../common/setupParam.ts';
import { SERVER_ROOT } from '../../common/env.ts';
import { pluginResourceRouter } from './api/load.ts';
import { localConfig } from './local-config.ts';
import { proxyDevelopmentPage } from './workbench/dev-proxy.ts';

/** /web */
const router = Router();
router.get('/local-config', localConfig);

/** 当前程序启动文件路径 */

const PUBLIC_DIR = path.join(SERVER_ROOT, 'public');
const WEB_DIR = path.join(PUBLIC_DIR, 'web');

if (isProd) {
  // 生产模式下, 挂载 /web 路径到 server/public/web 目录
  // 挂载 public/index.html
  router.get('/index.html', (req, res) => {
    const indexHtmlPath = path.join(WEB_DIR, 'index.html');
    res.sendFile(indexHtmlPath);
  });
  // 重载 / 请求到 /index.html
  router.get('/', (req, res) => {
    const indexHtmlPath = path.join(WEB_DIR, 'index.html');
    res.sendFile(indexHtmlPath);
  });
  // 处理 /assets/* 的请求
  router.get('/assets/{*path}', (req, res) => {
    const assetPath = req.path.replace('/assets/', '');
    const filePath = path.join(WEB_DIR, 'assets', assetPath);
    res.sendFile(filePath);
  });
}

router.use('/api', apiRouter);
router.use('/resource/plugin', pluginResourceRouter);
router.use('/page', pageRouter);
if (isDev) {
  router.get(
    [
      '/',
      '/index.html',
      '/assets/{*path}',
      '/src/{*path}',
      '/@vite/{*path}',
      '/@id/{*path}',
      '/@fs/{*path}',
      '/node_modules/{*path}',
      '/style.css',
      '/var.css',
    ],
    proxyDevelopmentPage,
  );
}

export default router;
