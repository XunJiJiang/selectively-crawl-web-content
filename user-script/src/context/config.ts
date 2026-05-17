import { createContext, useCallback, useEffect, useState } from 'react';
import { v4 } from 'uuid';
import { debounce } from '../utils/debounce';
import { cache } from '../utils/cache';
import { RefreshRuleParser } from '../utils/refreshRuleParser';
import type { ScriptConfig, ScriptConfigItem, TConfig } from '../types/config';
import { CONFIG_KEY } from '../utils/common';
import { loadFromStorage, saveToStorage } from '../utils/storage';

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

const config: TConfig = loadFromStorage(CONFIG_KEY, defaultValue);

const ConfigContext = createContext(config);

export default ConfigContext;

const CONFIG_SYMBOL = Symbol('config');

const configId = `config-${v4()}`;

export function useConfig (): {
  getConfigControls: () => ScriptConfig,
  config: TConfig,
  isConfigItem: (item: unknown) => item is ScriptConfigItem,
  isConfig: (config: unknown) => config is ScriptConfig,
} {
  const [_config, setConfig] = useState<TConfig>(loadFromStorage(CONFIG_KEY, defaultValue));

  const createConfigControls = useCallback((): ScriptConfig => ({
    id: configId,
    title: '设置',
    description: '插件配置',
    "script-config-symbol": CONFIG_SYMBOL,
    controls: [{
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'Host',
      channel: `${configId}-api-host`,
      options: {
        defaultValue: _config.api.host,
      },
      trigger: (value) => {
        setConfig(prev => ({
          ...prev,
          api: {
            ...prev.api,
            host: value as string,
          },
        }));
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'Port',
      channel: `${configId}-api-port`,
      options: {
        defaultValue: _config.api.port,
      },
      trigger: (value) => {
        setConfig(prev => ({
          ...prev,
          api: {
            ...prev.api,
            port: value as string,
          },
        }));
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: 'API Token',
      channel: `${configId}-api-token`,
      options: {
        defaultValue: _config.api.token,
      },
      trigger: (value) => {
        setConfig(prev => ({
          ...prev,
          api: {
            ...prev.api,
            token: value as string,
          },
        }));
      }
    }, {
      'script-config-symbol': CONFIG_SYMBOL,
      type: 'input:text',
      label: '插件配置刷新规则',
      channel: `${configId}-plugin-refreshRule`,
      options: {
        defaultValue: _config.plugin.refreshRule,
      },
      trigger: (value) =>
        debounce(
          (value) =>
            setConfig(prev => ({
              ...prev,
              plugin: {
                ...prev.plugin,
                refreshRule: value as string,
              },
            })),
          500)(value)
    }],
  }), [_config]);

  const [configControls, setConfigControls] = useState<ScriptConfig>(createConfigControls());

  // 更新配置项
  useEffect(() => {
    saveToStorage(CONFIG_KEY, _config);
  }, [_config]);

  // 监听配置更新，更新配置项
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONFIG_KEY && e.newValue) {
        if (JSON.stringify(_config) !== e.newValue) {
          setConfig(JSON.parse(e.newValue));
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
    };
  }, [_config]);

  useEffect(() => {
    const configControls = createConfigControls();
    setConfigControls(configControls);
  }, [createConfigControls]);

  return {
    getConfigControls: useCallback(() => configControls, [configControls]),
    config: _config,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isConfigItem: useCallback((item: any): item is ScriptConfigItem => {
      return item && typeof item === 'object' && item['script-config-symbol'] === CONFIG_SYMBOL;
    }, []),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    isConfig: useCallback((config: any): config is ScriptConfig => {
      return config && typeof config === 'object' && config['script-config-symbol'] === CONFIG_SYMBOL;
    }, []),
  };
}

