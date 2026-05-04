import { useCallback, useContext, useEffect, useRef, useState } from "react";
import configContext from "../context/config";
import { scwcError, scwcWarn } from "../utils/console";
import { useNotification } from "./useNotification";
import { debounce } from '../utils/debounce';

export type PluginItem = (Omit<SCWC.TPluginItem, 'trigger'> & {
  // 这个控制器的值，可以是用户输入的字符串，也可以是预设的选项值，或者null表示无值
  // button 类型的控制器值只能为 null
  value: string | null;
});

export type PluginConfig = {
  id: string;
  title: string;
  description: string;
  controls: PluginItem[];
};

export type GetCrawlData = () => { result: SCWC.TDataItem[]; failed: string[] };

/** 处理需要 fetch 的控件的请求返回值 */
function handleFetchResponse (promise: Promise<Response>, pluginId: string, _channel: string, _control: PluginItem, notify: ReturnType<typeof useNotification>) {
  promise
    .then(res => {
      if (!res.ok) {
        scwcWarn(`插件请求失败: ${res.status} ${res.statusText}`);
        notify.warn({
          title: '插件请求失败',
          description: `${res.status} ${res.statusText}`,
          placement: 'topRight',
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
    .then(data => {
      if (!data) return;
      if (data.code >= 400 && data.code < 600) {
        scwcWarn('插件请求错误: ' + data.message);
        notify.warn({
          title: '插件请求错误',
          description: data.message,
          placement: 'topRight',
        });
        return;
      } else if (data.code === 200) {
        if (data.data.type === 'notification') {
          const notifyFunc = notify[data.data.data.type as 'info' | 'success' | 'warn' | 'error'];
          notifyFunc({
            title: `插件 ${pluginId} 的处理结果`,
            description: data.data.data.message,
            placement: 'topRight',
          });
        }
      } else {
        scwcWarn(`插件请求失败: ${data.code} ${data.message}`);
        notify.warn({
          title: '插件请求失败',
          description: `${data.code} ${data.message}`,
          placement: 'topRight',
        });
        return;
      }
    })
    .catch(e => {
      scwcError('插件请求失败:', e);
      notify.error({
        title: '插件请求失败',
        description: e instanceof Error ? e.message : String(e),
        placement: 'topRight',
      });
    });
}

/** 插件项是否没有加载远程控制器 */
function isPluginItemUnloaded (plugins: PluginConfig[] | null) {
  return plugins === null
}

export function usePluginFetch (openPluginWindow: boolean, getCrawlData: GetCrawlData) {
  const config = useContext(configContext);
  const notify = useNotification();

  /**
   * 通道 -> 插件项 的映射关系, 用于在触发插件项时找到对应的插件项配置
   */
  const [channelControlMap, setChannelControlMap] = useState<Record<string, PluginItem> | null>(null);

  /** 插件配置列表 */
  const [plugins, setPlugins] = useState<PluginConfig[] | null>(null);

  /** 
   * 不同插件的控制器值
   * 这里没有区分不同插件, 因为通道名称在全局范围内是唯一的
   */
  const [controlValues, setControlValues] = useState<
    Map<PluginItem, {
      value: string | number | boolean | null;
      plugin: PluginConfig;
    }>
  >(new Map());

  /**
   * 本次值更改发生变化的 PluginItem 列表
   */
  const [changedItems, setChangedItems] = useState<PluginItem[]>([]);

  const getOptions = useCallback((control: PluginItem): Required<PluginItem>['options'] => {
    return {
      requireFullContent: true,
      relatedChannel: [],
      autoTrigger: false,
      defaultValue: null,
      ...control.options,
    };
  }, []);

  const getRelatedValues = useCallback((control: PluginItem) => {
    const options = getOptions(control);
    const relatedValues: Record<string, string | number | boolean | null> = {};
    options.relatedChannel?.forEach(channel => {
      const relatedControl = channelControlMap?.[channel];
      console.log('channelControlMapchannelControlMap', channelControlMap);
      if (relatedControl) {
        relatedValues[channel] = controlValues.get(relatedControl)?.value ?? (scwcWarn(`未找到控制器值: ${channel}`), null);
      } else {
        scwcWarn(`未找到控制器: ${channel}`);
        relatedValues[channel] = null;
      }
    });
    console.log('relatedValuesrelatedValues', relatedValues);
    return relatedValues;
  }, [channelControlMap, controlValues, getOptions]);

  /**
   * 请求插件项触发接口的函数, 会根据插件项的配置自动判断是否需要发送请求
   */
  const fetchPluginTrigger = useCallback((type: 'click' | 'change', pluginId: string, channel: string, control: PluginItem, value: string | number | boolean | null) => {
    const options = getOptions(control);
    if (!options.autoTrigger && control.type !== 'button') {
      return;
    }
    const { result, failed } = getCrawlData();
    if (options.requireFullContent && failed.length > 0) {
      scwcWarn('无法发送请求，存在未获取到的元素索引:', failed);
      notify.warn({
        title: '无法执行插件操作',
        description: `存在未获取到的元素索引: ${failed.join(', ')}`,
        placement: 'topRight',
      });
      return;
    }
    const relatedValues = getRelatedValues(control);
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
    ), pluginId, channel, control, notify);
  }, [config, getCrawlData, notify, getRelatedValues, getOptions]);

  /** 插件触发执行器缓存 */
  const triggerExecutorFunctions = useRef(new Map<PluginItem, (plugin: string, channel: string, control: PluginItem, value: string | number | boolean | null) => void>());

  useEffect(() => {
    if (changedItems.length === 0) return;
    changedItems.forEach(item => {


      const triggerFunc = (value: string | number | boolean | null, control: PluginItem, plugin: PluginConfig) => {
        const executorKey = control.type;
        const needLazyFetchType = ['input:text', 'input:number'].includes(control.type);
        const executor = (() => {
          const func = triggerExecutorFunctions.current.get(control);
          if (func) {
            return func;
          }
          const newFunc = debounce((plugin: string, channel: string, control: PluginItem, value: string | number | boolean | null) => {
            fetchPluginTrigger(control.type === 'button' ? 'click' : 'change', plugin, channel, control, value);
          }, needLazyFetchType ? 500 : 0);
          triggerExecutorFunctions.current.set(control, newFunc);
          return newFunc;
        })()
        if (executor) {
          executor(plugin.id, control.channel, control, value);
        } else {
          scwcWarn(`未找到插件控制器执行器: ${executorKey}`);
          notify.warn({
            title: '插件配置错误',
            description: `未找到插件控制器执行器: ${executorKey}`,
            placement: 'topRight',
          });
        }
      }
      if (triggerFunc) {
        const value = controlValues.get(item);
        if (!value) {
          scwcWarn(`插件控制器值未找到: ${item.channel}`);
          return;
        }
        triggerFunc(value.value, item, value.plugin);
      }
    });
    setChangedItems([]); // 触发完成后清空本次更改的列表
  }, [controlValues, changedItems, fetchPluginTrigger, notify]);

  const fetchPluginConfig = useCallback(async () => {
    /** 当前页面完整url */
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
  }, [config]);

  /** runFetchPluginConfig 执行次数 */
  // const runFetchPluginConfigCount = useRef(0);

  const runFetchPluginConfig = useCallback(() => {

    fetchPluginConfig()
      .then(plugins => {
        setPlugins(() => {
          return plugins;
        });
        setChannelControlMap(() => {
          const map: Record<string, PluginItem> = {};
          plugins.forEach(plugin => {
            plugin.controls.forEach(control => {
              map[control.channel] = control;
            });
          });
          console.log('channelControlMap', map);
          return map;
        });
        setControlValues(() => {
          const map = new Map<PluginItem, { value: string | number | boolean | null; plugin: PluginConfig }>();
          plugins.forEach(plugin => {
            plugin.controls.forEach(control => {
              map.set(control, { value: control.options?.defaultValue ?? null, plugin });
            });
          });
          return map;
        });

        setChangedItems([]);
      })
      .catch(e => {
        scwcError('加载插件配置失败:', e);
        notify.error({
          title: '加载插件配置失败',
          description: e instanceof Error ? e.message : String(e),
          placement: 'topRight',
        });
      })

  }, [fetchPluginConfig, notify]);

  useEffect(() => {
    if (!openPluginWindow) return;
    if (isPluginItemUnloaded(plugins)) {
      runFetchPluginConfig();
    }
  }, [openPluginWindow, plugins, runFetchPluginConfig]);

  /**
  * 修改/触发插件控制器值的函数
  */
  const setControlValue = useCallback((control: PluginItem, value: string | number | boolean | null) => {
    setControlValues(prev => {
      const newMap = new Map(prev);
      const controlValue = newMap.get(control);
      if (!controlValue) {
        scwcWarn(`插件控制器值未找到: ${control.channel}`);
        return newMap;
      }
      newMap.set(control, {
        value: value,
        plugin: controlValue.plugin
      });
      return newMap;
    });
    setChangedItems(prev => {
      if (!prev.includes(control)) {
        return [...prev, control];
      }
      return prev;
    });
  }, []);

  /**
   * 获取插件控制器的值的函数
   */
  const getControlValue = useCallback((control: PluginItem): string | number | boolean | null => {
    console.log('getControlValue', control.channel, controlValues.get(control));
    return controlValues.get(control)?.value ?? null;
  }, [controlValues]);

  return {
    plugins,
    setControlValue,
    getControlValue
  }
}