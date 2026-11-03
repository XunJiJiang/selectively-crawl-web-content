import type { RequestHandler } from 'express';
import {
  compareVersions,
  VERSION_HEADER,
  type VersionNotice,
} from '../../shared/client-version.ts';

/** Last repository version in which any HTTP route changed. Update alongside route literals. */
export const LATEST_ROUTE_VERSION = '3.2.0';

/** Missing headers belong to the co-released Web UI or legacy clients. */
export function routeVersion<P = import('express-serve-static-core').ParamsDictionary>(
  version: string,
): RequestHandler<P> {
  return (req, res, next) => {
    const client = req.get(VERSION_HEADER);
    if (!client) {
      next();
      return;
    }
    let status: VersionNotice['status'] | undefined;
    try {
      if (compareVersions(client, version) < 0) {
        status = 'error';
      } else if (compareVersions(client, LATEST_ROUTE_VERSION) < 0) {
        status = 'warning';
      }
    } catch {
      res.status(400).json({ success: false, code: 400, message: '客户端版本号无效' });
      return;
    }
    if (!status) {
      next();
      return;
    }
    const notice: VersionNotice = {
      status,
      client,
      route: version,
      latest: LATEST_ROUTE_VERSION,
      message:
        status === 'error'
          ? `当前版本 ${client} 低于此接口要求的 ${version}，当前路由请求失败，请升级脚本或扩展。`
          : `当前版本 ${client} 低于最新接口版本 ${LATEST_ROUTE_VERSION}，可能无法使用某些功能，建议升级脚本或扩展。`,
    };
    res.setHeader('X-SCWC-Version-Notice', encodeURIComponent(JSON.stringify(notice)));
    if (status === 'error') {
      res.status(426).json({ success: false, code: 426, message: notice.message, version: notice });
      return;
    }
    const json = res.json.bind(res);
    res.json = (body) =>
      json(
        body && typeof body === 'object' && !Array.isArray(body)
          ? { ...body, version: notice }
          : body,
      );
    next();
  };
}
