import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { notify } from './notify.ts';
import type { INotifyOptions } from '../types/notify.d.ts';
import { requireValue } from '../workbench-protocol.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
});
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fixture(options: INotifyOptions) {
  const element = document.createElement('scwc-notify');
  document.body.append(element);
  const handle = element.notify(options);
  await element.updateComplete;
  await vi.advanceTimersByTimeAsync(32);
  await element.updateComplete;
  return { element, handle, root: requireValue(element.shadowRoot) };
}

it.each(['tl', 'tc', 'tr', 'bl', 'bc', 'br'] as const)(
  'keeps %s placement and the existing click and user-close callbacks with the new presentation',
  async (placement) => {
    const onclick = vi.fn(),
      onclose = vi.fn();
    const { root } = await fixture({
      title: '结果',
      description: '第一行\n第二行',
      placement,
      type: 'warn',
      onclick,
      onclose,
    });
    const item = requireValue(root.querySelector<HTMLElement>(`.${placement}-list .notify-item`));
    expect(item.classList.contains(`${placement}-item`)).toBe(true);
    expect(item.querySelector('.notify-title-text')?.textContent).toBe('结果');
    expect(item.querySelector('.notify-content')?.textContent).toBe('第一行\n第二行');
    item.click();
    expect(onclick).toHaveBeenCalledOnce();
    requireValue(item.querySelector<HTMLButtonElement>('.notify-close')).click();
    expect(onclose).toHaveBeenCalledWith('user');
    expect(onclick).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300);
    expect(root.querySelector('.notify-item')).toBeNull();
  },
);

it('preserves hover pause, automatic close and silent manual close', async () => {
  const onclose = vi.fn();
  const { element, root } = await fixture({ title: '等待', duration: 100, onclose });
  const item = requireValue(root.querySelector('.notify-item'));
  item.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(200);
  expect(onclose).not.toHaveBeenCalled();
  item.dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(3000);
  expect(onclose).toHaveBeenCalledWith('auto');
  const handle = element.notify({ title: '手动关闭', onclose });
  await element.updateComplete;
  await vi.advanceTimersByTimeAsync(32);
  expect(handle.close()).toBe(true);
  expect(onclose).toHaveBeenCalledTimes(1);
});

it('keeps active progress open, updates content and supports shared action buttons', async () => {
  const action = vi.fn();
  const { element, root, handle } = await fixture({
    title: '处理中',
    progress: null,
    duration: 100,
    actions: [{ label: '详情', onClick: action }],
  });
  await vi.advanceTimersByTimeAsync(1000);
  expect(root.querySelector('[role="progressbar"]')?.getAttribute('aria-valuetext')).toBe('加载中');
  requireValue(root.querySelector<HTMLButtonElement>('.notification-buttons button')).click();
  expect(action).toHaveBeenCalledOnce();
  handle.update({ title: '处理完成', progress: 100 });
  await element.updateComplete;
  expect(root.textContent).toContain('处理完成');
  await vi.advanceTimersByTimeAsync(350);
  await element.updateComplete;
  expect(root.querySelector('.notify-item')).toBeNull();
});

it('keeps the handle and read state after automatic hiding and supports local state controls', async () => {
  const { element, handle, root } = await fixture({
    title: '已完成',
    duration: 100,
    autoRead: false,
  });
  root.querySelector('.notify-item')?.dispatchEvent(new FocusEvent('focusin'));
  expect((await handle.getState()).readAt).toBeNull();
  await handle.markRead();
  await handle.setContent('记录已更新', '仍由原句柄管理');
  await handle.setProgress(100);
  expect((await handle.getState()).readAt).not.toBeNull();
  root.querySelector('.notify-item')?.dispatchEvent(new FocusEvent('focusout'));
  await vi.advanceTimersByTimeAsync(400);
  await element.updateComplete;
  expect(root.querySelector('.notify-item')).toBeNull();
  expect(await handle.isVisible()).toBe(false);
  await handle.markRead(false);
  await handle.setProgress(false);
  expect(await handle.getState()).toMatchObject({ readAt: null, progress: false, banner: false });
  expect(handle.close()).toBe(true);
  expect(handle.close()).toBe(false);
});

it('renders the same shared view when an isolated content world has no CustomElementRegistry', () => {
  vi.stubGlobal('customElements', null);
  vi.stubGlobal(
    'CSSStyleSheet',
    class {
      replaceSync() {
        /* jsdom has no stylesheet parser. */
      }
    },
  );
  const handle = notify({ title: '隔离环境通知', placement: 'bc', duration: 0 });
  const shadow = requireValue(document.querySelector('#scwc-notify-root')?.shadowRoot);
  expect(shadow.querySelector('.bc-list .notify-title-text')?.textContent).toBe('隔离环境通知');
  expect(handle.close()).toBe(true);
});
