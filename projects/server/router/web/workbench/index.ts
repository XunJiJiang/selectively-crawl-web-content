import { declarativeUI } from '../../../workbench/declarative-ui.ts';
import { declarativeRouter } from './declarative-ui.ts';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { getWorkbench } from '../../../workbench/runtime.ts';
import { pluginCatalog } from '../../../workbench/catalog.ts';
import { getPluginConfig } from '../../../workbench/plugin-config.ts';
import { pageSessions, requestOrigin, type PageSession } from '../../../workbench/page-sessions.ts';
import { plugins } from '../../../plugin/load.ts';
import { assert, coreBootId, WorkbenchError } from '../../../workbench/storage.ts';
import { identifier } from '../../../workbench/workspace.ts';
import { feedbackRequest } from '../../../workbench/feedback.ts';
import { workbenchEvents } from '../../../workbench/events.ts';
import { openUserScriptInstaller } from '../../../utils/user-script.ts';
import { isLoopbackHostname } from '../../../../shared/system-notifications.ts';

export function resolvePluginUrl(value: string, pluginId: string | undefined, origin: string) {
  z.string().min(1).max(16384).parse(value);
  const url = new URL(
    value,
    pluginId ? `${origin}/web/page/plugin/${encodeURIComponent(pluginId)}/` : origin,
  );
  assert(
    url.origin === origin && !url.username && !url.password,
    'external_url',
    'URL不属于当前核心',
  );
  const match = url.pathname.match(/^\/web\/page\/plugin\/([^/]+)(\/.*)?$/);
  assert(match, 'invalid_url', 'URL不是插件页面');
  const id = decodeURIComponent(match[1]);
  identifier.parse(id);
  assert(!pluginId || id === pluginId, 'plugin_mismatch', 'URL不属于目标插件', 403);
  return {
    pluginId: id,
    url: url.href,
    locator: {
      installationId: getWorkbench().storage.installationId,
      pluginId: id,
      path: match[2] ?? '/',
      search: url.search,
      hash: url.hash,
    },
  };
}
function owner(req: Request) {
  return identifier.parse(req.get('x-scwc-client-window'));
}
function page(res: Response) {
  return res.locals.pageSession as PageSession | undefined;
}
function feedbackOwner(req: Request, res: Response) {
  const s = page(res);
  return s
    ? { source: 'page' as const, pluginId: s.pluginId, tabId: s.tabId, ownerId: s.frameEpoch }
    : { source: 'core' as const, pluginId: null, ownerId: owner(req) };
}
function lease(req: Request) {
  return z
    .string()
    .min(1)
    .parse(req.body?.lease ?? req.get('x-scwc-lease'));
}
function revision(value: unknown) {
  return z.number().int().nonnegative().parse(value);
}
function key(req: Request) {
  return identifier.parse(req.body?.idempotencyKey ?? req.body?.operationId);
}
function pageList(
  req: Request,
  items: { pluginId?: string | null; tab?: { pluginId?: string }; runtime?: { status?: string } }[],
) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(req.query.limit ?? 50);
  const filters = {
    search: String(req.query.search ?? ''),
    pluginId: String(req.query.pluginId ?? ''),
    status: String(req.query.status ?? ''),
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(filters)).digest('hex');
  let offset = 0;
  if (req.query.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(String(req.query.cursor), 'base64url').toString());
      assert(
        cursor.fingerprint === fingerprint &&
          Number.isSafeInteger(cursor.offset) &&
          cursor.offset >= 0,
        'stale_cursor',
        '分页条件已变化',
        409,
      );
      offset = cursor.offset;
    } catch (e) {
      if (e instanceof WorkbenchError) {
        throw e;
      }
      throw new WorkbenchError('invalid_cursor', '分页游标无效');
    }
  }
  const rows = items.filter(
    (i) =>
      (!filters.pluginId || (i.pluginId ?? i.tab?.pluginId) === filters.pluginId) &&
      (!filters.status || i.runtime?.status === filters.status) &&
      (!filters.search || JSON.stringify(i).toLowerCase().includes(filters.search.toLowerCase())),
  );
  return {
    items: rows.slice(offset, offset + limit),
    nextCursor:
      offset + limit < rows.length
        ? Buffer.from(JSON.stringify({ fingerprint, offset: offset + limit })).toString('base64url')
        : null,
    total: rows.length,
  };
}
export function createWorkbenchRouter() {
  const router = Router();
  router.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set('X-Request-Id', res.locals.requestId);
    res.set('Cache-Control', 'no-store');
    try {
      res.locals.origin = requestOrigin(req);
      next();
    } catch (e) {
      next(e);
    }
  });
  const route = (
    method: 'get' | 'post',
    path: string,
    run: (req: Request, res: Response) => unknown | Promise<unknown>,
    status = 200,
  ) =>
    router[method](path, async (req, res, next) => {
      try {
        const data = await run(req, res);
        if (!res.headersSent) {
          res.status(status).json({
            success: true,
            message: 'success',
            code: 'ok',
            requestId: res.locals.requestId,
            data,
          });
        }
      } catch (e) {
        next(e);
      }
    });
  route('post', '/userscript/install', async (req, res) => {
    assert(!page(res), 'grant_scope', '普通页面授权不能打开系统浏览器', 403);
    owner(req);
    try {
      return await openUserScriptInstaller();
    } catch (error) {
      throw new WorkbenchError(
        'userscript_install_failed',
        error instanceof Error ? error.message : '油猴脚本安装唤起失败',
        503,
      );
    }
  });
  route('get', '/bootstrap', (_req) => {
    const w = getWorkbench();
    return {
      installationId: w.storage.installationId,
      coreBootId,
      profile: 'local',
      capabilities: {
        workspaces: true,
        config: true,
        commands: true,
        events: true,
        snapshots: true,
        declarativeUI: 1,
        pluginPageAPI: 2,
        configurationWriteFromPage: false,
      },
      catalogRevision: pluginCatalog.revision,
      preferences: w.workspace.preferences(),
      systemNotifications: w.systemNotifications.status(),
      commands: w.commands.commands(),
    };
  });
  route('get', '/plugins', async (req, res) => {
    const items = await pluginCatalog.list();
    const etag = `"${createHash('sha256').update(JSON.stringify(items)).digest('hex')}"`;
    res.set('ETag', etag);
    if (req.get('if-none-match') === etag) {
      res.status(304).end();
      return;
    }
    return pageList(req, items);
  });
  route(
    'post',
    '/plugins/rescan',
    (req) => getWorkbench().operations.start('', 'rescan', key(req)),
    202,
  );
  route(
    'post',
    '/plugins/:id/actions',
    (req) =>
      getWorkbench().operations.start(
        String(req.params.id),
        z.string().parse(req.body.action),
        key(req),
      ),
    202,
  );
  route('get', '/jobs', () => getWorkbench().operations.list());
  route('get', '/jobs/:id', (req, res) =>
    page(res)
      ? feedbackRequest(feedbackOwner(req, res), `/jobs/${req.params.id}`, undefined)
      : getWorkbench().operations.get(String(req.params.id)),
  );
  route('post', '/jobs/:id/cancel', (req, res) =>
    page(res)
      ? feedbackRequest(feedbackOwner(req, res), `/jobs/${req.params.id}/cancel`, req.body)
      : getWorkbench().operations.cancel(String(req.params.id), revision(req.body.baseRevision)),
  );
  route('post', '/jobs/ack', (req) => {
    getWorkbench().operations.acknowledge(req.body.ids);
    return { acknowledged: true };
  });
  for (const path of ['/tasks/create', '/tasks/start', '/tasks/:id/update']) {
    route('post', path, (req, res) => feedbackRequest(feedbackOwner(req, res), req.path, req.body));
  }
  route('get', '/tasks/:id', (req, res) =>
    feedbackRequest(feedbackOwner(req, res), req.path, undefined),
  );
  route('post', '/feedback/release', (req, res) => {
    const identity = feedbackOwner(req, res);
    if (identity.ownerId) {
      getWorkbench().notifications.releaseOwner(identity.ownerId);
      getWorkbench().operations.releaseOwner(identity.ownerId);
    }
    return { released: true };
  });
  route('post', '/url/resolve', async (req, res) => {
    const result = resolvePluginUrl(req.body.url, req.body.pluginId, res.locals.origin);
    await pluginCatalog.require(result.pluginId);
    return result;
  });
  route('post', '/workspaces/:id/lease', (req) =>
    getWorkbench().workspace.lease(
      String(req.params.id),
      owner(req),
      z.enum(['acquire', 'renew', 'release']).parse(req.body.action),
      req.body.lease,
    ),
  );
  route('get', '/workspaces/:id', (req) => {
    const w = getWorkbench();
    return {
      ...w.workspace.get(String(req.params.id)),
      ...w.commands.state(String(req.params.id)),
    };
  });
  route('post', '/workspaces/:id/save', (req, res) => {
    const s = req.body.snapshot;
    for (const tab of s?.tabs ?? []) {
      if (tab.kind === 'plugin') {
        resolvePluginUrl(tab.url, tab.pluginId, res.locals.origin);
      }
    }
    return getWorkbench().workspace.save(
      String(req.params.id),
      s,
      revision(req.body.baseRevision),
      owner(req),
      lease(req),
      key(req),
    );
  });
  route('post', '/workspaces/:id/close-tabs', (req) =>
    getWorkbench().workspace.closeTabs(
      String(req.params.id),
      req.body.tabIds,
      revision(req.body.baseRevision),
      owner(req),
      lease(req),
      key(req),
    ),
  );
  route('post', '/bookmarks/move', (req) => getWorkbench().workspace.moveBookmark(req.body));
  route('get', '/preferences', () => getWorkbench().workspace.preferences());
  route('post', '/preferences', (req) =>
    getWorkbench().workspace.setPreferences(
      req.body.values,
      revision(req.body.baseRevision),
      req.body.reset,
    ),
  );
  route('get', '/bookmarks', (req) => pageList(req, getWorkbench().workspace.bookmarks()));
  route('post', '/bookmarks', (req, res) => {
    resolvePluginUrl(req.body.value?.url, req.body.value?.pluginId, res.locals.origin);
    return getWorkbench().workspace.bookmark(req.body.value);
  });
  route('post', '/bookmarks/:id/update', (req, res) => {
    resolvePluginUrl(req.body.value?.url, req.body.value?.pluginId, res.locals.origin);
    return getWorkbench().workspace.bookmark(
      req.body.value,
      String(req.params.id),
      revision(req.body.baseRevision),
    );
  });
  route('post', '/bookmarks/:id/delete', (req) =>
    getWorkbench().workspace.bookmark(
      undefined,
      String(req.params.id),
      revision(req.body.baseRevision),
      true,
    ),
  );
  route('get', '/history', (req) => pageList(req, getWorkbench().workspace.history()));
  route('post', '/history/delete', (req) => {
    getWorkbench().workspace.deleteHistory(req.body.closeIds);
    return { deleted: true };
  });
  route('post', '/history/restore', (req) => {
    const ids =
      req.body.closeIds ??
      getWorkbench()
        .workspace.history()
        .filter((h) => h.batchId === req.body.batchId)
        .map((h) => h.closeId);
    return getWorkbench().workspace.restore(
      req.body.workspaceId,
      ids,
      req.body.groupId,
      revision(req.body.baseRevision),
      owner(req),
      lease(req),
      key(req),
    );
  });
  route('get', '/plugins/:id/config', (req) => getPluginConfig().snapshot(String(req.params.id)));
  for (const path of ['/plugins/:id/config/definitions', '/plugins/:id/config/validation']) {
    route('post', path, () => {
      throw new WorkbenchError(
        'page_configuration_removed',
        '页面配置写入与校验能力已移除，请由插件后端注册定义和校验器',
        410,
      );
    });
  }
  for (const action of ['update', 'reset']) {
    route('post', `/plugins/:id/config/${action}`, async (req, res) => {
      assert(!page(res), 'grant_scope', '页面授权不能写入配置', 403);
      const pluginId = String(req.params.id),
        values = action === 'reset' ? {} : req.body.values,
        keys = action === 'reset' ? req.body.keys : [];
      return getPluginConfig().update(pluginId, values, {
        baseRevision: revision(req.body.baseRevision),
        schemaRevision: revision(req.body.schemaRevision),
        reset: keys,
        originRequestId: req.body.originRequestId,
        verifiedDefinitions: true,
      });
    });
  }
  route('post', '/page-sessions', async (req, res) => {
    const w = getWorkbench(),
      id = identifier.parse(req.body.pluginId),
      tabId = identifier.parse(req.body.tabId ?? randomUUID()),
      frameEpoch = identifier.parse(req.body.frameEpoch),
      client = owner(req);
    const resolved = resolvePluginUrl(req.body.url, id, res.locals.origin);
    await pluginCatalog.require(id);
    if (req.body.workspaceId) {
      w.workspace.checkLease(req.body.workspaceId, client, lease(req));
      const tab = w.workspace.get(req.body.workspaceId).snapshot.tabs.find((t) => t.id === tabId);
      assert(tab?.kind === 'plugin' && tab.pluginId === id, 'page_owner', '工作区页面不匹配', 403);
    }
    const plugin = plugins.find((p) => p.pluginId === id);
    assert(plugin?.handler?.ui, 'plugin_unavailable', '插件页面不可用', 409);
    return pageSessions.create({
      pluginId: id,
      safeId: plugin.safeId,
      tabId,
      frameEpoch,
      owner: client,
      workspaceId: req.body.workspaceId,
      origin: new URL(resolved.url).origin,
    });
  });
  route('post', '/snapshots', (req, res) => {
    const session = page(res);
    const pluginId = session?.pluginId ?? identifier.parse(req.body.pluginId),
      tabId = session?.tabId ?? identifier.parse(req.body.owner);
    if (!session) {
      const w = getWorkbench();
      w.workspace.checkLease(req.body.workspaceId, owner(req), lease(req));
      assert(
        w.workspace
          .get(req.body.workspaceId)
          .snapshot.tabs.some(
            (t) => t.id === tabId && t.kind === 'plugin' && t.pluginId === pluginId,
          ),
        'page_owner',
        '快照页面不匹配',
        403,
      );
    }
    return getWorkbench().snapshot(
      { kind: req.body.kind, owner: tabId, pluginId, metadata: req.body.metadata },
      Buffer.from(
        req.body.kind === 'preview'
          ? z
              .string()
              .max(3 * 1024 * 1024)
              .parse(req.body.pngBase64)
          : JSON.stringify(req.body.state),
        req.body.kind === 'preview' ? 'base64' : 'utf8',
      ),
    );
  });
  route('post', '/snapshots/preview', (req, res) => {
    const session = page(res),
      pluginId = session?.pluginId ?? identifier.parse(req.query.pluginId),
      tabId = session?.tabId ?? identifier.parse(req.query.tabId);
    assert(Buffer.isBuffer(req.body), 'invalid_image', '请以image/png上传预览');
    if (!session) {
      const w = getWorkbench(),
        workspaceId = identifier.parse(req.query.workspaceId);
      w.workspace.checkLease(workspaceId, owner(req), lease(req));
      assert(
        w.workspace
          .get(workspaceId)
          .snapshot.tabs.some(
            (t) => t.id === tabId && t.kind === 'plugin' && t.pluginId === pluginId,
          ),
        'page_owner',
        '预览页面不匹配',
        403,
      );
    }
    return getWorkbench().snapshot({ kind: 'preview', owner: tabId, pluginId }, req.body);
  });
  route('get', '/snapshots/:id', (req, res) => {
    const s = page(res),
      row = getWorkbench().getSnapshot(String(req.params.id), s?.tabId, s?.pluginId);
    if (row.kind === 'preview') {
      res.type('png').send(row.payload);
      return;
    }
    return {
      id: row.id,
      checksum: row.checksum,
      metadata: JSON.parse(row.metadata_json),
      state: JSON.parse(row.payload.toString()),
    };
  });
  route('post', '/snapshots/:id/delete', (req, res) =>
    getWorkbench().deleteSnapshot(String(req.params.id), page(res)?.tabId, page(res)?.pluginId),
  );
  route('get', '/terminals', (req) =>
    getWorkbench().commands.terminals(z.string().parse(req.query.workspaceId)),
  );
  route('post', '/terminals', (req) =>
    getWorkbench().commands.saveTerminal(
      req.body.workspaceId,
      owner(req),
      lease(req),
      req.body.terminal,
    ),
  );
  for (const action of ['close', 'restore', 'clear-output', 'clear-history']) {
    route('post', `/terminals/:id/${action}`, (req) =>
      getWorkbench().commands.alterTerminal(
        req.body.workspaceId,
        owner(req),
        lease(req),
        String(req.params.id),
        action,
      ),
    );
  }
  route('get', '/terminals/:id/output', (req) => {
    const id = String(req.params.id);
    if (id !== 'public') {
      getWorkbench().commands.terminal(id, z.string().parse(req.query.workspaceId));
    }
    return getWorkbench().commands.outputPage(
      id,
      z.coerce
        .number()
        .int()
        .nonnegative()
        .parse(req.query.after ?? 0),
      z.coerce
        .number()
        .int()
        .min(1)
        .max(500)
        .parse(req.query.limit ?? 100),
    );
  });
  route(
    'post',
    '/commands/execute',
    (req) =>
      getWorkbench().commands.execute(
        req.body.workspaceId,
        owner(req),
        lease(req),
        req.body.terminalId,
        req.body.command,
        key(req),
      ),
    202,
  );
  route('post', '/commands/complete', async (req, res) => {
    const controller = new AbortController();
    const close = () => controller.abort();
    res.once('close', close);
    try {
      return await getWorkbench().commands.complete(
        req.body.workspaceId,
        owner(req),
        lease(req),
        req.body.terminalId,
        z.string().max(65536).parse(req.body.command),
        req.body.cursor,
        controller.signal,
      );
    } finally {
      res.off('close', close);
    }
  });
  route('post', '/commands/cancel', (req) =>
    getWorkbench().commands.cancel(
      req.body.workspaceId,
      owner(req),
      lease(req),
      req.body.terminalId,
      req.body.executionId,
      req.body.coreBootId,
      req.body.force === true,
    ),
  );
  route('post', '/commands/input', (req) =>
    getWorkbench().commands.input(
      req.body.workspaceId,
      owner(req),
      lease(req),
      req.body.requestId,
      req.body.terminalId,
      req.body.executionId,
      req.body.coreBootId,
      req.body.value,
    ),
  );
  route('get', '/notifications', (req) => pageList(req, getWorkbench().notifications.list()));
  route('post', '/system-notifications/presence', (req, res) => {
    assert(!page(res), 'grant_scope', '普通页面授权不能上报工作台聚焦', 403);
    const viewer = owner(req);
    const focused = z.boolean().parse(req.body.focused);
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
    if (isLoopbackHostname(peer) && isLoopbackHostname(new URL(res.locals.origin).hostname)) {
      getWorkbench().systemNotifications.presence(viewer, focused);
    }
    return { accepted: true };
  });
  route('post', '/notifications/ack', (req) => {
    getWorkbench().notifications.change(req.body.ids);
    return { acknowledged: true };
  });
  route('post', '/notifications/delete', (req) => {
    getWorkbench().notifications.change(req.body.ids, true);
    return { deleted: true };
  });
  route('post', '/notifications/publish', (req, res) => {
    const origin = feedbackOwner(req, res);
    return feedbackRequest(origin, req.path, req.body, (id, actionId) => {
      workbenchEvents.publish('notification.action', { id, actionId, ...origin }, id);
    });
  });
  route('post', '/notifications/visibility', (req) =>
    getWorkbench().notifications.visibility(owner(req), req.body.ids),
  );
  for (const action of ['update', 'read', 'close']) {
    route('post', `/notifications/:id/${action}`, (req, res) =>
      feedbackRequest(feedbackOwner(req, res), req.path, req.body),
    );
  }
  route('get', '/notifications/:id', (req, res) =>
    feedbackRequest(feedbackOwner(req, res), req.path, undefined),
  );
  route('post', '/notifications/:id/actions/:actionId', (req) =>
    getWorkbench().notifications.invoke(String(req.params.id), String(req.params.actionId)),
  );
  route('post', '/stream-ticket', (req, res) => {
    const s = page(res);
    if (req.body.workspaceId) {
      getWorkbench().workspace.checkLease(req.body.workspaceId, owner(req), lease(req));
    }
    return {
      ticket: pageSessions.ticket(
        res.locals.origin,
        s?.owner ?? owner(req),
        s,
        req.body.workspaceId,
      ),
      expiresIn: 30,
      coreBootId,
    };
  });
  route('get', '/inspector', async (req, res) => {
    assert(!page(res), 'grant_scope', '普通页面授权不能读取 inspector', 403);
    const workspaceId = identifier.parse(req.query.workspaceId),
      tabId = req.query.tabId ? identifier.parse(req.query.tabId) : null;
    const snapshot = getWorkbench().workspace.get(workspaceId).snapshot;
    const tab = tabId ? snapshot.tabs.find((t) => t.id === tabId) : undefined;
    const pluginId = tab?.kind === 'plugin' ? tab.pluginId : identifier.parse(req.query.pluginId);
    assert(!tabId || tab?.kind === 'plugin', 'page_owner', '当前标签不是插件页面', 403);
    await pluginCatalog.require(pluginId);
    return declarativeUI.project({ pluginId, workspaceId, tabId, windowId: owner(req) });
  });
  for (const action of ['update', 'reset']) {
    route('post', `/inspector/config/${action}`, async (req, res) => {
      assert(!page(res), 'grant_scope', '普通页面授权不能写入 inspector', 403);
      const instance = declarativeUI.get(identifier.parse(req.body.instanceId), owner(req));
      assert(instance.surface === 'currentPage', 'page_owner', '需要核心当前页面模板实例', 403);
      getWorkbench().workspace.checkLease(instance.workspaceId, owner(req), lease(req));
      return declarativeUI.execute(instance.id, owner(req), req.body);
    });
  }
  router.use('/ui', declarativeRouter());
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status =
      error instanceof WorkbenchError ? error.status : error instanceof z.ZodError ? 400 : 500;
    res.status(status).json({
      success: false,
      message:
        status === 500 ? '工作台服务错误' : error instanceof Error ? error.message : String(error),
      code:
        error instanceof WorkbenchError
          ? error.code
          : error instanceof z.ZodError
            ? 'invalid_request'
            : 'internal_error',
      requestId: res.locals.requestId,
      data: error instanceof WorkbenchError ? error.details : undefined,
    });
  });
  return router;
}
export default createWorkbenchRouter();
