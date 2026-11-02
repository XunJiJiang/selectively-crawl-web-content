import { browser } from './browser.ts';
import { coreAddress, permissionOrigin } from './model.ts';
import type { TConfig } from '../../shared/types/config.d.ts';

export async function requestCore<T>(
  config: TConfig,
  site: string,
  path: string,
  body?: unknown,
  previousSite?: string,
): Promise<T> {
  if (!(await browser.permissions.contains({ origins: [permissionOrigin(config)] }))) {
    throw new Error('请在连接设置中授权访问核心主机');
  }
  const url = coreAddress(config, path);
  url.searchParams.set('site', site);
  if (previousSite) {
    url.searchParams.set('previousSite', previousSite);
  }
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api.token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(25000),
  });
  const result = await response.json();
  if (
    !response.ok ||
    result.success === false ||
    (typeof result.code === 'number' && result.code !== 200)
  ) {
    throw new Error(result.message ?? `核心请求失败 (${response.status})`);
  }
  return result as T;
}
