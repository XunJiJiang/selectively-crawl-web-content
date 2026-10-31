import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import './notify.ts';
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
