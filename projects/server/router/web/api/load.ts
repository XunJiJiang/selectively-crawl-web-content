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
            const result = await api.handler(req.body);
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
