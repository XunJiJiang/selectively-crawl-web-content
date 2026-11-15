import './csp.ts';
import './migrate.ts';
import './layouts/root.ts';
import '../../shared/components/index.ts';
import { ConfigController } from '../../shared/store/config.ts';
import { FrameSettingsController } from './frame-settings.ts';
import { setScriptVisible } from './visibility.ts';
import { notify } from './utils/notify.ts';
import { startCoexistenceAnnouncement } from './coexistence.ts';

setScriptVisible(false);
ConfigController.notify = notify;
let allowed = false;
let hindered = false;
let stopCoexistence: (() => void) | undefined;
const frames = new FrameSettingsController((visible) => {
  allowed = visible;
  updatePresentation();
});

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

function updatePresentation() {
  // 等待 DOM 完整后识别工作台及其同源 iframe，兼容任意部署主机和端口。
  const visible = allowed && !hindered && !inWorkbench();
  setScriptVisible(visible);
  if (!visible) {
    document.getElementById('selective-crawl-floating-root')?.remove();
    return;
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

  if (!mount.querySelector('scwc-layout-root')) {
    mount.appendChild(document.createElement('scwc-layout-root'));
  }
}

function hinder(event: MessageEvent) {
  if (event.source !== window.parent) {
    return;
  }
  if (event.data?.type === 'scwc-plugin-hinder' && event.data.isSameOrigin === true) {
    hindered = true;
    updatePresentation();
  }
}
window.addEventListener('message', hinder);

function start() {
  frames.start();
  if (!inWorkbench()) {
    stopCoexistence = startCoexistenceAnnouncement();
  }
}
if (document.readyState === 'complete') {
  start();
} else {
  window.addEventListener('load', start, { once: true });
}

export function stopUserScript() {
  stopCoexistence?.();
  frames.stop();
  window.removeEventListener('load', start);
  window.removeEventListener('message', hinder);
  setScriptVisible(false);
  document.getElementById('selective-crawl-floating-root')?.remove();
}
