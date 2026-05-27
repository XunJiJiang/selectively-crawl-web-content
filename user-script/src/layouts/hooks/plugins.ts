import type { ReactiveController } from "lit";
import type { PluginConfig, PluginItem, TRequiredOptions } from "../../types/plugin";
import type { ScriptConfig, ScriptConfigItem } from "../../types/config";
import { ConfigController, isConfig, isConfigItem } from "../../store/config";
import { debounce } from "../../utils/debounce";
import { fetchPlugins, triggerPlugin } from "../../api/plugins";
import { getCrawlData } from "../../utils/claw";
import type { SCWCContentPlugin } from "../content-plugin";

/** 插件项是否没有加载远程控制器 */
function isPluginItemUnloaded (plugins: (PluginConfig | ScriptConfig)[] | null) {
  return plugins === null || plugins.every(plugin => isConfig(plugin))
}

/** 获取完整的选项 */
function getFullOptions (control: PluginItem): TRequiredOptions {
  return {
    requireFullContent: true,
    relatedChannel: [],
    autoTrigger: false,
    defaultValue: null,
    options: [],
    ...control.options,
  };
}

// 监听网页 url 变化
const urlChangeCallbacks = new Set<() => void>();
window.addEventListener('urlchangeevent', () => {
  urlChangeCallbacks.forEach(callback => callback());
});

export class PluginsController implements ReactiveController {
  host: SCWCContentPlugin;

  private configController: ConfigController;

  constructor(host: SCWCContentPlugin) {
    (this.host = host).addController(this);
    this.configController = new ConfigController(host, () => {
      const configControls = this.configController.configControls;
      if (this.plugins) {
        let oldConfigControls: ScriptConfig | null = null;
        const filtered: (PluginConfig | ScriptConfig)[] = [];
        for (const plugin of this.plugins) {
          if (isConfig(plugin)) {
            oldConfigControls = plugin;
          } else {
            filtered.push(plugin);
          }
        }
        if (oldConfigControls && configControls !== oldConfigControls) {
          filtered.unshift(configControls);
          this.setPlugins(filtered);
          const newControlValues = new Map<PluginItem, { value: string | number | boolean | null; plugin: PluginConfig }>(this.controlValues);
          oldConfigControls?.controls.forEach(control => {
            newControlValues.delete(control);
          });
          configControls.controls.forEach(control => {
            newControlValues.set(control, {
              value: control.options?.defaultValue ?? null,
              plugin: configControls,
            });
          });
          this.controlValues = newControlValues;
        }
      } else {
        this.setPlugins([configControls]);
      }
    });
  }

  private onUrlChange = () => {
    this.reloadPlugins();
  }

  hostConnected () {
    urlChangeCallbacks.add(this.onUrlChange);
  }
  hostDisconnected () {
    urlChangeCallbacks.delete(this.onUrlChange);
  }

  plugins: (PluginConfig | ScriptConfig)[] | null = null
  /** 当前激活的标签页的ID */
  activeTab = ''
  /** 当前激活的插件 */
  activePlugin: PluginConfig | ScriptConfig | null = null

  /** 插件控制器触发器 */
  private triggerExecutorFunctions = new Map<PluginItem | ScriptConfigItem, (pluginId: string, channel: string, control: PluginItem | ScriptConfigItem, value: string | number | boolean | null) => void>();

  /** 通道 -> 插件项 的映射关系, 用于在触发插件项时找到对应的插件项配置 */
  private channelControlMap: Record<string, PluginItem> | null = null

  /**
   * 不同插件的控制器值
   * 这里没有区分不同插件, 因为通道名称在全局范围内是唯一的
   */
  private controlValues = new Map<PluginItem | ScriptConfigItem, {
    value: string | number | boolean | null;
    plugin: PluginConfig | ScriptConfig;
  }>()

  /** 修改/触发插件控制器值的方法 */
  setControlValue (control: PluginItem | ScriptConfigItem, value: string | number | boolean | null) {
    const newControlValues = new Map(this.controlValues);
    const controlInfo = newControlValues.get(control);
    if (!controlInfo) {
      console.warn('插件控制器值未找到:', control.channel);
      return;
    }
    newControlValues.set(control, {
      value,
      plugin: controlInfo.plugin,
    });
    this.controlValues = newControlValues;

    const triggerFunction = this.triggerExecutorFunctions.get(control);
    if (!triggerFunction) {
      console.warn('未找到控制器触发函数:', control.channel);
      // TODO: 需要添加弹窗通知
      return;
    }
    triggerFunction(
      controlInfo.plugin.id,
      control.channel,
      control,
      value,
    );
  }

  getControlValue (control: PluginItem | ScriptConfigItem): string | number | boolean | null {
    return this.controlValues.get(control)?.value ?? null;
  }

  /** 获取某个插件项的控制器的相关的值 */
  private getRelatedValues (control: PluginItem): Record<string, string | number | boolean | null> {
    const relatedValues: Record<string, string | number | boolean | null> = {};
    const options = getFullOptions(control);
    options.relatedChannel?.forEach(channel => {
      const relatedControl = this.channelControlMap?.[channel];
      if (relatedControl) {
        relatedValues[channel] = this.controlValues.get(relatedControl)?.value ?? (console.warn(`未找到控制器值: ${channel}`), null);
      } else {
        console.warn(`未找到控制器: ${channel}`);
        relatedValues[channel] = null;
      }
    });
    return relatedValues;
  }

