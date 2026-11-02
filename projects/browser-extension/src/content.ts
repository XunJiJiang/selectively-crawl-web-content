import { browser, type Reply } from './browser.ts';
import { getCrawlData } from '../../user-script/src/utils/claw.ts';
import { getSelector, getElementBySelector } from '../../user-script/src/utils/selector.ts';
import type { Draft, Item } from './model.ts';

// 重复注入时复用当前文档的选择器；不挂载用户脚本的浮窗或连接配置。
const installed = '__scwcExtensionPickerV1';
const scope = globalThis as typeof globalThis & { [installed]?: boolean };
if (!scope[installed]) {
  scope[installed] = true;
  let selecting = false,
    chain: Element[] = [],
    hover: Element | null = null;
  let overlay: HTMLDivElement | undefined, box: HTMLDivElement | undefined;
  let frame = 0,
    hoverTimer: ReturnType<typeof setTimeout> | undefined;
  const excluded = (el: Element) =>
    !!el.closest('#scwc-extension-highlight, #selective-crawl-floating-root, #scwc-notify-root');
  const state = (): Draft | null =>
    chain.length
      ? { site: location.href, selector: getSelector(chain[chain.length - 1]), depth: chain.length }
      : null;
  const publish = () => {
    void browser.runtime
      .sendMessage({ type: 'picker.selection', draft: state() })
      .catch(() => undefined);
  };
  const clear = () => {
    selecting = false;
    chain = [];
    hover = null;
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    cancelAnimationFrame(frame);
    clearTimeout(hoverTimer);
    overlay?.remove();
    overlay = undefined;
  };
  const paint = () => {
    const target = chain.at(-1) ?? hover;
    if (target && box) {
      const rect = target.getBoundingClientRect();
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        display: 'block',
      });
    } else if (box) {
      box.style.display = 'none';
    }
    frame = requestAnimationFrame(paint);
  };
  const mount = () => {
    if (overlay) {
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'scwc-extension-highlight';
    overlay.style.setProperty('all', 'initial', 'important');
    overlay.style.setProperty('pointer-events', 'none', 'important');
    const shadow = overlay.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent =
      ':host{position:fixed!important;inset:0!important;z-index:2147483647!important;pointer-events:none!important} .box{position:fixed;background:#38bdf833;outline:2px solid #38bdf8;pointer-events:none} .hint{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#0f131c;color:#fff;border:1px solid #38bdf8;border-radius:4px;padding:10px 16px;font:14px/1.5 system-ui;box-shadow:0 4px 16px #0005;white-space:nowrap}';
    box = document.createElement('div');
    box.className = 'box';
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = selecting
      ? 'SCWC · 点击选择元素，Esc 取消'
      : 'SCWC · 已选中，请再次点击插件图标确认；Esc 取消';
    shadow.append(style, box, hint);
    document.documentElement.append(overlay);
    paint();
  };
  function move(event: MouseEvent) {
    const target = document.elementFromPoint(event.clientX, event.clientY);
    hover = target && !excluded(target) ? target : null;
  }
  function click(event: MouseEvent) {
    if (!selecting) {
      return;
    }
    const target = event.target instanceof Element ? event.target : hover;
    if (!target || excluded(target)) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    selecting = false;
    chain = [target];
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    overlay?.remove();
    overlay = undefined;
    cancelAnimationFrame(frame);
    mount();
    publish();
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      clear();
      publish();
    }
  }
  browser.runtime.onMessage.addListener((input, sender, respond) => {
    const message = input as {
      type: string;
      site?: string;
      command: string;
      selector?: string;
      items: Item[];
    };
    if (sender.id !== browser.runtime.id || message.type !== 'scwc.page') {
      return;
    }
    try {
      if (message.site && message.site !== location.href) {
        throw new Error('网页地址已变化，请重新打开插件');
      }
      let data: unknown;
      switch (message.command) {
        case 'ping':
          break;
        case 'start':
          clear();
          selecting = true;
          document.addEventListener('mousemove', move, true);
          document.addEventListener('click', click, true);
          document.addEventListener('keydown', key, true);
          mount();
          break;
        case 'parent': {
          const parent = chain.at(-1)?.parentElement;
          if (parent) {
            chain.push(parent);
          }
          data = state();
          publish();
          break;
        }
        case 'undo':
          if (chain.length > 1) {
            chain.pop();
          }
          data = state();
          publish();
          break;
        case 'cancel':
        case 'confirm':
          clear();
          break;
        case 'highlight': {
          if (chain.length || selecting) {
            break;
          }
          clear();
          hover = getElementBySelector(message.selector ?? '');
          if (hover) {
            mount();
            hoverTimer = setTimeout(clear, 1800);
          }
          break;
        }
        case 'extract':
          data = getCrawlData(message.items);
          break;
        default:
          throw new Error('未知页面操作');
      }
      respond({ ok: true, data } satisfies Reply<unknown>);
    } catch (error) {
      respond({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
  window.addEventListener('pagehide', clear);
}
