import type { TConfig } from '../../shared/store/config.ts';
import { createFetch, type TFetch } from './utils/fetch.ts';

// TODO: 动态更新配置
// TODO: 当处于子页面时, 从父页面获取配置, 此时允许隐藏子页面 SCWC 窗口
// TODO: 单独打开子页面时从 localStorage 获取配置, 此时不允许隐藏子页面 SCWC 窗口

export type TSCWCUtils = {
  fetch: TFetch;
};

const scwcutils: TSCWCUtils = {
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
  createFetch(message.config).then((fetch) => {
    scwcutils.fetch = fetch;
  });
});

export default scwcutils;
