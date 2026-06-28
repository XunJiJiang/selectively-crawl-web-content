/**
 * 当 mode 为 'dev' 时, 通过端口转发的方式访问 web 项目
 * 静默转发
 * 将所有请求 ${HOST}:${PORT}/web/* 转发到 ${webHost}:${webPort}/*
 *
 * 未启用, 目前由 server 内部实现重定向
 */
import dotenv from 'dotenv';
import https from 'node:https';
import path from 'node:path';
import { ProxyAgent } from 'proxy-agent';

const __dirname = import.meta.dirname;

dotenv.config({
  path: path.join(__dirname, '..', '..', '..', '.env'),
});

// server 的端口和 host
const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;
const HOST = process.env.HOST ?? 'http://localhost';

export function needPortForwarding(mode: string) {
  return mode === 'dev';
}

export function startProxy(mode: string, webHost: string, webPort: number) {
  if (!needPortForwarding(mode)) {
    return;
  }

  const proxyAgent = new ProxyAgent({
    getProxyForUrl: (url) => {
      // 代理 /web/* 到 webHost:webPort/*
      if (url.startsWith(`${HOST}:${PORT}/web/`)) {
        const newUrl = url.replace(`${HOST}:${PORT}/web/`, `${webHost}:${webPort}/`);
        console.log(`代理请求: ${url} -> ${newUrl}`);
        return newUrl;
      }
      return '';
    },
  });

  /*
  https.get('https://jsonip.com', { agent }, (res) => {
  console.log(res.statusCode, res.headers);
  res.pipe(process.stdout);
});
*/

  https.get(`${HOST}:${PORT}/web/`, { agent: proxyAgent }, (res) => {
    res.pipe(process.stdout);
  });
}
