import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExtensionNotifications, notificationStorageKey } from './notifications.ts';
import type { WorkbenchScrollContainer } from '../../web/src/components/scroll-container.ts';
import { layoutNotificationStack, stackWindow } from './notification-stack.ts';

const storage = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock('./browser.ts', () => ({ browser: { storage: { local: storage } } }));
let saved: Record<string, unknown>;
const nativeScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  vi.useFakeTimers();
  saved = {};
  storage.get.mockImplementation(async () => structuredClone(saved));
  storage.set.mockImplementation(async (values) => {
    Object.assign(saved, structuredClone(values));
  });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) {
      this.scrollTop = options.top ?? this.scrollTop;
      this.scrollLeft = options.left ?? this.scrollLeft;
    },
  });
});
afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  if (nativeScrollTo) {
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', nativeScrollTo);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  }
});
async function mount() {
  const center = new ExtensionNotifications();
  document.body.append(center);
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(32);
  return center;
}
async function settle(center: ExtensionNotifications) {
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(32);
}
it('archives timed-out messages across popup reopen and permanently removes manually closed ones', async () => {
  const center = await mount();
  center.add('自动隐藏的通知', 'success');
  center.add('主动关闭的通知', 'error');
  await settle(center);
  center.shadowRoot?.querySelectorAll<HTMLButtonElement>('.close')[1].click();
  await vi.advanceTimersByTimeAsync(5000);
  await center.updateComplete;
  expect(center.shadowRoot?.querySelector('.floating')).toBeNull();
  center.remove();
  const reopened = await mount();
  expect(reopened.shadowRoot?.querySelector('.floating')).toBeNull();
  reopened.historyOpen = true;
  await settle(reopened);
  expect(reopened.shadowRoot?.textContent).toContain('自动隐藏的通知');
  expect(reopened.shadowRoot?.textContent).not.toContain('主动关闭的通知');
  reopened.shadowRoot?.querySelector<HTMLButtonElement>('.close')?.click();
  await settle(reopened);
  expect(saved[notificationStorageKey]).toEqual([]);
  expect(reopened.shadowRoot?.textContent).toContain('暂无通知');
});
it('pauses only the hovered message and resumes its remaining lifetime after leaving', async () => {
  const center = await mount();
  center.add('其他通知');
  center.add('悬停通知');
  await settle(center);
  await vi.advanceTimersByTimeAsync(1000);
  const hovered = center.shadowRoot?.querySelectorAll<HTMLElement>('.toast')[1];
  hovered?.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(10000);
  await center.updateComplete;
  expect(center.shadowRoot?.querySelectorAll('.toast')).toHaveLength(1);
  expect(center.shadowRoot?.textContent).toContain('悬停通知');
  hovered?.dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(3800);
  expect(center.shadowRoot?.querySelector('.floating')).not.toBeNull();
  await vi.advanceTimersByTimeAsync(200);
  await center.updateComplete;
  expect(center.shadowRoot?.querySelector('.floating')).toBeNull();
  center.historyOpen = true;
  await settle(center);
  expect(center.shadowRoot?.querySelectorAll('.notification')).toHaveLength(2);
});
it('keeps a focused message paused after the pointer leaves', async () => {
  const center = await mount();
  center.add('键盘操作通知');
  await settle(center);
  const card = center.shadowRoot?.querySelector<HTMLElement>('.toast');
  card?.dispatchEvent(new MouseEvent('mouseenter'));
  card?.dispatchEvent(new FocusEvent('focusin'));
  card?.dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(6000);
  expect(center.shadowRoot?.querySelector('.toast')).not.toBeNull();
  card?.dispatchEvent(new FocusEvent('focusout'));
  await vi.advanceTimersByTimeAsync(5000);
  await center.updateComplete;
  expect(center.shadowRoot?.querySelector('.toast')).toBeNull();
});
it('merges messages arriving during history loading and opens history at the newest message', async () => {
  let restore!: (value: unknown) => void;
  storage.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        restore = resolve;
      }),
  );
  const center = new ExtensionNotifications();
  center.add('最新消息');
  document.body.append(center);
  restore({
    [notificationStorageKey]: [{ id: 'old', message: '旧消息', type: 'info', createdAt: 1 }],
  });
  center.historyOpen = true;
  await settle(center);
  const history = center.shadowRoot?.querySelector<WorkbenchScrollContainer>(
    '.history',
  ) as WorkbenchScrollContainer;
  Object.defineProperties(history.scrollElement, { clientHeight: { value: 300 } });
  history.metrics = { scrollHeight: 900 };
  center.requestUpdate();
  await settle(center);
  expect(history.scrollState.scrollTop).toBe(600);
  expect([...history.querySelectorAll('p')].map((node) => node.textContent)).toEqual([
    '旧消息',
    '最新消息',
  ]);
  history.scrollTo({ top: 100, behavior: 'instant' });
  center.add('阅读旧消息时到达');
  await settle(center);
  expect(history.scrollState.scrollTop).toBe(600);
  center.historyOpen = false;
  await settle(center);
  center.historyOpen = true;
  await center.updateComplete;
  const nextHistory = center.shadowRoot?.querySelector<WorkbenchScrollContainer>(
    '.history',
  ) as WorkbenchScrollContainer;
  await nextHistory.updateComplete;
  Object.defineProperty(nextHistory.scrollElement, 'clientHeight', { value: 300 });
  nextHistory.metrics = { scrollHeight: 1000 };
  await vi.advanceTimersByTimeAsync(32);
  expect(nextHistory.scrollState.scrollTop).toBe(700);
});
it('marks only history rows intersecting the viewport as read, and filters without cascading through unseen rows', async () => {
  const center = await mount();
  center.add('已进入视口');
  center.add('仍在视口外');
  await settle(center);
  expect(
    (saved[notificationStorageKey] as { read: boolean }[]).every((record) => !record.read),
  ).toBe(true);
  center.historyOpen = true;
  await settle(center);
  const history = center.shadowRoot?.querySelector<WorkbenchScrollContainer>(
    '.history',
  ) as WorkbenchScrollContainer;
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    height,
    x: 0,
    y: top,
    toJSON() {
      return { top, height };
    },
  });
  vi.spyOn(history.scrollElement as HTMLElement, 'getBoundingClientRect').mockReturnValue(
    rect(0, 100),
  );
  const rows = [...(center.shadowRoot?.querySelectorAll<HTMLElement>('.notification') ?? [])];
  vi.spyOn(rows[0], 'getBoundingClientRect').mockReturnValue(rect(10, 50));
  vi.spyOn(rows[1], 'getBoundingClientRect').mockReturnValue(rect(150, 50));
  const state = center as unknown as {
    markVisibleRead(): void;
    selectFilter(value: 'all' | 'unread' | 'read'): void;
  };
  state.selectFilter('unread');
  state.markVisibleRead();
  await settle(center);
  expect(
    (saved[notificationStorageKey] as { read: boolean }[]).map((record) => record.read),
  ).toEqual([true, false]);
  expect(center.shadowRoot?.querySelectorAll('.notification')).toHaveLength(2);
  state.selectFilter('read');
  await center.updateComplete;
  expect(center.shadowRoot?.querySelectorAll('.notification')).toHaveLength(1);
  expect(center.shadowRoot?.querySelector('.notification')?.textContent).toContain('已进入视口');
  state.selectFilter('unread');
  await center.updateComplete;
  expect(center.shadowRoot?.querySelectorAll('.notification')).toHaveLength(1);
  expect(center.shadowRoot?.querySelector('.notification')?.textContent).toContain('仍在视口外');
});

