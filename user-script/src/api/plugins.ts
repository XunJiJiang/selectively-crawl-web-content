import type { TCrawlData } from "../types/claw";
import type { TConfig } from "../types/config";
import type { PluginConfig, PluginItem, TRequiredOptions } from "../types/plugin";

/** 请求插件列表 */
export async function fetchPlugins (config: TConfig): Promise<(PluginConfig)[]> {
  const url = window.location.href;
  const res = await fetch(
    `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/config?site=${encodeURIComponent(url)}`,
    {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api.token}` },
    },
  );
  if (!res.ok) throw new Error('Failed to fetch plugin config');
  const data = (await res.json()) as {
    code: number;
    message: string;
    data: PluginConfig[];
  };
  if (data.code >= 400 && data.code < 600) {
    throw new Error(data.message ?? 'Error fetching plugin config');
  } else if (data.code === 200) {
    return data.data;
  } else {
    throw new Error('Unexpected response code(' + data.code + ') from server: ' + data.message);
  }
}

/** 触发插件 */
export async function triggerPlugin (
  type: 'click' | 'change',
  pluginId: string,
  channel: string,
  control: PluginItem,
  value: string | number | boolean | null,
  options: TRequiredOptions,
  data: TCrawlData,
  relatedValues: Record<string, string | number | boolean | null>,
  config: TConfig,
): Promise<void> {
  if (!options.autoTrigger && control.type !== 'button') {
    return;
  }
  const { result, failed } = data;
  if (options.requireFullContent && failed.length > 0) {
    // TODO: 需要添加弹窗通知
    console.warn('无法发送请求，存在未获取到的元素索引:', failed);
    // notify.warn({
    //   title: '无法执行插件操作',
    //   description: `存在未获取到的元素索引: ${failed.join(', ')}`,
    //   placement: 'topRight',
    // });
    return;
  }
  handleFetchResponse(fetch(
    `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/toggle?site=${encodeURIComponent(window.location.href)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api.token}` },
      body: JSON.stringify({
        type,
        channel,
        id: pluginId,
        context: {
          data: result,
          site: window.location.href,
          relatedValues,
          value,
        },
      }),
    },
  ), /* pluginId, channel, control */);
}

/** 处理需要 fetch 的控件的请求返回值 */
function handleFetchResponse (promise: Promise<Response>, /* pluginId: string, _channel: string, _control: PluginItem */) {
  promise
    .then(res => {
      if (!res.ok) {
        // TODO: 需要添加弹窗通知
        console.warn(`插件请求失败: ${res.status} ${res.statusText}`);
        // notify.warn({
        //   title: '插件请求失败',
        //   description: `${res.status} ${res.statusText}`,
        //   placement: 'topRight',
        // });
        return null;
      }
      return res.json() as Promise<{
        code: number;
        message: string;
        data: {
          type: 'notification';
          data: {
            type: 'error' | 'success' | 'warn' | 'info';
            message: string;
          };
        };
      }>;
    })
    .then(data => {
      if (!data) return;
      if (data.code >= 400 && data.code < 600) {
        console.warn('插件请求错误: ' + data.message);
        // notify.warn({
        //   title: '插件请求错误',
        //   description: data.message,
        //   placement: 'topRight',
        // });
        return;
      } else if (data.code === 200) {
        if (data.data.type === 'notification') {
          console.log('插件请求成功，消息:', data.data.data);
          // TODO: 需要添加弹窗通知
          // const notifyFunc = notify[data.data.data.type as 'info' | 'success' | 'warn' | 'error'];
          // notifyFunc({
          //   title: `插件 ${pluginId} 的处理结果`,
          //   description: data.data.data.message,
          //   placement: 'topRight',
          // });
        }
      } else {
        console.warn('插件请求返回了未知的响应代码: ' + data.code);
        // TODO: 需要添加弹窗通知
        // scwcWarn(`插件请求失败: ${data.code} ${data.message}`);
        // notify.warn({
        //   title: '插件请求失败',
        //   description: `${data.code} ${data.message}`,
        //   placement: 'topRight',
        // });
        return;
      }
    })
    .catch(() => {
      console.warn('插件请求失败');
      // TODO: 需要添加弹窗通知
      // scwcError('插件请求失败:', e);
      // notify.error({
      //   title: '插件请求失败',
      //   description: e instanceof Error ? e.message : String(e),
      //   placement: 'topRight',
      // });
    });
}