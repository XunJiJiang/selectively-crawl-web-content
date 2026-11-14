import { afterEach, expect, it, vi } from 'vitest';
import { html } from 'lit';
import { attachTooltip, type SCWCTooltip } from './tooltip.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('shows complete plain text on hover/focus and closes when feedback changes or the surface scrolls', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const message = document.createElement('div');
  message.textContent = '<b>完整提示</b>\n第二行';
  root.append(message);
  document.body.append(host);
  const dispose = attachTooltip(message, () => message.textContent ?? '');
  const tooltip = root.querySelector('scwc-tooltip') as SCWCTooltip;
  message.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(1000);
  await tooltip.updateComplete;
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.hasAttribute('arrow')).toBe(true);
  expect(tooltip.shadowRoot?.textContent).toContain('<b>完整提示</b>\n第二行');
  expect(tooltip.shadowRoot?.querySelector('b')).toBeNull();
  expect(message.hasAttribute('title')).toBe(false);
  message.textContent = '新错误';
  await Promise.resolve();
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focusin'));
  await vi.advanceTimersByTimeAsync(1000);
  await tooltip.updateComplete;
  expect(tooltip.text).toBe('新错误');
  expect(tooltip.hidden).toBe(false);
  root.dispatchEvent(new Event('scroll'));
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focusin'));
  await vi.advanceTimersByTimeAsync(1000);
  await tooltip.updateComplete;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(tooltip.hidden).toBe(true);
  dispose();
  expect(root.querySelector('scwc-tooltip')).toBeNull();
});

it('cancels pending opens when a view is replaced or disposed', async () => {
  vi.useFakeTimers();
  const message = document.createElement('div');
  document.body.append(message);
  const dispose = attachTooltip(message, () => '旧视图的提示');
  const tooltip = document.querySelector('scwc-tooltip') as SCWCTooltip;
  message.dispatchEvent(new MouseEvent('mouseenter'));
  dispose();
  await vi.advanceTimersByTimeAsync(1000);
  await tooltip.updateComplete;
  expect(tooltip.isConnected).toBe(false);
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focus'));
  expect(document.querySelector('scwc-tooltip')).toBeNull();
});

