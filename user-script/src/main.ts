import './layouts/root.ts';
import './components/button.ts';
import './components/input.ts';
import './components/trigger.ts';
import './components/toggle.ts';
import './components/select.ts';
import './components/checkbox.ts';
import updateLocalStorage from './utils/updateLocalStorage.ts';

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
mount.appendChild(rootEl);
