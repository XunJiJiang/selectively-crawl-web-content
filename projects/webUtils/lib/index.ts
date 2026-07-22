import type { TConfig } from '../../shared/store/config.ts';
import { createFetch, type TFetch } from './utils/fetch.ts';

console.log('webUtils loaded');

export type TWebUtils = {
  fetch: TFetch;
};

const webUtils: TWebUtils = {
  fetch: (() => {
    console.warn('webUtils.fetch 未初始化, 请在页面加载完成后再使用 webUtils.fetch');
  }) as unknown as TFetch,
};

window.addEventListener('message', (event) => {
  const message = event.data as {
    type: 'plugin-config';
    config: TConfig;
  };
  createFetch(message.config).then((fetch) => {
    webUtils.fetch = fetch;
    console.log('webUtils.fetch 初始化完成');
    setTimeout(() => {
      console.log('webUtils' in window ? 'webUtils 已挂载到 window' : 'webUtils 未挂载到 window');
      console.log('webUtils' in window ? window.webUtils : 'window.webUtils 未定义');
    }, 1000);
  });
});

export default webUtils;
