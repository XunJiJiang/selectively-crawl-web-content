import type { PluginConfig, PluginItem } from "./plugin";

export type ScriptConfig = Omit<PluginConfig, 'controls'> & {
  'script-config-symbol': typeof CONFIG_SYMBOL; // 用于标识这是一个脚本配置项
  controls: ScriptConfigItem[];
}

export type ScriptConfigItem = PluginItem & {
  'script-config-symbol': typeof CONFIG_SYMBOL; // 用于标识这是一个脚本配置项
  trigger: (value: string | number | boolean | null) => void;
}