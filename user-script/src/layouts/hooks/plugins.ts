import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { PluginConfig, PluginItem } from "../../types/plugin";
import type { ScriptConfig, ScriptConfigItem } from "../../types/config";

/** 插件项是否没有加载远程控制器 */
function isPluginItemUnloaded (plugins: (PluginConfig | ScriptConfig)[] | null) {
  return plugins === null
}

export class PluginsController implements ReactiveController {
  host: ReactiveControllerHost;

  constructor(host: ReactiveControllerHost) {
    (this.host = host).addController(this);
  }

  hostConnected () {}
  hostDisconnected () {}

  plugins: (PluginConfig | ScriptConfig)[] | null = null
  /** 当前激活的标签页的ID */
  activeTab = ''
  /** 当前激活的插件 */
  activePlugin: PluginConfig | ScriptConfig | null = null

  /** 通道 -> 插件项 的映射关系, 用于在触发插件项时找到对应的插件项配置 */
  private channelControlMap: Record<string, PluginItem | ScriptConfigItem> | null = null

  /**
   * 不同插件的控制器值
   * 这里没有区分不同插件, 因为通道名称在全局范围内是唯一的
   */
  private controlValues = new Map<PluginItem | ScriptConfigItem, {
    value: string | number | boolean | null;
    plugin: PluginConfig | ScriptConfig;
  }>()

  /** 本次值更改发生变化的 PluginItem 列表 */
  private changedItems: (PluginItem | ScriptConfigItem)[] = []

  setPlugins (plugins: (PluginConfig | ScriptConfig)[]) {
    if (plugins === this.plugins) {
      return;
    }
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