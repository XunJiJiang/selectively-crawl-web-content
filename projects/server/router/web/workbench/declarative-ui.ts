import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { declarativeUI } from '../../../workbench/declarative-ui.ts';
import { getWorkbench } from '../../../workbench/runtime.ts';
import { pluginCatalog } from '../../../workbench/catalog.ts';
import { UIError, uiAssert, type UISurface } from '../../../../shared/declarative-ui.ts';

function windowId(req: Request) {
  return z.string().min(1).max(200).parse(req.get('x-scwc-client-window'));
}
export function declarativeRouter() {
  const router = Router();
  router.use((_req, res, next) => {
    uiAssert(!res.locals.pageSession, 'UI_RESOURCE_DENIED', '普通页面授权不能调用声明式 UI 接口');
    next();
  });
  const route = (
    method: 'get' | 'post' | 'delete',
    url: string,
    run: (req: Request, res: Response) => unknown | Promise<unknown>,
  ) =>
    router[method](url, async (req, res, next) => {
      try {
        const data = await run(req, res);
        res.json({ success: true, message: 'success', code: 'ok', data });
      } catch (e) {
        next(e);
      }
    });
  const requireLease = (req: Request) => {
    const owner = windowId(req),
      instance = declarativeUI.get(String(req.params.id), owner);
    getWorkbench().workspace.checkLease(
      instance.workspaceId,
      owner,
      String(req.body?.lease ?? req.get('x-scwc-lease') ?? ''),
    );
    return owner;
  };
  route('get', '/registry', (req) => declarativeUI.registry(windowId(req)));
  route('post', '/instances', async (req) => {
    const body = z
      .object({
        pluginId: z.string().min(1),
        surface: z.enum([
          'mainSidebar',
          'auxiliarySidebar',
          'statusBar',
          'tooltip',
          'contextMenu',
          'currentPage',
        ]),
        viewId: z.string(),
        workspaceId: z.string(),
        lease: z.string().optional(),
        tabId: z.string().nullable().default(null),
        sourceTabId: z.string().nullable().default(null),
        sourceFrameEpoch: z.string().nullable().default(null),
      })
      .strict()
      .parse(req.body);
    const workbench = getWorkbench(),
      owner = windowId(req);
    workbench.workspace.checkLease(
      body.workspaceId,
      owner,
      body.lease ?? req.get('x-scwc-lease') ?? '',
    );
    await pluginCatalog.require(body.pluginId);
    const tabs = workbench.workspace.get(body.workspaceId).snapshot.tabs;
    for (const id of [body.tabId, body.sourceTabId]) {
      if (id) {
        uiAssert(
          tabs.some((t) => t.id === id && t.kind === 'plugin' && t.pluginId === body.pluginId),
          'UI_STALE_INSTANCE',
          '来源页面不属于当前插件工作区',
        );
      }
    }
    uiAssert(
      !body.sourceFrameEpoch || body.sourceTabId,
      'UI_STALE_INSTANCE',
      '页面代数缺少来源标签',
    );
    return declarativeUI.create({ ...body, windowId: owner, surface: body.surface as UISurface });
  });
  route('get', '/instances/:id/content', (req) =>
    declarativeUI.refresh(String(req.params.id), windowId(req)),
  );
  route('post', '/instances/:id/data', (req) =>
    declarativeUI.data(String(req.params.id), windowId(req), req.body),
  );
  route('post', '/instances/:id/subscriptions', (req) =>
    declarativeUI.data(String(req.params.id), windowId(req), req.body),
  );
  route('post', '/instances/:id/events/continue', (req) =>
    declarativeUI.continueEvent(
      String(req.params.id),
      requireLease(req),
      z.string().uuid().parse(req.body.continuation),
      req.body.succeeded === true,
    ),
  );
  route('post', '/instances/:id/events', (req) =>
    declarativeUI.execute(String(req.params.id), requireLease(req), req.body),
  );
  route('delete', '/instances/:id/subscriptions/:subscriptionId', (req) =>
    declarativeUI.unsubscribe(
      String(req.params.id),
      windowId(req),
      String(req.params.subscriptionId),
    ),
  );
  route('post', '/instances/:id/release', (req) => {
    declarativeUI.get(String(req.params.id), windowId(req));
    declarativeUI.release(String(req.params.id));
    return { released: true };
  });
  route('delete', '/instances/:id', (req) => {
    declarativeUI.get(String(req.params.id), windowId(req));
    declarativeUI.release(String(req.params.id));
    return { released: true };
  });
  route('post', '/instances/:id/effects/ack', (req) => {
    declarativeUI.get(String(req.params.id), windowId(req));
    return { acknowledged: true };
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof UIError)) {
      next(error);
      return;
    }
    res
      .status(error.code === 'UI_RESOURCE_DENIED' ? 403 : 400)
      .json({ success: false, code: error.code, message: error.message });
  });
  return router;
}
export async function uiAsset(req: Request, res: Response) {
  try {
    const parts = req.params.path;
    const value = await declarativeUI.asset(
      String(req.params.pluginId),
      String(req.params.owner),
      Array.isArray(parts) ? parts.join('/') : String(parts),
      String(req.query.cap ?? ''),
    );
    res.set({
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    res.removeHeader('Access-Control-Allow-Origin');
    if (value.type.startsWith('font/')) {
      res.set('Access-Control-Allow-Origin', '*');
    }
    res.type(value.type).send(value.data);
  } catch (error) {
    res
      .status(403)
      .type('text/plain')
      .send(error instanceof UIError ? error.message : '资源不可用');
  }
}
