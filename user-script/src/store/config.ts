import { createContext } from '@lit/context';
import { v4 } from "uuid";
import type { ScriptConfig, ScriptConfigItem, TConfig } from "../types/config";
import { cache } from "../utils/cache";
import { CONFIG_KEY } from "../utils/common";
import { RefreshRuleParser } from "../utils/refreshRuleParser";
import { loadFromStorage, saveToStorage } from "../utils/storage";
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { debounce } from '../utils/debounce';
import { isEqual } from 'es-toolkit';

/** 匹配规则解析 */
export const parseRefreshRule = cache((rule: string) => {
  const ruleParser = new RefreshRuleParser();
  const result = ruleParser.parse(rule);
  return result;
})

const defaultValue: TConfig = {
  api: {
    host: import.meta.env.HOST ?? 'http://localhost',
    port: import.meta.env.PORT ?? '3200',
    token: '',
  },
  plugin: {
    refreshRule: '//', // 默认匹配整个pathname的变化, 不检测search和hash的变化
  }
};

const CONFIG_SYMBOL = Symbol('config');
const configId = `config-${v4()}`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isConfig (config: any): config is ScriptConfig {
  return config && typeof config === 'object' && config['script-config-symbol'] === CONFIG_SYMBOL;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isConfigItem (item: any): item is ScriptConfigItem {
  return item && typeof item === 'object' && item['script-config-symbol'] === CONFIG_SYMBOL && typeof (item as ScriptConfigItem).trigger === 'function';
}

export type { TConfig } from '../types/config';
export const configContext = createContext<TConfig>(CONFIG_SYMBOL);

window.addEventListener('storage', (e: StorageEvent) => {
  if (e.key === CONFIG_KEY && e.newValue) {
    if (!isEqual(ConfigController.config, JSON.parse(e.newValue))) {
      ConfigController.config = JSON.parse(e.newValue);
      ConfigController.dispatchConfigUpdate();
    }
  }
});

export class ConfigController implements ReactiveController {
  static config: TConfig = loadFromStorage(CONFIG_KEY, defaultValue);
  static allControllers: Set<ConfigController> = new Set();
  /** 同样是所有控制器的 Set, 但是使用 WeakSet */
  static allControllersWeak: WeakSet<ConfigController> = new WeakSet();
  /** 清理 Set 中已经不存在的控制器 */
  static cleanUnmountedControllers () {
    for (const controller of ConfigController.allControllers) {
      if (!ConfigController.allControllersWeak.has(controller)) {
        ConfigController.allControllers.delete(controller);
      }
    }
  }
  /** 派发配置更新 */
  static dispatchConfigUpdate () {
    ConfigController.cleanUnmountedControllers();
    for (const controller of ConfigController.allControllers) {
      controller.setConfig(ConfigController.config);
    }
  }

  host: ReactiveControllerHost;

  config = ConfigController.config;
  configControls: ScriptConfig = {
    id: 'script-config',
    title: '设置',
    description: '插件配置',
    "script-config-symbol": CONFIG_SYMBOL,
    controls: this.createConfigControls(),
  }

  private createConfigControls (config?: TConfig): ScriptConfigItem[] {
    const currentConfig = config ?? this.config;
    return [{
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'Host',
      channel: `${configId}-api-host`,
      options: {
        defaultValue: currentConfig.api.host,
      },
      trigger: (value) => {
        debounce(
          (value) =>
            this.setConfig({
              ...this.config,
              api: {
                ...this.config.api,
                host: value as string,
              },
            }),
          500)(value)
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'Port',
      channel: `${configId}-api-port`,
      options: {
        defaultValue: currentConfig.api.port,
      },
      trigger: (value) => {
        debounce(
          (value) =>
            this.setConfig({
              ...this.config,
              api: {
                ...this.config.api,
                port: value as string,
              },
            }),
          500)(value)
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'API Token',
      channel: `${configId}-api-token`,
      options: {
        defaultValue: currentConfig.api.token,
      },
      trigger: (value) => {
        debounce(
          (value) =>
            this.setConfig({
              ...this.config,
              api: {
                ...this.config.api,
                token: value as string,
              },
            }),
          500)(value)
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: '插件配置刷新规则',
      channel: `${configId}-plugin-refreshRule`,
      options: {
        defaultValue: currentConfig.plugin.refreshRule,
      },
      trigger: (value) =>
        debounce(
          (value) =>
            this.setConfig({
              ...this.config,
              plugin: {
                ...this.config.plugin,
                refreshRule: value as string,
              },
            }),
          500)(value)
    }];
  }

  setConfig (newConfig: TConfig) {
    if (isEqual(this.config, newConfig)) {
      return;
    }
    saveToStorage(CONFIG_KEY, newConfig);
    this.config = newConfig;
    this.configControls = {
      ...this.configControls,
      controls: this.createConfigControls(newConfig),
    }
    this.host.requestUpdate();
    this.onConfigUpdate(this.config);
  }

  private onConfigUpdate: (config: TConfig) => void = () => {};

  constructor(host: ReactiveControllerHost, onConfigUpdate?: (config: TConfig) => void) {
    (this.host = host).addController(this);
    ConfigController.allControllers.add(this);
    ConfigController.allControllersWeak.add(this);
    if (onConfigUpdate) {
      this.onConfigUpdate = onConfigUpdate;
    }
  }

  hostConnected () {}
  hostDisconnected () {}
}
