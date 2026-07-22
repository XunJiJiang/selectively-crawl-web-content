import { Router } from 'express';
import path from 'node:path';
import apiRouter from './api/index.ts';
import pageRouter from './page/index.ts';
import { isDev, isProd } from '../../common/setupParam.ts';
import { SERVER_ROOT } from '../../common/env.ts';

/** /web */
const router = Router();

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

if (isDev) {
  // 开发模式下, 单独启动 vite dev server, 通过端口转发的方式访问 web 项目
  // 静默转发, 将所有请求 /web/* 转发到 web 项目
  router.get('/index.html', (req, res) => {
    const webUrl = `http://localhost:3201/index.html`;
    res.redirect(webUrl);
  });
  router.get('/', (req, res) => {
    const webUrl = `http://localhost:3201/index.html`;
    res.redirect(webUrl);
  });
  router.get('/assets/{*path}', (req, res) => {
    const assetPath = req.path.replace('/assets/', '');
    const webUrl = `http://localhost:3201/assets/${assetPath}`;
    res.redirect(webUrl);
  });
}

router.use('/api', apiRouter);
router.use('/page', pageRouter);

export default router;
