import type { Request, Response } from 'express';
import { HOST, TOKEN } from '../../common/env.ts';

function isLoopback(address: string | undefined) {
  const host = address?.replace(/^::ffff:/, '');
  return host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host ?? '');
}

/** 只向直接访问本机服务的同源页面提供启动配置。 */
export function localConfig(req: Request, res: Response) {
  res.removeHeader('Access-Control-Allow-Origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin, Referer, Sec-Fetch-Site');

  try {
    const serverUrl = new URL(HOST);
    serverUrl.port = String(req.socket.localPort);
    const requestUrl = new URL(`${req.protocol}://${req.get('Host')}`);
    const sources = [req.get('Origin'), req.get('Referer')].filter((source): source is string =>
      Boolean(source),
    );
    const fetchSite = req.get('Sec-Fetch-Site');
    if (
      !isLoopback(serverUrl.hostname) ||
      !isLoopback(req.socket.remoteAddress) ||
      requestUrl.origin !== serverUrl.origin ||
      req.get('X-SCWC-Local-Config') !== '1' ||
      (fetchSite && fetchSite !== 'same-origin') ||
      sources.length === 0 ||
      sources.some((source) => new URL(source).origin !== serverUrl.origin)
    ) {
      res.status(403).json({ success: false, message: '仅允许本机同源页面加载配置' });
      return;
    }
    res.json({
      success: true,
      message: 'success',
      data: {
        host: `${serverUrl.protocol}//${serverUrl.hostname}`,
        port: serverUrl.port || (serverUrl.protocol === 'https:' ? '443' : '80'),
        token: TOKEN,
      },
    });
  } catch {
    res.status(403).json({ success: false, message: '仅允许本机同源页面加载配置' });
  }
}
