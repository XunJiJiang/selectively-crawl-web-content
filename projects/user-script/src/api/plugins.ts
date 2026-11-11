import type { TCrawlData } from '../types/claw.ts';
import type { TConfig } from '../../../shared/types/config.d.ts';
import type { PluginConfig, PluginItem, TRequiredOptions } from '../../../shared/types/plugin';
import { notify } from '../utils/notify.ts';
import { requestCore } from './request.ts';
import type { ScriptUIEvent, ScriptUIResult } from '../../../shared/script-ui.ts';

/** 请求插件列表 */
export interface PluginConfigBatch {
  plugins: PluginConfig[];
  activeIds: string[];
  updatedIds: string[];
}
export async function fetchPlugins(
  config: TConfig,
  options: {
    site?: string;
    previousSite?: string;
    signal?: AbortSignal;
    pluginId?: string;
    instanceId?: string;
    dirtyFields?: string[];
  } = {},
): Promise<PluginConfigBatch> {
  const url = options.site ?? window.location.href;
  const previous = options.previousSite
    ? `&previousSite=${encodeURIComponent(options.previousSite)}`
    : '';
  const res = await requestCore(
    `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/config?site=${encodeURIComponent(url)}${previous}${options.pluginId ? `&pluginId=${encodeURIComponent(options.pluginId)}` : ''}${options.instanceId ? `&instanceId=${encodeURIComponent(options.instanceId)}&dirtyFields=${encodeURIComponent(JSON.stringify(options.dirtyFields ?? []))}` : ''}`,
    {
      method: 'GET',
      signal: options.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.api.token}`,
      },
    },
  );
  if (!res.ok) {
    throw new Error('Failed to fetch plugin config');
  }
  const data = (await res.json()) as {
    code: number;
    message: string;
    data: PluginConfig[];
    activeIds?: string[];
    updatedIds?: string[];
  };
  if (data.code >= 400 && data.code < 600) {
    throw new Error(data.message ?? 'Error fetching plugin config');
  } else if (data.code === 200) {
    return {
      plugins: data.data,
      activeIds: data.activeIds ?? data.data.map((p) => p.id),
      updatedIds: data.updatedIds ?? data.data.map((p) => p.id),
    };
  } else {
    throw new Error('Unexpected response code(' + data.code + ') from server: ' + data.message);
  }
}

/** 触发插件 */
export async function triggerPlugin(
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
    console.warn('无法发送请求，存在未获取到的元素索引:', failed);
    notify({
      title: '无法执行插件操作',
      description: `存在未获取到的元素索引: ${failed.join(', ')}`,
      type: 'warn',
      placement: config.notify.placement,
    });
    return;
  }
  handleFetchResponse(
    requestCore(
      `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/toggle?site=${encodeURIComponent(window.location.href)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.api.token}`,
        },
        body: JSON.stringify({
          version: 'v1',
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
    ),
    /* pluginId, channel, control, */ config,
  );
}

export async function invokeScriptUI(
  plugin: PluginConfig,
  request: ScriptUIEvent,
  data: TCrawlData,
  config: TConfig,
): Promise<ScriptUIResult> {
  if (!request.readOnly && plugin.requireFullContent !== false && data.failed.length) {
    throw new Error(`以下抓取项在当前页面不存在：${data.failed.join('、')}`);
  }
  const response = await requestCore(
    `${config.api.host}:${config.api.port.replace(/[^\d]/g, '')}/api/plugin/event?site=${encodeURIComponent(location.href)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.api.token}` },
      body: JSON.stringify({ ...request, version: 'v2', id: plugin.id, data: data.result }),
    },
  );
  const result = (await response.json()) as {
    code: number;
    message: string;
    errorCode?: string;
    field?: string;
    data: ScriptUIResult;
  };
  if (!response.ok || result.code !== 200) {
    throw Object.assign(new Error(result.message), { code: result.errorCode, field: result.field });
  }
  const notification = result.data.result as
    | { type?: string; data?: { type: 'info' | 'success' | 'warn' | 'error'; message: string } }
    | undefined;
  if (notification?.type === 'notification' && notification.data) {
    notify({
      title: '插件处理结果',
      description: notification.data.message,
      type: notification.data.type,
      placement: config.notify.placement,
    });
  }
  return result.data;
}

/** 处理需要 fetch 的控件的请求返回值 */
function handleFetchResponse(
  promise: Promise<Response>,
  /* pluginId: string, _channel: string, _control: PluginItem, */ config: TConfig,
) {
  promise
    .then((res) => {
      if (!res.ok) {
        console.error(`插件请求失败: ${res.status} ${res.statusText}`);
        notify({
          title: '插件请求失败',
          description: `${res.status} ${res.statusText}`,
          placement: config.notify.placement,
          type: 'error',
        });
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
    .then((data) => {
      if (!data) {
        return;
      }
      if (data.code >= 400 && data.code < 600) {
        console.error('插件请求错误: ' + data.message);
        notify({
          title: '插件请求错误',
          description: data.message,
          placement: config.notify.placement,
          type: 'error',
        });
        return;
      } else if (data.code === 200) {
        if (data.data.type === 'notification') {
          console.log('插件请求成功，消息:', data.data.data);
          notify({
            title: `插件处理结果`,
            description: data.data.data.message,
            placement: config.notify.placement,
            type: data.data.data.type as 'info' | 'success' | 'warn' | 'error',
          });
        }
      } else {
        console.warn('插件请求返回了未知的响应代码: ' + data.code);
        notify({
          title: '插件请求失败',
          description: `${data.code} ${data.message}`,
          placement: config.notify.placement,
          type: 'error',
        });
        return;
      }
    })
    .catch((e) => {
      console.warn('插件请求失败');
      notify({
        title: '插件请求失败',
        description: e instanceof Error ? e.message : String(e),
        placement: config.notify.placement,
        type: 'error',
      });
    });
}
