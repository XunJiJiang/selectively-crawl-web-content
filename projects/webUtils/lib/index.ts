import type { TConfig } from '../../shared/store/config.ts';
import { createFetch, type TFetch } from './utils/fetch.ts';

console.log('webutils loaded');

export type TWebUtils = {
  fetch: TFetch;
};

const webutils: TWebUtils = {
  fetch: (() => {
    console.warn('webutils.fetch 未初始化, 请在页面加载完成后再使用 webutils.fetch');
  }) as unknown as TFetch,
};

window.addEventListener('message', (event) => {
  const message = event.data as {
    type: 'plugin-config';
    config: TConfig;
  };
  createFetch(message.config).then((fetch) => {
    webutils.fetch = fetch;
  });
});

export default webutils;
