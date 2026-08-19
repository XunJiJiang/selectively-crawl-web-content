import { defaultValue, type TConfig } from '../../shared/store/config.ts';
import type { JSONValueWithFunction } from '../../shared/types/utils';
import { CONFIG_KEY } from '../../shared/utils/common.ts';
import { loadFromStorage } from '../../shared/utils/storage.ts';
import { createFetch, type TFetch } from './utils/fetch.ts';

// TODO: 动态更新配置
// TODO: 当处于子页面时, 从父页面获取配置, 此时允许隐藏子页面 SCWC 窗口
// TODO: 单独打开子页面时从 localStorage 获取配置, 此时不允许隐藏子页面 SCWC 窗口

type TPrivateSCWCUtils = {
  hasInitialized: boolean;
} & TSCWCUtils;

export type TSCWCUtils = {
  fetch: TFetch;
};

const scwcutils: TPrivateSCWCUtils = {
  hasInitialized: false,
  fetch: (() => {
    console.warn('scwcutils.fetch 未初始化, 请在页面加载完成后再使用 scwcutils.fetch');
  }) as unknown as TFetch,
};

window.addEventListener('message', (event) => {
  const message = event.data as {
    type: 'scwc-plugin-config';
    config: TConfig;
  };
  if (message.type !== 'scwc-plugin-config') {
    return;
  }
  // 以父页面的配置为准
  // 即使 scwcutils 已经初始化过了, 也要重新初始化
  createFetch(message.config).then((fetch) => {
    scwcutils.fetch = fetch;
    scwcutils.hasInitialized = true;
  });
});

// 在没有父页面的情况下, 直接从 localStorage 获取配置并初始化
// 只在页面加载完成后初始化一次, 不监听配置变化
// 当配置变化后, 需要刷新页面才能生效
window.addEventListener('load', () => {
  // 如果 scwcutils 已经初始化过了, 则不再重复初始化
  if (!scwcutils.hasInitialized) {
    const config: TConfig = loadFromStorage(
      CONFIG_KEY,
      defaultValue as unknown as JSONValueWithFunction,
      'a',
    );
    createFetch(config).then((fetch) => {
      scwcutils.fetch = fetch;
      scwcutils.hasInitialized = true;
    });
  }
});

export default scwcutils;
