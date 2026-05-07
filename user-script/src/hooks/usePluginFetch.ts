import { useCallback, useEffect, useRef, useState } from "react";
import { useConfig } from "../context/config";
import { scwcError, scwcWarn } from "../utils/console";
import { useNotification } from "./useNotification";
import { debounce } from '../utils/debounce';
import type { GetCrawlData, PluginConfig, PluginItem } from "../types/plugin";
import type { ScriptConfig, ScriptConfigItem } from "../types/config";

// TODO: 当窗口最小化然后最大化后, 会重新获取插件配置. 这不对
// 即使url变化, 也应该是再次打开插件窗口时才获取新的插件配置

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
function isPluginItemUnloaded (plugins: (PluginConfig | ScriptConfig)[] | null) {
  return plugins === null
}

export function usePluginFetch (openPluginWindow: boolean, getCrawlData: GetCrawlData) {
  const { config, getConfigControls, isConfigItem, isConfig } = useConfig();
  const notify = useNotification();

  /**
   * 通道 -> 插件项 的映射关系, 用于在触发插件项时找到对应的插件项配置
   */
  const [channelControlMap, setChannelControlMap] = useState<Record<string, PluginItem | ScriptConfigItem> | null>(null);

  /** 插件配置列表 */
  const [plugins, setPlugins] = useState<(PluginConfig | ScriptConfig)[] | null>(null);

  /** 
   * 不同插件的控制器值
   * 这里没有区分不同插件, 因为通道名称在全局范围内是唯一的
   */
  const [controlValues, setControlValues] = useState<
    Map<PluginItem | ScriptConfigItem, {
      value: string | number | boolean | null;
      plugin: PluginConfig | ScriptConfig;
    }>
  >(new Map());

  /**
   * 本次值更改发生变化的 PluginItem 列表
   */
  const [changedItems, setChangedItems] = useState<(PluginItem | ScriptConfigItem)[]>([]);

  // 当插件设置项发生变化时, 将旧的设置替换为新的设置, 继承旧设置的值, 删除旧设置的值变动记录
  useEffect(() => {
    const configControls = getConfigControls();
    if (plugins) {
      let oldConfigControls: ScriptConfig | null = null;
      const filtered = plugins.filter(plugin => {
        const is = isConfig(plugin)
        if (is) {
          oldConfigControls = plugin;
        }
        return !is
      });

      if (oldConfigControls && configControls !== oldConfigControls) {
        filtered.push(configControls);
        setPlugins(filtered);
        setChannelControlMap(() => {
          const map: Record<string, PluginItem | ScriptConfigItem> = {};
          filtered.forEach(plugin => {
            plugin.controls.forEach(control => {
              map[control.channel] = control;
            });
          });
          return map;
        });
        setControlValues((ov) => {
          const map = new Map<PluginItem | ScriptConfigItem, { value: string | number | boolean | null; plugin: PluginConfig | ScriptConfig }>(ov);
          oldConfigControls?.controls.forEach(control => {
            map.delete(control);
          });
          configControls.controls.forEach(control => {
            // 这里的 defaultValue 只有在这个设置选项初次出现时为默认值
            // 在出现过后就会保存在本地存储中, 之后均为本地存储中的值
            map.set(control, { value: control.options?.defaultValue ?? null, plugin: configControls });
          });
          return map;
        });
        setChangedItems((ov) => {
          const newList = ov.filter(item => {
            if (isConfigItem(item)) {
              return false;
            }
            return true;
          });
          return newList;
        });
      }
    }
  }, [getConfigControls, isConfig, isConfigItem, plugins])

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
      if (relatedControl) {
        relatedValues[channel] = controlValues.get(relatedControl)?.value ?? (scwcWarn(`未找到控制器值: ${channel}`), null);
      } else {
        scwcWarn(`未找到控制器: ${channel}`);
        relatedValues[channel] = null;
      }
    });
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
      if (isConfigItem(item)) {
        const value = controlValues.get(item);
        if (!value) {
          scwcWarn(`脚背设置控制器值未找到: ${item.channel}`);
          return;
        }
        item.trigger(value.value);
        return;
      }

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
  }, [controlValues, changedItems, fetchPluginTrigger, notify, isConfigItem]);

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
        const configControls = getConfigControls();
        setPlugins(() => {
          return [...plugins, configControls];
        });
        setChannelControlMap(() => {
          const map: Record<string, PluginItem> = {};
          [...plugins, configControls].forEach(plugin => {
            plugin.controls.forEach(control => {
              map[control.channel] = control;
            });
          });
          return map;
        });
        setControlValues(() => {
          const map = new Map<PluginItem, { value: string | number | boolean | null; plugin: PluginConfig | ScriptConfig }>();
          [...plugins, configControls].forEach(plugin => {
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
        const configControls = getConfigControls();
        // 只添加 script config 控制器, 以保证至少有设置项可用
        setPlugins([configControls]);
        setChannelControlMap(() => {
          const map: Record<string, PluginItem> = {};
          configControls.controls.forEach(control => {
            map[control.channel] = control;
          });
          return map;
        });
        setControlValues(() => {
          const map = new Map<PluginItem, { value: string | number | boolean | null; plugin: PluginConfig | ScriptConfig }>();
          configControls.controls.forEach(control => {
            map.set(control, { value: control.options?.defaultValue ?? null, plugin: configControls });
          });
          return map;
        });
        setChangedItems([]);
      })

  }, [getConfigControls, fetchPluginConfig, notify]);

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
    return controlValues.get(control)?.value ?? null;
  }, [controlValues]);

  return {
    plugins,
    setControlValue,
    getControlValue
  }
}
