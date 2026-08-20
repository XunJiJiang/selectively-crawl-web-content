import type { TConfig } from '../../../shared/types/config.ts';

export type TResource = (url: string) => string;
export type TFetchResponse<T> = {
  success: boolean;
  message?: string;
  data: T;
};

export type TFetch = (<T = unknown>(
  url: string,
  options?: RequestInit,
) => Promise<TFetchResponse<T>>) & {
  resource: TResource;
};

export type TCreateFetch = (config: TConfig) => Promise<TFetch>;

export const createFetch: TCreateFetch = async (config: TConfig) => {
  // /web/page/plugin/:pluginDir
  const pluginDir = window.location.pathname.split('/')[4];
  // 请求插件的 safeId
  const res = await fetch(
    `/web/api/safeId/${pluginDir}?site=${encodeURIComponent(window.location.href)}`,
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api.token}`,
      },
    },
  );
  const data = await res.json();
  if (data && data.success === true) {
    const safeId = data.data.safeId;
    const pluginFetch = Object.assign(
      async (url: string, options?: RequestInit) => {
        // 判断 url 中是否包含 param 参数
        const hasParam = url.includes('?');
        const fullUrl = `/web/api/plugin/${safeId}${
          url.startsWith('/') ? '' : '/'
        }${url}${hasParam ? '&' : '?'}site=${encodeURIComponent(window.location.href)}`;
        const _opt = {
          ...options,
          headers: {
            ...options?.headers,
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.api.token}`,
          },
        };
        const res = await fetch(fullUrl, _opt);
        const data = await res.json();
        return data;
      },
      {
        resource: (url: string) => {
          const hasParam = url.includes('?');
          return `/web/resource/plugin/${safeId}${url.startsWith('/') ? '' : '/'}${url}${
            hasParam ? '&' : '?'
          }site=${encodeURIComponent(window.location.href)}`;
        },
      },
    ) satisfies TFetch;
    return pluginFetch;
  }
  const unavailable = Object.assign(
    async (_url: string, _options?: RequestInit) => {
      console.warn('获取插件 safeId 失败, 无法使用 scwcutils.fetch');
      return {
        success: false,
        message: '获取插件 safeId 失败',
        data: undefined as never,
      };
    },
    { resource: () => '' },
  ) satisfies TFetch;
  return unavailable;
};