it.each([undefined, '[data-tip]'])(
  'restores source listeners after reparenting with delegate %s',
  async (delegate) => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const source = document.createElement('button');
    source.dataset.tip = '';
    container.append(source);
    document.body.append(container);
    const dispose = attachTooltip(delegate ? container : source, () => 'Moved source', {
      delegate,
    });
    const tooltip = (delegate ? container : source).nextElementSibling as SCWCTooltip;
    const wrapper = document.createElement('section');
    // JSON tabs are wrapped after their trees and source bindings have mounted.
    const parent = delegate ? document.body : container;
    const moving = document.createElement('div');
    parent.append(moving);
    moving.append(delegate ? container : source, tooltip);
    moving.replaceWith(wrapper);
    wrapper.append(moving);
    source.dispatchEvent(new MouseEvent(delegate ? 'mouseover' : 'mouseenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(999);
    expect(tooltip.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(tooltip.hidden).toBe(false);
    expect(tooltip.text).toBe('Moved source');

    // The original disposer must still release the binding installed on reconnect.
    dispose();
    wrapper.append(tooltip);
    source.dispatchEvent(new MouseEvent(delegate ? 'mouseover' : 'mouseenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(tooltip.hidden).toBe(true);
  },
);

it('can bind before connecting and does not let an obsolete disposer clear a replacement binding', async () => {
  vi.useFakeTimers();
  const first = document.createElement('button');
  const second = document.createElement('button');
  const tooltip = document.createElement('scwc-tooltip');
  const disposeFirst = tooltip.bindTo(first, () => 'First');
  tooltip.bindTo(second, () => 'Second');
  document.body.append(first, second, tooltip);
  disposeFirst();
  second.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.text).toBe('Second');
});

it.each([
  ['right', 100, 100, 50, 22, 100, 22],
  ['left', 300, 100, 50, 22, 100, 22],
  ['bottom', 150, 8, 100, 22, 280, 22],
  ['top', 150, 260, 100, 22, 280, 22],
  ['current', 8, 8, 384, 284, 300, 200],
] as const)(
  'tries right, left, bottom, top and current, choosing %s when it fits',
  async (placement, left, top, width, height, popupWidth, popupHeight) => {
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 300);
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const dispose = attachTooltip(anchor, () => 'Text', {
      placements: ['right', 'left', 'bottom', 'top', 'current'],
    });
    const tooltip = document.querySelector('scwc-tooltip') as SCWCTooltip;
    anchor.getBoundingClientRect = () =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    tooltip.getBoundingClientRect = () => ({ width: popupWidth, height: popupHeight }) as DOMRect;
    await tooltip.openFor(anchor, 'Text');
    expect(tooltip.dataset.placement).toBe(placement);
    dispose();
  },
);

it('respects a custom order and clamps the final choice to the viewport', async () => {
  vi.stubGlobal('innerWidth', 400);
  vi.stubGlobal('innerHeight', 300);
  const anchor = document.createElement('button');
  const tooltip = document.createElement('scwc-tooltip');
  document.body.append(anchor, tooltip);
  anchor.getBoundingClientRect = () =>
    ({ left: 100, right: 150, top: 100, bottom: 122, width: 50, height: 22 }) as DOMRect;
  tooltip.getBoundingClientRect = () => ({ width: 100, height: 22 }) as DOMRect;
  tooltip.placements = ['top', 'right'];
  await tooltip.openFor(anchor, 'Text');
  expect(tooltip.dataset.placement).toBe('top');
  anchor.getBoundingClientRect = () =>
    ({ left: 390, right: 410, top: 290, bottom: 312, width: 20, height: 22 }) as DOMRect;
  tooltip.placements = ['current'];
  await tooltip.updateComplete;
  tooltip.reposition();
  expect([tooltip.style.left, tooltip.style.top]).toEqual(['292px', '270px']);
});

it.each(['right', 'left'] as const)(
  'aligns the %s arrow with the source centre for compact and viewport-clamped popups',
  async (side) => {
    vi.stubGlobal('innerWidth', 400);
    vi.stubGlobal('innerHeight', 300);
    const anchor = document.createElement('button');
    const tooltip = document.createElement('scwc-tooltip');
    tooltip.style.border = '1px solid';
    tooltip.placements = [side];
    document.body.append(anchor, tooltip);
    for (const [sourceTop, popupHeight] of [
      [100, 22],
      [100, 40],
      [8, 120],
      [270, 120],
    ]) {
      anchor.getBoundingClientRect = () =>
        ({
          left: 175,
          right: 225,
          top: sourceTop,
          bottom: sourceTop + 22,
          width: 50,
          height: 22,
        }) as DOMRect;
      tooltip.getBoundingClientRect = () => ({ width: 100, height: popupHeight }) as DOMRect;
      await tooltip.openFor(anchor, 'Centred arrow');
      expect(tooltip.dataset.placement).toBe(side);
      const arrowCentre =
        Number.parseFloat(tooltip.style.top) +
        1 +
        Number.parseFloat(tooltip.style.getPropertyValue('--tooltip-pointer-y'));
      expect(arrowCentre).toBe(sourceTop + 11);
    }
  },
);

it('lazily mounts custom content, keeps it open on hover, pins on focus and closes on outside click', async () => {
  vi.useFakeTimers();
  const anchor = document.createElement('button');
  const tooltip = document.createElement('scwc-tooltip');
  tooltip.interactive = true;
  tooltip.content = () => html`<input aria-label="Custom input" /><button>Action</button>`;
  document.body.append(anchor, tooltip);
  await tooltip.updateComplete;
  expect(tooltip.shadowRoot?.querySelector('input')).toBeNull();
  await tooltip.openFor(anchor);
  tooltip.scheduleClose();
  tooltip.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(250);
  expect(tooltip.hidden).toBe(false);
  tooltip.shadowRoot?.querySelector('input')?.focus();
  await tooltip.updateComplete;
  expect(tooltip.pinned).toBe(true);
  expect(tooltip.getAttribute('role')).toBe('dialog');
  tooltip.dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(250);
  expect(tooltip.hidden).toBe(false);
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  await tooltip.updateComplete;
  expect(tooltip.hidden).toBe(true);
  expect(tooltip.shadowRoot?.querySelector('input')).toBeNull();
});

it('switches pinned popups immediately within a group and suppresses hover in other groups', async () => {
  const anchor = document.createElement('button');
  const first = document.createElement('scwc-tooltip');
  const second = document.createElement('scwc-tooltip');
  for (const tooltip of [first, second]) {
    tooltip.group = 'statuses';
    tooltip.interactive = true;
    tooltip.content = () => html`<button>Custom</button>`;
  }
  document.body.append(anchor, first, second);
  await first.openFor(anchor, undefined, true);
  second.group = 'other';
  second.trigger('hover', anchor);
  expect(first.hidden).toBe(false);
  expect(second.hidden).toBe(true);
  second.group = 'statuses';
  second.trigger('hover', anchor);
  await second.updateComplete;
  expect(first.hidden).toBe(true);
  expect(second.pinned).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(second.hidden).toBe(true);
});

it('clears pinned state when focus moves to an outside control', async () => {
  const tip = boundTip();
  const outside = document.createElement('button');
  document.body.append(outside);
  await tip.tooltip.openFor(tip.anchor, 'Pinned', true);
  outside.focus();
  await tip.tooltip.updateComplete;
  expect(tip.tooltip.hidden).toBe(true);
  expect(tip.tooltip.pinned).toBe(false);
  expect(tip.tooltip.hasAttribute('data-pinned')).toBe(false);
  expect(document.activeElement).toBe(outside);
  tip.dispose();
});

it('closes a pinned popup when an outside iframe takes focus without a parent pointer event', async () => {
  vi.useFakeTimers();
  const tip = boundTip();
  const frame = document.createElement('iframe');
  document.body.append(frame);
  await tip.tooltip.openFor(tip.anchor, 'Pinned', true);
  frame.focus();
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(0);
  await tip.tooltip.updateComplete;
  expect(tip.tooltip.hidden).toBe(true);
  expect(tip.tooltip.pinned).toBe(false);
  expect(tip.tooltip.hasAttribute('data-pinned')).toBe(false);
  expect(document.activeElement).toBe(frame);
  tip.dispose();
});

it.each(['input', 'iframe'] as const)(
  'keeps focus in a custom %s when pinned or the parent window blurs',
  async (tag) => {
    vi.useFakeTimers();
    const tip = boundTip();
    tip.tooltip.interactive = true;
    tip.tooltip.content = () => html`<input aria-label="Editable content" /><iframe></iframe>`;
    await tip.tooltip.openFor(tip.anchor, 'Pinned', true);
    const control = tip.tooltip.shadowRoot?.querySelector(tag);
    control?.focus();
    tip.tooltip.pin();
    window.dispatchEvent(new Event('blur'));
    await vi.advanceTimersByTimeAsync(0);
    expect(tip.tooltip.hidden).toBe(false);
    expect(tip.tooltip.pinned).toBe(true);
    expect(tip.tooltip.shadowRoot?.activeElement).toBe(control);
    tip.dispose();
  },
);

it('detects focus switching from an internal iframe to an external iframe without parent focus events', async () => {
  vi.useFakeTimers();
  const tip = boundTip();
  const outside = document.createElement('iframe');
  document.body.append(outside);
  tip.tooltip.content = () => html`<iframe></iframe>`;
  await tip.tooltip.openFor(tip.anchor, 'Pinned', true);
  tip.tooltip.shadowRoot?.querySelector('iframe')?.focus();
  window.dispatchEvent(new Event('blur'));
  await vi.advanceTimersByTimeAsync(0);
  expect(tip.tooltip.hidden).toBe(false);
  const focus = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(outside);
  try {
    await vi.advanceTimersByTimeAsync(100);
    expect(tip.tooltip.hidden).toBe(true);
    expect(tip.tooltip.pinned).toBe(false);
  } finally {
    focus.mockRestore();
    tip.dispose();
  }
});

it('cancels delayed opens on mutation and disposal, and ignores empty text', async () => {
  vi.useFakeTimers();
  const anchor = document.createElement('button');
  document.body.append(anchor);
  let text = '';
  const dispose = attachTooltip(anchor, () => text);
  const tooltip = document.querySelector('scwc-tooltip') as SCWCTooltip;
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.hidden).toBe(true);
  text = 'Pending';
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  anchor.remove();
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.hidden).toBe(true);
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  dispose();
  await vi.advanceTimersByTimeAsync(1000);
  expect(tooltip.isConnected).toBe(false);
  expect(tooltip.hidden).toBe(true);
});

