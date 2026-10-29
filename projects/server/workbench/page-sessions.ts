import { randomBytes, randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { assert } from './storage.ts';
export interface PageSession {
  id: string;
  grant: string;
  pluginId: string;
  safeId: string;
  tabId: string;
  frameEpoch: string;
  owner: string;
  workspaceId?: string;
  origin: string;
  expiresAt: number;
}
export class PageSessions {
  private sessions = new Map<string, PageSession>();
  private tickets = new Map<
    string,
    { origin: string; owner: string; page?: PageSession; workspaceId?: string; expiresAt: number }
  >();
  create(input: Omit<PageSession, 'id' | 'grant' | 'expiresAt'>) {
    this.prune();
    assert(this.sessions.size < 2000, 'quota_exceeded', '页面会话数量超限', 429);
    for (const [key, s] of this.sessions) {
      if (s.owner === input.owner && s.tabId === input.tabId) {
        this.sessions.delete(key);
      }
    }
    const session = {
      ...input,
      id: randomUUID(),
      grant: randomBytes(32).toString('base64url'),
      expiresAt: Date.now() + 300000,
    };
    this.sessions.set(session.grant, session);
    return session;
  }
  get(grant: string, origin: string) {
    const session = this.sessions.get(grant);
    assert(
      session && session.expiresAt > Date.now() && session.origin === origin,
      'invalid_grant',
      '页面授权无效或过期',
      403,
    );
    return session;
  }
  revoke(pluginId: string) {
    for (const [key, s] of this.sessions) {
      if (s.pluginId === pluginId) {
        this.sessions.delete(key);
      }
    }
  }
  authorize(req: Request, origin: string) {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const session = this.get(token, origin),
      prefix = '/web/api/workbench';
    const path = req.path;
    const config = `${prefix}/plugins/${encodeURIComponent(session.pluginId)}/config`;
    const allowed =
      (req.method === 'GET' && path === config) ||
      path === `${prefix}/stream-ticket` ||
      path === `${prefix}/feedback/release` ||
      path === `${prefix}/notifications/publish` ||
      /^\/web\/api\/workbench\/notifications\/[0-9a-f-]{36}(?:\/(?:update|read|close))?$/.test(
        path,
      ) ||
      /^\/web\/api\/workbench\/tasks\/(?:create|start|[^/]+(?:\/update)?)$/.test(path) ||
      /^\/web\/api\/workbench\/jobs\/[0-9a-f-]{36}(?:\/cancel)?$/.test(path) ||
      path === `${prefix}/snapshots` ||
      /^\/web\/api\/workbench\/snapshots\/[^/]+(?:\/delete)?$/.test(path) ||
      path.startsWith(`/web/api/plugin/${session.safeId}/`);
    assert(allowed, 'grant_scope', '页面授权不允许此操作', 403);
    return session;
  }
  ticket(origin: string, owner: string, page?: PageSession, workspaceId?: string) {
    this.prune();
    assert(this.tickets.size < 2000, 'quota_exceeded', '连接票据过多', 429);
    const token = randomBytes(32).toString('base64url');
    this.tickets.set(token, { origin, owner, page, workspaceId, expiresAt: Date.now() + 30000 });
    return token;
  }
  consume(token: string, origin: string) {
    const ticket = this.tickets.get(token);
    this.tickets.delete(token);
    assert(
      ticket && ticket.expiresAt > Date.now() && ticket.origin === origin,
      'invalid_ticket',
      '连接票据无效',
      401,
    );
    if (ticket.page) {
      this.get(ticket.page.grant, origin);
    }
    return ticket;
  }
  private prune() {
    for (const [k, v] of this.sessions) {
      if (v.expiresAt <= Date.now()) {
        this.sessions.delete(k);
      }
    }
    for (const [k, v] of this.tickets) {
      if (v.expiresAt <= Date.now()) {
        this.tickets.delete(k);
      }
    }
  }
}
export const pageSessions = new PageSessions();
export function requestOrigin(req: Request) {
  const expected = new URL(`${req.protocol}://${req.get('host')}`).origin;
  const sources = [req.get('origin'), req.get('referer')].filter(Boolean) as string[];
  assert(
    sources.length &&
      sources.every((s) => {
        try {
          return new URL(s).origin === expected;
        } catch {
          return false;
        }
      }),
    'origin_mismatch',
    '请求来源必须与核心精确同源',
    403,
  );
  assert(
    !req.get('sec-fetch-site') || ['same-origin', 'none'].includes(req.get('sec-fetch-site') ?? ''),
    'origin_mismatch',
    '拒绝跨站请求',
    403,
  );
  return expected;
}
