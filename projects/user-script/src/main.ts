import './migrate.ts';
import './layouts/root.ts';
import iconFont from '@vscode/codicons/dist/codicon.ttf?inline';
import '../../shared/components/index.ts';
import type { TConfig } from '../../shared/store/config.ts';

function inWorkbench() {
  let page: Window = window;
  for (;;) {
    try {
      // 能读取祖先 document 即与该祖先同源；跨源祖先的访问会抛出异常。
      const doc = page.document;
      if (
        doc.querySelector('meta[name="scwc-app"][content="workbench"]') ||
        (doc.querySelector('app-root') && doc.title === 'SCWC · 插件工作台')
      ) {
        return true;
      }
    } catch {
      // 跨源父页不决定本页是否显示，继续检查其他可访问的祖先。
    }
    const parent = page.parent;
    if (parent === page) {
      return false;
    }
    page = parent;
  }
}

function mountFloatingWindow() {
  // 等待 DOM 完整后识别工作台及其同源 iframe，兼容任意部署主机和端口。
  if (inWorkbench()) {
    return;
  }
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
    if (message?.type !== 'scwc-plugin-hinder') {
      return;
    } else if (message.isSameOrigin) {
      rootEl.style.display = 'none';
    }
  });

  mount.appendChild(rootEl);
}

if (document.readyState === 'complete') {
  mountFloatingWindow();
} else {
  window.addEventListener('load', mountFloatingWindow, { once: true });
}