function boundTip(group?: string, triggers?: readonly import('./tooltip.ts').TooltipTrigger[]) {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  const dispose = attachTooltip(anchor, () => 'Bound tip', { group, triggers });
  const tooltip = anchor.nextElementSibling as SCWCTooltip;
  const enter = () => anchor.dispatchEvent(new MouseEvent('mouseenter'));
  const leave = () => anchor.dispatchEvent(new MouseEvent('mouseleave'));
  return { anchor, tooltip, enter, leave, dispose };
}

it('waits one second to open, then closes exactly 100ms after leaving a source', async () => {
  vi.useFakeTimers();
  const tip = boundTip();
  tip.enter();
  await vi.advanceTimersByTimeAsync(999);
  expect(tip.tooltip.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(tip.tooltip.hidden).toBe(false);
  tip.leave();
  await vi.advanceTimersByTimeAsync(99);
  expect(tip.tooltip.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(tip.tooltip.hidden).toBe(true);
  tip.dispose();
});

it('treats unset groups as the same group, re-enters instantly, and cools down after closing', async () => {
  vi.useFakeTimers();
  const first = boundTip();
  const second = boundTip();
  first.enter();
  await vi.advanceTimersByTimeAsync(1000);
  first.leave();
  await vi.advanceTimersByTimeAsync(90);
  first.enter();
  await first.tooltip.updateComplete;
  expect(first.tooltip.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(20);
  expect(first.tooltip.hidden).toBe(false);
  first.leave();
  second.enter();
  expect(first.tooltip.hidden).toBe(true);
  await second.tooltip.updateComplete;
  expect(second.tooltip.hidden).toBe(false);
  second.leave();
  await vi.advanceTimersByTimeAsync(100);
  first.enter();
  await vi.advanceTimersByTimeAsync(999);
  expect(first.tooltip.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(first.tooltip.hidden).toBe(false);
  first.dispose();
  second.dispose();
});

it('pins plain text on popup click, blocks foreign groups, and carries focus state to same-group members', async () => {
  vi.useFakeTimers();
  const first = boundTip('one');
  const second = boundTip('one', ['click']);
  const foreign = boundTip('two');
  first.enter();
  await vi.advanceTimersByTimeAsync(1000);
  first.tooltip.click();
  await first.tooltip.updateComplete;
  expect(first.tooltip.pinned).toBe(true);
  expect(first.tooltip.hasAttribute('data-pinned')).toBe(true);
  expect(document.activeElement).toBe(first.tooltip);
  first.leave();
  foreign.enter();
  await vi.advanceTimersByTimeAsync(1500);
  expect(first.tooltip.hidden).toBe(false);
  expect(foreign.tooltip.hidden).toBe(true);
  // A warm group can switch even to a member whose cold trigger is click only.
  second.enter();
  await second.tooltip.updateComplete;
  expect(first.tooltip.hidden).toBe(true);
  expect(second.tooltip.hidden).toBe(false);
  expect(second.tooltip.pinned).toBe(true);
  second.leave();
  await vi.advanceTimersByTimeAsync(200);
  expect(second.tooltip.hidden).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(second.tooltip.hidden).toBe(true);
  first.dispose();
  second.dispose();
  foreign.dispose();
});

it('supports click and contextmenu independently or together with hover', async () => {
  vi.useFakeTimers();
  const click = boundTip('click', ['click']);
  click.enter();
  await vi.advanceTimersByTimeAsync(1500);
  expect(click.tooltip.hidden).toBe(true);
  click.anchor.click();
  await click.tooltip.updateComplete;
  expect(click.tooltip.pinned).toBe(true);
  click.tooltip.close();
  const context = boundTip('context', ['contextmenu']);
  const rightClick = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
  context.anchor.dispatchEvent(rightClick);
  await context.tooltip.updateComplete;
  expect(rightClick.defaultPrevented).toBe(true);
  expect(context.tooltip.hidden).toBe(false);
  expect(context.tooltip.pinned).toBe(true);
  context.tooltip.close();
  const combined = boundTip('multi', ['hover', 'click', 'contextmenu']);
  combined.enter();
  await vi.advanceTimersByTimeAsync(1000);
  expect(combined.tooltip.hidden).toBe(false);
  combined.anchor.click();
  await combined.tooltip.updateComplete;
  expect(combined.tooltip.pinned).toBe(true);
  click.dispose();
  context.dispose();
  combined.dispose();
});

it('holds a popup while crossing the source gap and entering its content', async () => {
  vi.useFakeTimers();
  const tip = boundTip();
  tip.enter();
  await vi.advanceTimersByTimeAsync(1000);
  tip.leave();
  await vi.advanceTimersByTimeAsync(90);
  tip.tooltip.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(200);
  expect(tip.tooltip.hidden).toBe(false);
  tip.tooltip.dispatchEvent(new MouseEvent('mouseleave'));
  await vi.advanceTimersByTimeAsync(100);
  expect(tip.tooltip.hidden).toBe(true);
  tip.dispose();
});

it('does not open late after rapid movement or unrelated attribute changes', async () => {
  vi.useFakeTimers();
  const tips = Array.from({ length: 4 }, () => boundTip('toolbar'));
  const opens = tips.map((tip) => vi.spyOn(tip.tooltip, 'openFor'));
  for (let index = 0; index < 100; index++) {
    const tip = tips[index % tips.length];
    tip.enter();
    tip.anchor.className = 'hover-' + index;
    await vi.advanceTimersByTimeAsync(5);
    tip.leave();
  }
  await vi.advanceTimersByTimeAsync(1100);
  for (const open of opens) {
    expect(open).not.toHaveBeenCalled();
  }
  tips[0].enter();
  await vi.advanceTimersByTimeAsync(1000);
  tips[0].anchor.className = 'incidental-change';
  await Promise.resolve();
  expect(tips[0].tooltip.hidden).toBe(false);
  tips.forEach((tip) => tip.dispose());
});

it('shares group switching across shadow roots without duplicating visible popups', async () => {
  vi.useFakeTimers();
  const host = document.createElement('div');
  document.body.append(host);
  const root = host.attachShadow({ mode: 'open' }),
    anchor = document.createElement('button');
  root.append(anchor);
  const dispose = attachTooltip(anchor, () => 'Shadow tip', { group: 'shared' });
  const first = anchor.nextElementSibling as SCWCTooltip;
  const second = boundTip('shared');
  anchor.dispatchEvent(new MouseEvent('mouseenter'));
  await vi.advanceTimersByTimeAsync(1000);
  anchor.dispatchEvent(new MouseEvent('mouseleave'));
  second.enter();
  await second.tooltip.updateComplete;
  expect(first.hidden).toBe(true);
  expect(second.tooltip.hidden).toBe(false);
  dispose();
  second.dispose();
});
