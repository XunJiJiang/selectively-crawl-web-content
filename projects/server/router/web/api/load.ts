import { Router } from 'express';
import { PluginProcessError } from '../../../plugin/process/protocol.ts';

/** /web/api/plugin */
const router = Router();
const apiRouters = new Map<string, ReturnType<typeof Router>>();
router.use('/:safeId', (req, res, next) => {
  const pluginRouter = apiRouters.get(req.params.safeId);
  if (pluginRouter) {
    pluginRouter(req, res, next);
  } else {
    next();
  }
});

export function registerPluginApi(plugin: SCWC.IPluginMeta) {
  const pluginApi = plugin.handler?.ui?.api;
  if (!pluginApi) {
    return;
  }
  const pluginRouter = Router();
  apiRouters.set(plugin.safeId, pluginRouter);
  const addApi: SCWC.THostedPluginAddApi = (...apis) => {
    apis.forEach((api) => {
      // api.path 是否以 / 开头
      const slash = api.path.startsWith('/') ? '' : '/';
      const fullPath = `${slash}${api.path}`;
      pluginRouter[api.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](
        fullPath,
        async (req, res) => {
          try {
            const result = await api.handler(req.body, { req, res });
            res.json({
              success: true,
              message: '请求成功',
              data: result,
            });
          } catch (error) {
            res.status(error instanceof PluginProcessError ? error.status : 500).json({
              success: false,
              message: `请求失败: ${error}`,
            });
          }
        },
      );
    });
  };

  if (typeof pluginApi === 'function') {
    pluginApi({ add: addApi });
  } else if (typeof pluginApi === 'object') {
    for (const api of pluginApi) {
      addApi(api);
    }
  }
}

export default router;

/**
 * Plugin resources are mounted outside /web/api because media elements cannot attach the
 * application's bearer header. Resource handlers must validate a short-lived plugin ticket.
 */
export const pluginResourceRouter = Router();
const resourceRouters = new Map<string, ReturnType<typeof Router>>();
pluginResourceRouter.use('/:safeId', (req, res, next) => {
  const pluginRouter = resourceRouters.get(req.params.safeId);
  if (pluginRouter) {
    pluginRouter(req, res, next);
  } else {
    next();
  }
});

export function unregisterPluginRoutes(safeId: string) {
  apiRouters.delete(safeId);
  resourceRouters.delete(safeId);
}

export function registerPluginResources(plugin: SCWC.IPluginMeta) {
  const resources = plugin.handler?.ui?.resources;
  if (!resources || resources.length === 0) {
    return;
  }
  const pluginRouter = Router();
  resourceRouters.set(plugin.safeId, pluginRouter);
  for (const resource of resources) {
    const slash = resource.path.startsWith('/') ? '' : '/';
    const fullPath = `${slash}${resource.path}`;
    pluginRouter.get(fullPath, async (req, res) => {
      try {
        await resource.handler(req.query, { req, res });
      } catch (error) {
        if (!res.headersSent && !res.destroyed) {
          const status =
            error instanceof PluginProcessError
              ? error.status
              : error &&
                  typeof error === 'object' &&
                  'status' in error &&
                  typeof error.status === 'number'
                ? error.status
                : 500;
          res.status(status).json({ success: false, message: `资源请求失败: ${error}` });
        }
      }
    });
  }
}