it('animates expansion frame by frame, reverses without jumping and applies scrolling immediately', async () => {
  const center = await mount();
  for (let index = 0; index < 12; index++) {
    center.add(`消息 ${index}`);
  }
  await settle(center);
  const state = center as unknown as { expansion: number };
  const floating = center.shadowRoot?.querySelector<HTMLElement>('.floating') as HTMLElement;
  const driver = center.shadowRoot?.querySelector<WorkbenchScrollContainer>(
    '.toast-scroll',
  ) as WorkbenchScrollContainer;
  Object.defineProperty(driver.scrollElement, 'clientHeight', { value: stackWindow.expanded });
  driver.refresh();
  floating.dispatchEvent(new MouseEvent('mouseenter'));
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(80);
  expect(state.expansion).toBeGreaterThan(0);
  expect(state.expansion).toBeLessThan(1);
  const intermediate = state.expansion;
  floating.dispatchEvent(new MouseEvent('mouseleave'));
  await center.updateComplete;
  expect(state.expansion).toBe(intermediate);
  await vi.advanceTimersByTimeAsync(240);
  expect(state.expansion).toBe(0);
  floating.dispatchEvent(new MouseEvent('mouseenter'));
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(240);
  expect(state.expansion).toBe(1);
  driver.scrollTo({ top: 80, behavior: 'instant' });
  const geometry = layoutNotificationStack(Array(12).fill(stackWindow.collapsed), 80, true, 468);
  const first = center.shadowRoot?.querySelector<HTMLElement>('.toast') as HTMLElement;
  expect(first.style.transform).toBe(
    `translate3d(0, ${geometry[0].y}px, 0) scale(${geometry[0].scale})`,
  );
});

it('animates notifications and the scroll driver without requestAnimationFrame and cancels on disconnect', async () => {
  vi.stubGlobal('requestAnimationFrame', undefined);
  vi.stubGlobal('cancelAnimationFrame', undefined);
  const center = await mount();
  for (let index = 0; index < 8; index++) {
    center.add(`回退消息 ${index}`);
  }
  await settle(center);
  const state = center as unknown as { expansion: number };
  const floating = center.shadowRoot?.querySelector<HTMLElement>('.floating') as HTMLElement;
  floating.dispatchEvent(new MouseEvent('mouseenter'));
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(64);
  expect(state.expansion).toBeGreaterThan(0);
  expect(state.expansion).toBeLessThan(1);
  await vi.advanceTimersByTimeAsync(200);
  expect(state.expansion).toBe(1);
  floating.dispatchEvent(new MouseEvent('mouseleave'));
  await center.updateComplete;
  await vi.advanceTimersByTimeAsync(32);
  const stopped = state.expansion;
  center.remove();
  await vi.advanceTimersByTimeAsync(300);
  expect(state.expansion).toBe(stopped);
  expect(vi.getTimerCount()).toBe(0);
});
