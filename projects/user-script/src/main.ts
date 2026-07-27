import './layouts/root.ts';
import '../../shared/components/index.ts';
import updateLocalStorage from '../../shared/utils/updateLocalStorage.ts';
import type { TConfig } from '../../shared/store/config.ts';

// 更新本地存储的数据格式
updateLocalStorage();

// 悬浮窗挂载点
const FLOATING_ID = 'selective-crawl-floating-root';
let mount = document.getElementById(FLOATING_ID);
if (!mount) {
  mount = document.createElement('div');
  mount.id = FLOATING_ID;
  mount.style.cssText = `
    z-index: 2147483647;
    font-weight: 400;
    font-size: 11px;
    position: fixed;
    left: 0;
    top: 0;
  `;
  document.body.appendChild(mount);
}

const rootEl = document.createElement('scwc-layout-root');

window.addEventListener('message', (event) => {
  const message = event.data as {
    type: 'scwc-plugin-hinder';
    config: TConfig;
    isSameOrigin: boolean;
  };
  if (message.type !== 'scwc-plugin-hinder') {
    return;
  } else if (message.isSameOrigin) {
    rootEl.style.display = 'none';
  }
});

window.addEventListener('load', () => {
  mount.appendChild(rootEl);
});
