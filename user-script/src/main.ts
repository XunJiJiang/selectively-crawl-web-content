import './layouts/root';
import './components/button';
import './components/input';
import './components/trigger';
import './components/toggle';
import './components/select';
import './components/checkbox'

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
  `;
  document.body.appendChild(mount);
}

const rootEl = document.createElement('scwc-layout-root');
mount.appendChild(rootEl);