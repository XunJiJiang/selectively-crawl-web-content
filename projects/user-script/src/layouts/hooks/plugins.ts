import { siteStore } from '../../site-store.ts';
import type { ReactiveController } from 'lit';
import type { PluginConfig, PluginItem, TRequiredOptions } from '../../../../shared/types/plugin';
import type { ScriptConfig, ScriptConfigItem } from '../../../../shared/types/config.d.ts';
import { ConfigController, isConfig, isConfigItem } from '../../../../shared/store/config.ts';
import { fetchPlugins, triggerPlugin } from '../../api/plugins.ts';
import { getCrawlData } from '../../utils/claw.ts';
import type { SCWCContentPlugin } from '../content-plugin.ts';
import { notify } from '../../utils/notify.ts';
import { watchUrl } from '../../utils/url-watch.ts';

function getFullOptions(control: PluginItem): TRequiredOptions {
  return {
    requireFullContent: true,
    relatedChannel: [],
    autoTrigger: false,
    defaultValue: null,
    options: [],
    ...control.options,
  };
}

export class PluginsController implements ReactiveController {
  host: SCWCContentPlugin;
  private configController: ConfigController;
  private apiKey = '';
  private stopWatching?: () => void;
  private request?: AbortController;
  private generation = 0;
  private loading?: Promise<void>;
  private lastSite?: string;
  private initial = true;
  private timers = new Map<PluginItem, ReturnType<typeof setTimeout>>();
  private controlValues = new Map<
    PluginItem | ScriptConfigItem,
    { value: string | number | boolean | null; plugin: PluginConfig | ScriptConfig }
  >();
  private channelControlMap = new Map<string, PluginItem>();
  plugins: (PluginConfig | ScriptConfig)[] | null = null;
  activeTab = '';
  activePlugin: PluginConfig | ScriptConfig | null = null;

