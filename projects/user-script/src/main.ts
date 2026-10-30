import './migrate.ts';
import './layouts/root.ts';
import iconFont from '@vscode/codicons/dist/codicon.ttf?inline';
import '../../shared/components/index.ts';
import type { TConfig } from '../../shared/store/config.ts';

if (!document.getElementById('scwc-userscript-font')) {
  const font = document.createElement('style');
  font.id = 'scwc-userscript-font';
  font.textContent = `@font-face { font-family: codicon; src: url("${iconFont}") format("truetype"); font-display: block; }`;
  document.head.appendChild(font);
}

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

if (document.readyState === 'complete') {
  mount.appendChild(rootEl);
} else {
  window.addEventListener('load', () => mount.appendChild(rootEl), { once: true });
}
