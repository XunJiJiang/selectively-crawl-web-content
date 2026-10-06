import path from 'node:path';
import type { Request, Response } from 'express';
import type { PluginRequest, ResourceResponse } from '../../types/plugin-process.d.ts';

export function requestData(request: Request): PluginRequest {
  return {
    method: request.method,
    url: request.originalUrl,
    params: request.params,
    query: request.query,
    headers: request.headers,
  };
}

/** Files remain off IPC. Express handles Range, backpressure and aborted transfers. */
export async function sendResource(
  resource: ResourceResponse,
  req: Request,
  res: Response,
): Promise<void> {
  if (!resource || (resource.kind !== 'file' && resource.kind !== 'response')) {
    throw new Error('无效的插件资源响应');
  }
  if (req.destroyed || res.destroyed) {
    return;
  }
  if (resource.headers) {
    res.set(resource.headers);
  }
  if (resource.kind === 'response') {
    if (!Number.isInteger(resource.status) || resource.status < 200 || resource.status > 599) {
      throw new Error('无效的插件响应状态');
    }
    res.status(resource.status).send(resource.body);
    return;
  }
  if (!path.isAbsolute(resource.path)) {
    throw new Error('插件文件响应必须使用绝对路径');
  }
  if (resource.contentType) {
    res.setHeader('Content-Type', resource.contentType);
  }
  await new Promise<void>((resolve, reject) => {
    const done = (error?: Error | null) => {
      if (!error || req.destroyed || res.destroyed) {
        resolve();
      } else {
        reject(error);
      }
    };
    if (resource.downloadName !== undefined) {
      res.download(resource.path, resource.downloadName, done);
    } else {
      res.sendFile(resource.path, done);
    }
  });
}
