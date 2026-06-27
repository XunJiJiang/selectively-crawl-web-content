import type { TCrawlResponse } from '../types/api.d.ts';
import type { TConfig } from '../types/config.d.ts';

export async function sendCrawlRequest(
  data: SCWC.TDataItem[],
  config: TConfig,
): Promise<TCrawlResponse> {
  try {
    const res = await fetch(
      `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/metadata/scrape?site=${encodeURIComponent(window.location.href)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api.token}`,
        },
        body: JSON.stringify({
          site: window.location.href,
          data,
        }),
      },
    );

    const resData = (await res.json()) as TCrawlResponse;
    if (resData && resData.success === false) {
      return {
        success: false,
        message: resData.message || '抓取失败',
        data: resData.data ?? [],
      };
    }
    if (resData && resData.success === true) {
      return { success: true, message: '抓取成功', data: resData.data ?? [] };
    }
    return { success: false, message: '服务器无响应', data: [] };
  } catch (e) {
    return {
      success: false,
      message: `抓取失败: ${e instanceof Error ? e.message : String(e)}`,
      data: [],
    };
  }
}
