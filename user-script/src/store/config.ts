import { createContext } from '@lit/context';
import { v4 } from "uuid";
import type { TConfig } from "../types/config";
import { cache } from "../utils/cache";
import { CONFIG_KEY } from "../utils/common";
import { RefreshRuleParser } from "../utils/refreshRuleParser";
import { loadFromStorage } from "../utils/storage";

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

export const config: TConfig = loadFromStorage(CONFIG_KEY, defaultValue);
const CONFIG_SYMBOL = Symbol('config');
const configId = `config-${v4()}`;

export type { TConfig } from '../types/config';
export const configContext = createContext<TConfig>(CONFIG_SYMBOL);
