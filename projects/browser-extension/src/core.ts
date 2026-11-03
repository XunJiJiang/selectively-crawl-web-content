import { browser } from './browser.ts';
import { coreAddress, permissionOrigin } from './model.ts';
import type { TConfig } from '../../shared/types/config.d.ts';
import {
  CLIENT_VERSION,
  VERSION_HEADER,
  versionNoticeKey,
  type VersionNotice,
} from '../../shared/client-version.ts';
export let pendingVersionNotice: VersionNotice | undefined;
export async function dismissVersionNotice(notice: VersionNotice) {
  await browser.storage.local.set({ [versionNoticeKey(notice)]: true });
  pendingVersionNotice = undefined;
}

export async function requestCore<T>(
  config: TConfig,
  site: string,
  path: string,
  body?: unknown,
  previousSite?: string,
  pluginId?: string,
  previousInstance?: { instanceId: string; dirtyFields: string[] },
): Promise<T> {
  if (!(await browser.permissions.contains({ origins: [permissionOrigin(config)] }))) {
    throw new Error('请在连接设置中授权访问核心主机');
  }
  const url = coreAddress(config, path);
  url.searchParams.set('site', site);
  if (previousSite) {
    url.searchParams.set('previousSite', previousSite);
  }
  if (pluginId) {
    url.searchParams.set('pluginId', pluginId);
  }
  if (previousInstance) {
    url.searchParams.set('instanceId', previousInstance.instanceId);
    url.searchParams.set('dirtyFields', JSON.stringify(previousInstance.dirtyFields));
  }
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.api.token}`,
      [VERSION_HEADER]: CLIENT_VERSION,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (result.version?.status === 'warning') {
    const notice = result.version as VersionNotice;
    if (!(await browser.storage.local.get(versionNoticeKey(notice)))[versionNoticeKey(notice)]) {
      pendingVersionNotice = notice;
    }
  }
  if (
    !response.ok ||
    result.success === false ||
    (typeof result.code === 'number' && result.code !== 200)
  ) {
    throw Object.assign(new Error(result.message ?? `核心请求失败 (${response.status})`), {
      code: result.errorCode,
    });
  }
  return result as T;
}
