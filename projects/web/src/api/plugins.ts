import type { TConfig } from '../../../shared/types/config.d.ts';
import type { TPluginPagesResponse } from '../types/api.d.ts';

/** 请求 /web/api/pages */
export async function getPluginPages(config: TConfig): Promise<TPluginPagesResponse> {
  try {
    const res = await fetch(
      `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/web/api/pages?site=${encodeURIComponent(window.location.href)}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api.token}`,
        },
      },
    );
    const data = (await res.json()) as TPluginPagesResponse;
    if (data && data.success === false) {
      return {
        success: false,
        message: data.message || '抓取失败',
        data: data.data ?? [],
      };
    }
    if (data && data.success === true) {
      return { success: true, message: '抓取成功', data: data.data ?? [] };
    }
    return { success: false, message: '服务器无响应', data: [] };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '获取插件页面信息失败',
      data: [],
    };
  }
}
