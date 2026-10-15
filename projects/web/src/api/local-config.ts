import type { TConfig } from '../../../shared/types/config.d.ts';

/** 同源本机服务确认身份后，用当前启动配置替换过期的连接信息。 */
export async function loadLocalConfig(config: TConfig): Promise<TConfig> {
  const page = new URL(window.location.href);
  if (
    !['http:', 'https:'].includes(page.protocol) ||
    !(page.hostname === 'localhost' || page.hostname === '[::1]' || /^127\./.test(page.hostname))
  ) {
    return config;
  }

  try {
    const response = await fetch(`${page.origin}/web/local-config`, {
      headers: { 'X-SCWC-Local-Config': '1' },
      mode: 'same-origin',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'same-origin',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      return config;
    }
    const result = await response.json();
    const api = result?.data;
    if (
      result?.success !== true ||
      typeof api?.host !== 'string' ||
      typeof api?.port !== 'string' ||
      typeof api?.token !== 'string' ||
      new URL(`${api.host}:${api.port}`).origin !== page.origin
    ) {
      return config;
    }
    return { ...config, api: { host: api.host, port: api.port, token: api.token } };
  } catch {
    return config;
  }
}
