import http from 'node:http';
import type { Request, Response } from 'express';
import type { Duplex } from 'node:stream';

/** Only the shell's development resources go to Vite; credentials stay on the core. */
export function proxyDevelopmentPage(req: Request, res: Response) {
  const upstream = http.request(
    {
      hostname: '127.0.0.1',
      port: 3201,
      path: req.originalUrl,
      method: 'GET',
      headers: { accept: req.get('accept') ?? '*/*', host: 'localhost:3201' },
    },
    (response) => {
      res.status(response.statusCode ?? 502);
      for (const [key, value] of Object.entries(response.headers)) {
        if (
          value !== undefined &&
          !['connection', 'transfer-encoding', 'access-control-allow-origin'].includes(key)
        ) {
          res.setHeader(key, value);
        }
      }
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) {
      res.status(502).send('Vite 开发服务未启动');
    } else {
      res.destroy();
    }
  });
  req.once('aborted', () => upstream.destroy());
  upstream.end();
}
export function proxyDevelopmentUpgrade(req: http.IncomingMessage, socket: Duplex, head: Buffer) {
  const upstream = http.request({
    hostname: '127.0.0.1',
    port: 3201,
    path: req.url,
    headers: { ...req.headers, host: 'localhost:3201' },
  });
  upstream.once('upgrade', (response, remote, initial) => {
    socket.write(
      `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n` +
        Object.entries(response.headers)
          .map(([key, value]) => `${key}: ${value}\r\n`)
          .join('') +
        '\r\n',
    );
    if (initial.length) {
      socket.write(initial);
    }
    if (head.length) {
      remote.write(head);
    }
    remote.pipe(socket).pipe(remote);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
    socket.once('close', () => remote.destroy());
  });
  upstream.on('error', () => socket.destroy());
  upstream.on('response', () => socket.destroy());
  socket.once('close', () => upstream.destroy());
  upstream.end();
}
