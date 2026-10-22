import type { Request, Response } from 'express';
import { WEB_ORIGIN } from '../../../common/setupParam.ts';

/** 开发页面由独立 Vite 服务提供；API、插件页面和事件由 Vite 转发回核心。 */
export function redirectDevelopmentPage(req: Request, res: Response) {
  const target = new URL(req.originalUrl, WEB_ORIGIN);
  if (target.pathname === '/web') {
    target.pathname = '/web/';
  }
  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, target.href);
}