  // /** 本次值更改发生变化的 PluginItem 列表 */
  // private changedItems: (PluginItem)[] = []

  /** 请求插件列表 */
  async requestPlugins () {
    if (!this.host.expanded) {
      return;
    }
    if (isPluginItemUnloaded(this.plugins)) {
      this.reloadPlugins();
    }
  }

  /** 重新请求插件列表 */
  async reloadPlugins () {
    // 这里直接将 plugins 置为 null, 让页面进入加载状态, 等新的插件列表加载完成后再更新 plugins
    this.setPlugins(null);
    this.setActiveTab('');
    this.setActivePlugin(null);
    this.channelControlMap = null;
    this.controlValues = new Map();

    try {
      const plugins = await fetchPlugins(this.configController.config);
      this.setPlugins([...plugins, this.configController.configControls]);
    } catch (e) {
      console.error('Failed to reload plugins:', e);
      this.setPlugins(this.configController.configControls ? [this.configController.configControls] : []);
    }
  }

  setPlugins (plugins: (PluginConfig | ScriptConfig)[] | null) {
    if (plugins === this.plugins) {
      return;
    }
    const oldPlugins = this.plugins;
    this.plugins = plugins;
    // 当插件列表发生变化时, 需要根据新的插件列表和当前的activeTab来更新activeTab和activePlugin
    const activePluginIdx = this.plugins?.map(plugin => plugin.id).indexOf(this.activeTab);
    const res: {
      activeTab: string;
      activePlugin: PluginConfig | ScriptConfig | null;
    } = {
      activeTab: '',
      activePlugin: null,
    }
    if (this.plugins && activePluginIdx && activePluginIdx !== -1) {
      if (this.activePlugin !== this.plugins[activePluginIdx]) {
        // 当id相同但是实例不同时, 说明插件被重新加载了, 需要更新activePlugin的实例
        res.activeTab = this.plugins[activePluginIdx].id;
        res.activePlugin = this.plugins[activePluginIdx];
      } else {
        // 实例相同, 插件无变化, 不需要更新
        res.activeTab = this.activeTab;
        res.activePlugin = this.activePlugin;
      }
    } else if (this.plugins && this.plugins.length >= 1) {
      // 没有找到之前的activeTab了, 切换到第一个插件
      res.activeTab = this.plugins[0].id;
      res.activePlugin = this.plugins[0];
    } else {
      res.activeTab = '';
      res.activePlugin = null;
    }

    // 更新插件控制器的触发器函数
    const newTriggerExecutorFunctions = new Map<PluginItem | ScriptConfigItem, (pluginId: string, channel: string, control: PluginItem | ScriptConfigItem, value: string | number | boolean | null) => void>();
    plugins?.forEach(plugin => {
      plugin.controls.forEach(control => {
        const needLazyFetchType = ['input:text', 'input:number'].includes(control.type);
        newTriggerExecutorFunctions.set(
          control,
          isConfigItem(control)
            ? (_pluginId: string, _channel: string, control: PluginItem | ScriptConfigItem, value: string | number | boolean | null) => {
              if (isConfigItem(control)) {
                control.trigger(value);
              } else {
                console.error('错误的分支判断, control 应该是 ScriptConfigItem 类型');
              }
            }
            : (pluginId: string, channel: string, control: PluginItem, value: string | number | boolean | null) => {
              this.host.requestUpdate();
              debounce((pluginId: string, channel: string, control: PluginItem, value: string | number | boolean | null) => {
                triggerPlugin(
                  control.type === 'button' ? 'click' : 'change',
                  pluginId, channel, control, value,
                  getFullOptions(control),
                  getCrawlData(this.host.clawItems),
                  this.getRelatedValues(control),
                  this.configController.config
                );
              }, needLazyFetchType ? 500 : 0)(pluginId, channel, control, value)
            })
      });
    });
    this.triggerExecutorFunctions = newTriggerExecutorFunctions;

    const newChannelControlMap: Record<string, PluginItem> = {};
    [...(plugins ?? []), this.configController.configControls].forEach(plugin => {
      plugin.controls.forEach(control => {
        newChannelControlMap[control.channel] = control;
      });
    });
    this.channelControlMap = newChannelControlMap;
    // 尝试保持之前的控制器值
    const newControlValues = new Map<PluginItem, { value: string | number | boolean | null; plugin: PluginConfig }>(this.controlValues);
    plugins?.forEach(plugin => {
      plugin.controls.forEach(control => {
        const oldControl = oldPlugins?.find(p => p.id === plugin.id)?.controls.find(c => c.channel === control.channel);
        if (oldControl) {
          newControlValues.set(control, this.controlValues.get(oldControl) ?? { value: control.options?.defaultValue ?? null, plugin });
        } else {
          newControlValues.set(control, { value: control.options?.defaultValue ?? null, plugin });
        }
        console.log('设置控制器值:', control.channel, newControlValues.get(control));
      });
    });

    this.setActiveTab(res.activeTab);
    this.setActivePlugin(res.activePlugin);
  }

  setActiveTab (activeTab: string) {
    if (activeTab === this.activeTab) {
      return;
    }
    this.activeTab = activeTab;
    this.host.requestUpdate();
  }

  setActivePlugin (activePlugin: PluginConfig | ScriptConfig | null) {
    if (activePlugin === this.activePlugin) {
      return;
    }
    this.activePlugin = activePlugin;
    this.host.requestUpdate();
  }
}