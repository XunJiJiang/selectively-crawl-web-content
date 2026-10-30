import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { getUserScriptConfig } from '../user-script/config.ts';
import { websiteOrigin } from '../../shared/userscript-config.ts';
import { WorkbenchError } from '../workbench/storage.ts';

const tickets = new Map<string, { website: string; expires: number }>();
const router = Router();
// 此路由经核心 Bearer 鉴权；不提供工作台编辑接口，也不接受插件页面的会话 grant。
router.post('/config/sync', (req, res) => {
  try {
    const website = websiteOrigin(String(req.query.site));
    const origin = websiteOrigin(req.get('origin') || req.get('referer') || '');
    if (origin !== website || req.body?.snapshot?.website !== website) {
      throw new WorkbenchError('site_mismatch', '配置只能由对应网站的悬浮窗同步', 403);
    }
    const snapshot = getUserScriptConfig().sync(req.body.snapshot);
    let ticket: string | undefined;
    if (req.body.watch === true) {
      for (const [key, value] of tickets) {
        if (value.expires <= Date.now()) {
          tickets.delete(key);
        }
      }
      if (tickets.size >= 2000) {
        throw new WorkbenchError('too_many_connections', '配置连接过多', 503);
      }
      ticket = randomUUID();
      tickets.set(ticket, { website, expires: Date.now() + 30000 });
    }
    res.set('Cache-Control', 'no-store').json({ success: true, data: { snapshot, ticket } });
  } catch (error) {
    res
      .status(error instanceof WorkbenchError ? error.status : 400)
      .json({ success: false, message: error instanceof Error ? error.message : '配置同步失败' });
  }
});
export default router;

export function attachUserScriptConfigSockets(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      client.ping();
    }
  }, 20000);
  heartbeat.unref();
  server.once('close', () => {
    clearInterval(heartbeat);
    tickets.clear();
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close();
  });
  return (req: IncomingMessage, socket: Duplex, head: Buffer, url: URL) => {
    const key = url.searchParams.get('ticket') ?? '',
      ticket = tickets.get(key);
    tickets.delete(key);
    if (
      !ticket ||
      ticket.expires <= Date.now() ||
      req.headers.origin !== ticket.website ||
      wss.clients.size >= 2000
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      let alive = true;
      const send = (snapshot: unknown) => {
        if (client.bufferedAmount > 1024 * 1024) {
          client.terminate();
          return;
        }
        client.send(JSON.stringify({ type: 'config.changed', snapshot }));
      };
      const unsubscribe = getUserScriptConfig().subscribe(ticket.website, send);
      client.on('error', () => client.terminate());
      client.on('pong', () => {
        alive = true;
      });
      const check = setInterval(() => {
        if (!alive) {
          client.terminate();
        }
        alive = false;
      }, 45000);
      check.unref();
      client.once('close', () => {
        clearInterval(check);
        unsubscribe();
      });
      send(getUserScriptConfig().get(ticket.website));
    });
  };
}