  constructor(host: SCWCContentPlugin) {
    (this.host = host).addController(this);
    this.configController = new ConfigController(host, () => {
      const key = JSON.stringify(this.configController.config.api);
      const changed = this.apiKey && this.apiKey !== key;
      this.apiKey = key;
      this.setPlugins([
        this.configController.configControls,
        ...(this.plugins ?? []).filter((p) => !isConfig(p)),
      ]);
      if (changed && !this.initial) {
        void this.reloadPlugins(true);
      }
    });
    this.apiKey = JSON.stringify(this.configController.config.api);
  }
  hostConnected() {
    this.stopWatching = watchUrl(() => {
      if (!this.initial) {
        void this.reloadPlugins();
      }
    });
    siteStore.addEventListener('change', this.siteChanged);
    siteStore.addEventListener('connected', this.reconnected);
  }
  hostDisconnected() {
    this.stopWatching?.();
    this.request?.abort();
    this.generation++;
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    siteStore.removeEventListener('change', this.siteChanged);
    siteStore.removeEventListener('connected', this.reconnected);
  }
  private reconnected = () => {
    if (!this.initial) {
      void this.reloadPlugins(true);
    }
  };
  private siteChanged = () => {
    this.restoreValues();
    const selected = this.plugins?.find((p) => p.id === siteStore.snapshot.data.plugin.activeTab);
    if (selected) {
      this.setActiveTab(selected.id);
      this.setActivePlugin(selected);
    }
    this.host.requestUpdate();
  };
  async requestPlugins() {
    if (!this.host.expanded || !this.initial) {
      return;
    }
    this.initial = false;
    await this.reloadPlugins(true);
  }
  async reloadPlugins(force = false) {
    const loading = this.loadPlugins(force);
    this.loading = loading;
    try {
      await loading;
    } finally {
      if (this.loading === loading) {
        this.loading = undefined;
      }
    }
  }
  private async loadPlugins(force: boolean) {
    const generation = ++this.generation,
      site = window.location.href;
    this.request?.abort();
    this.request = new AbortController();
    try {
      const batch = await fetchPlugins(this.configController.config, {
        site,
        previousSite: force ? undefined : this.lastSite,
        signal: this.request.signal,
      });
      if (generation !== this.generation) {
        return;
      }
      if (site !== window.location.href) {
        void this.reloadPlugins();
        return;
      }
      this.lastSite = site;
      const active = new Set(batch.activeIds),
        updated = new Set(batch.updatedIds);
      const retained = force
        ? []
        : (this.plugins ?? []).filter(
            (p) => !isConfig(p) && active.has(p.id) && !updated.has(p.id),
          );
      const merged = new Map([...retained, ...batch.plugins].map((plugin) => [plugin.id, plugin]));
      this.setPlugins([
        this.configController.configControls,
        ...batch.activeIds.flatMap((id) => {
          const plugin = merged.get(id);
          return plugin ? [plugin] : [];
        }),
      ]);
      const wanted = this.plugins?.find(
        (p) => p.id === (siteStore.snapshot.data.plugin.activeTab || this.host.currentPluginTab),
      );
      if (wanted) {
        this.setActiveTab(wanted.id);
        this.setActivePlugin(wanted);
      }
    } catch (error) {
      if (generation !== this.generation || this.request.signal.aborted) {
        return;
      }
      if (!this.plugins) {
        this.setPlugins([this.configController.configControls]);
      }
      notify({
        title: '插件加载失败',
        description: error instanceof Error ? error.message : String(error),
        type: 'error',
        placement: this.configController.config.notify.placement,
      });
    }
  }
  setControlValue(control: PluginItem | ScriptConfigItem, value: string | number | boolean | null) {
    const info = this.controlValues.get(control);
    if (!info) {
      return;
    }
    this.controlValues.set(control, { ...info, value });
    if (isConfigItem(control)) {
      control.trigger(value);
      return;
    }
    if (control.type !== 'button') {
      siteStore.update((data) => {
        data.controls = data.controls.filter(
          (item) => item.pluginId !== info.plugin.id || item.channel !== control.channel,
        );
        data.controls.push({ pluginId: info.plugin.id, channel: control.channel, value });
      });
    }
    this.host.requestUpdate();
    clearTimeout(this.timers.get(control));
    const invoke = async () => {
      this.timers.delete(control);
      while (this.loading) {
        await this.loading;
      }
      if (!this.host.isConnected || !this.controlValues.has(control)) {
        return;
      }
      void triggerPlugin(
        control.type === 'button' ? 'click' : 'change',
        info.plugin.id,
        control.channel,
        control,
        value,
        getFullOptions(control),
        getCrawlData(this.host.clawItems),
        this.getRelatedValues(control),
        this.configController.config,
      );
    };
    if (['input:text', 'input:number'].includes(control.type)) {
      this.timers.set(
        control,
        setTimeout(() => {
          void invoke();
        }, 500),
      );
    } else {
      void invoke();
    }
  }
  getControlValue(control: PluginItem | ScriptConfigItem) {
    return this.controlValues.get(control)?.value ?? null;
  }
  private getRelatedValues(control: PluginItem) {
    const result: Record<string, string | number | boolean | null> = {};
    for (const channel of getFullOptions(control).relatedChannel) {
      const related = this.channelControlMap.get(channel);
      result[channel] = related ? this.getControlValue(related) : null;
    }
    return result;
  }
  private restoreValues() {
    for (const [control, info] of this.controlValues) {
      if (isConfig(info.plugin)) {
        continue;
      }
      const saved = siteStore.snapshot.data.controls.find(
        (item) => item.pluginId === info.plugin.id && item.channel === control.channel,
      );
      this.controlValues.set(control, {
        ...info,
        value: saved ? saved.value : (control.options?.defaultValue ?? null),
      });
    }
  }
  setPlugins(plugins: (PluginConfig | ScriptConfig)[] | null) {
    const previous = this.controlValues;
    this.plugins = plugins;
    this.controlValues = new Map();
    this.channelControlMap.clear();
    for (const plugin of plugins ?? []) {
      for (const control of plugin.controls) {
        this.channelControlMap.set(control.channel, control);
        this.controlValues.set(control, {
          plugin,
          value: isConfig(plugin)
            ? (control.options?.defaultValue ?? null)
            : (previous.get(control)?.value ?? control.options?.defaultValue ?? null),
        });
      }
    }
    this.restoreValues();
    const selected = plugins?.find((p) => p.id === this.activeTab) ?? plugins?.[0] ?? null;
    this.setActiveTab(selected?.id ?? '');
    this.setActivePlugin(selected);
    this.host.requestUpdate();
  }
  setActiveTab(activeTab: string) {
    if (activeTab !== this.activeTab) {
      this.activeTab = activeTab;
      this.host.requestUpdate();
    }
  }
  setActivePlugin(activePlugin: PluginConfig | ScriptConfig | null) {
    if (activePlugin !== this.activePlugin) {
      this.activePlugin = activePlugin;
      this.host.requestUpdate();
    }
  }
}
