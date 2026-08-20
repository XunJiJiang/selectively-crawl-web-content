import { Router } from 'express';

/** /web/api/plugin */
const router = Router();

export function registerPluginApi(plugin: SCWC.IPluginMeta) {
  const pluginApi = plugin.handler?.ui?.api;
  if (!pluginApi) {
    return;
  }
  const addApi: SCWC.TPluginAddApi = (...apis) => {
    apis.forEach((api) => {
      // api.path 是否以 / 开头
      const slash = api.path.startsWith('/') ? '' : '/';
      const fullPath = `/${plugin.safeId}${slash}${api.path}`;
      router[api.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](
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
            res.status(500).json({
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

export function registerPluginResources(plugin: SCWC.IPluginMeta) {
  const resources = plugin.handler?.ui?.resources;
  if (!resources || resources.length === 0) {
    return;
  }
  for (const resource of resources) {
    const slash = resource.path.startsWith('/') ? '' : '/';
    const fullPath = `/${plugin.safeId}${slash}${resource.path}`;
    pluginResourceRouter.get(fullPath, async (req, res) => {
      try {
        await resource.handler(req.query, { req, res });
      } catch (error) {
        if (!res.headersSent) {
          res.status(500).json({ success: false, message: `资源请求失败: ${error}` });
        }
      }
    });
  }
}
