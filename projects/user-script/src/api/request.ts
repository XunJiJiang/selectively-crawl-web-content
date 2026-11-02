import { GM_xmlhttpRequest, type GmAbortHandle } from 'vite-plugin-monkey/dist/client';

interface CoreRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/** 由脚本管理器发起核心请求，避免页面的 connect-src 限制。 */
export function requestCore(
  url: string | URL,
  options: CoreRequestOptions = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    let handle: GmAbortHandle | undefined;
    let settled = false;
    const finish = (error?: unknown, response?: Response) => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (response) {
        resolve(response);
      } else {
        reject(error);
      }
    };
    const abort = () => {
      finish(signal?.reason ?? new DOMException('请求已取消', 'AbortError'));
      handle?.abort();
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (typeof GM_xmlhttpRequest !== 'function') {
        throw new Error('缺少油猴网络权限，请重新安装最新版用户脚本');
      }
      handle = GM_xmlhttpRequest({
        url: String(url),
        method: options.method ?? 'GET',
        headers: {
          ...options.headers,
          // 后台请求也保留当前网站身份，供核心校验 site 与来源。
          Origin: location.origin,
          Referer: `${location.origin}/`,
        },
        data: options.body,
        anonymous: true,
        nocache: true,
        redirect: 'error',
        onload: (result) => {
          try {
            const headers = new Headers();
            for (const line of result.responseHeaders.split(/\r?\n/)) {
              const colon = line.indexOf(':');
              if (colon > 0) {
                headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
              }
            }
            finish(
              undefined,
              new Response([204, 205, 304].includes(result.status) ? null : result.responseText, {
                status: result.status,
                statusText: result.statusText,
                headers,
              }),
            );
          } catch (error) {
            finish(error);
          }
        },
        onerror: () => finish(new TypeError('无法连接核心，请检查地址、端口和油猴连接权限')),
        ontimeout: () => finish(new DOMException('核心请求超时', 'TimeoutError')),
        onabort: () => finish(new DOMException('请求已取消', 'AbortError')),
      });
      if (signal?.aborted) {
        abort();
      }
    } catch (error) {
      finish(error);
    }
  });
}
