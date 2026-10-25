import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { html } from 'lit';
import { SCWCScrollContainer } from './index.ts';
import type { UpdateScrollMetrics } from './types.ts';

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  elements = new Set<Element>();
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    TestResizeObserver.instances.push(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  unobserve(element: Element) {
    this.elements.delete(element);
  }
  disconnect() {
    this.elements.clear();
  }
  resize() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  TestResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function settle(el: SCWCScrollContainer) {
  await el.updateComplete;
  await el.updateComplete;
}

async function fixture(
  options: { width?: number; height?: number; scrollWidth?: number; scrollHeight?: number } = {},
) {
  const el = new SCWCScrollContainer();
  el.scrollBehavior = 'instant';
  el.append(document.createElement('div'));
  document.body.append(el);
  await settle(el);
  const viewport = el.scrollElement;
  const frame = el.shadowRoot?.querySelector<HTMLElement>('.frame');
  const content = el.shadowRoot?.querySelector<HTMLElement>('.content');
  if (!viewport || !frame || !content) {
    throw new Error('missing rendered scroll container');
  }
  const dimensions = { width: 200, height: 100, scrollWidth: 1000, scrollHeight: 500, ...options };
  Object.defineProperties(viewport, {
    clientWidth: { get: () => dimensions.width - parseFloat(frame.style.paddingRight || '0') },
    clientHeight: { get: () => dimensions.height - parseFloat(frame.style.paddingBottom || '0') },
  });
  Object.defineProperties(content, {
    scrollWidth: { get: () => dimensions.scrollWidth },
    scrollHeight: { get: () => dimensions.scrollHeight },
  });
  const scrollTo = vi.fn((options?: ScrollToOptions | number, y?: number) => {
    const request = typeof options === 'number' ? { left: options, top: y } : (options ?? {});
    viewport.scrollLeft = request.left ?? viewport.scrollLeft;
    viewport.scrollTop = request.top ?? viewport.scrollTop;
  });
  viewport.scrollTo = scrollTo;
  el.refresh();
  await settle(el);
  const track = (axis: string) => el.shadowRoot?.querySelector<HTMLElement>(`.${axis}`) ?? null;
  const thumb = (axis: string) => track(axis)?.querySelector<HTMLElement>('.thumb') ?? null;
  return { el, viewport, frame, content, dimensions, scrollTo, track, thumb };
}

function wheel(el: HTMLElement, options: WheelEventInit = {}) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    composed: true,
    cancelable: true,
    deltaY: 30,
    ...options,
  });
  el.dispatchEvent(event);
  return event;
}

function browserFrame() {
  vi.advanceTimersByTime(16);
}

function pointer(target: EventTarget, type: string, x: number, y: number, id = 1, button = 0) {
  const event = new MouseEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
  });
  Object.defineProperty(event, 'pointerId', { value: id });
  target.dispatchEvent(event);
  return event;
}

describe('SCWCScrollContainer', () => {
  it('renders only overflowing axes and never reserves space in overlay mode', async () => {
    const { el, frame, track, dimensions } = await fixture({ scrollHeight: 80 });
    expect(track('horizontal')).not.toBeNull();
    expect(track('vertical')).toBeNull();
    expect(frame.style.paddingRight).toBe('0px');
    expect(frame.style.paddingBottom).toBe('0px');
    dimensions.scrollWidth = 180;
    el.refresh();
    await settle(el);
    el.dispatchEvent(new Event('pointerenter'));
    await settle(el);
    expect(track('horizontal')).toBeNull();
    expect(el.scrollState.maxScrollLeft).toBe(0);
  });

  it('reserves independent gutters only while needed and resolves coupled overflow', async () => {
    const { el, frame, track, dimensions } = await fixture({ scrollWidth: 195, scrollHeight: 500 });
    el.horizontal = { placement: 'gutter', size: 8 };
    el.vertical = { placement: 'gutter', size: 12 };
    await settle(el);
    expect(frame.style.paddingRight).toBe('12px');
    expect(frame.style.paddingBottom).toBe('8px');
    expect(el.scrollState).toMatchObject({ clientWidth: 188, clientHeight: 92 });
    expect(track('horizontal')).not.toBeNull();
    dimensions.scrollHeight = 80;
    el.refresh();
    await settle(el);
    expect(frame.style.paddingRight).toBe('0px');
    expect(frame.style.paddingBottom).toBe('0px');
    expect(track('horizontal')).toBeNull();
    expect(track('vertical')).toBeNull();
  });

  it('keeps both tracks out of their shared overlay corner', async () => {
    const { el, track } = await fixture();
    el.horizontal = { size: 8 };
    el.vertical = { size: 12 };
    await settle(el);
    expect(track('horizontal')?.style.width).toBe('188px');
    expect(track('vertical')?.style.height).toBe('92px');
  });

  it('reveals overflowing bars on hover and uses independent fast-in, slow-out transitions', async () => {
    const { el, track, thumb } = await fixture();
    el.horizontal = {
      size: 9,
      color: 'red',
      radius: 7,
      opacity: 0.7,
      fadeInDuration: 50,
      fadeOutDuration: 700,
      hideDelay: 100,
    };
    el.vertical = {
      size: 5,
      color: 'blue',
      radius: 2,
      opacity: 0.3,
      fadeInDuration: 20,
      fadeOutDuration: 900,
      hideDelay: 200,
    };
    await settle(el);
    vi.advanceTimersByTime(1000);
    await settle(el);
    expect(track('horizontal')?.style.opacity).toBe('0');
    el.dispatchEvent(new Event('pointerenter'));
    await settle(el);
    expect(track('horizontal')?.style.opacity).toBe('0.7');
    expect(track('horizontal')?.style.transitionDuration).toBe('50ms');
    expect(thumb('horizontal')?.style.backgroundColor).toBe('red');
    expect(thumb('horizontal')?.style.borderRadius).toBe('7px');
    expect(track('vertical')?.style.width).toBe('5px');
    vi.advanceTimersByTime(10000);
    await settle(el);
    expect(track('vertical')?.style.opacity).toBe('0.3');
    el.dispatchEvent(new Event('pointerleave'));
    vi.advanceTimersByTime(100);
    await settle(el);
    expect(track('horizontal')?.style.opacity).toBe('0');
    expect(track('horizontal')?.style.transitionDuration).toBe('700ms');
    expect(track('vertical')?.style.opacity).toBe('0.3');
    vi.advanceTimersByTime(100);
    await settle(el);
    expect(track('vertical')?.style.transitionDuration).toBe('900ms');
  });

  it('reveals just the axis whose content or container dimension changed', async () => {
    const { el, dimensions, track, thumb } = await fixture();
    vi.advanceTimersByTime(1000);
    await settle(el);
    const oldSize = thumb('horizontal')?.style.width;
    dimensions.scrollWidth = 2000;
    TestResizeObserver.instances[0].resize();
    vi.advanceTimersByTime(16);
    await settle(el);
    expect(track('horizontal')?.style.opacity).toBe('0.5');
    expect(track('vertical')?.style.opacity).toBe('0');
    expect(thumb('horizontal')?.style.width).not.toBe(oldSize);
    vi.advanceTimersByTime(1000);
    dimensions.height = 150;
    TestResizeObserver.instances[0].resize();
    vi.advanceTimersByTime(16);
    await settle(el);
    expect(track('horizontal')?.style.opacity).toBe('0');
    expect(track('vertical')?.style.opacity).toBe('0.5');
  });

  it('observes new slotted descendants, text and attribute mutations', async () => {
    const { el, dimensions } = await fixture();
    const wrapper = document.createElement('div');
    const child = document.createElement('img');
    wrapper.append(child);
    el.append(wrapper);
    await Promise.resolve();
    expect(TestResizeObserver.instances[0].elements.has(child)).toBe(true);
    dimensions.scrollWidth = 1800;
    child.style.width = '1800px';
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(el.scrollState.scrollWidth).toBe(1800);
    wrapper.remove();
    await Promise.resolve();
    expect(TestResizeObserver.instances[0].elements.has(child)).toBe(false);
  });

  it('clamps position after content shrinks and notifies both consumers once', async () => {
    const { el, dimensions } = await fixture();
    el.scrollTo(800, 400);
    const outside = vi.fn();
    const inside = vi.fn();
    el.addEventListener('scroll', outside);
    el.contentScroll = inside;
    dimensions.scrollWidth = 300;
    dimensions.scrollHeight = 200;
    el.refresh();
    expect(el.scrollState).toMatchObject({ scrollLeft: 100, scrollTop: 100 });
    expect(inside).toHaveBeenCalledOnce();
    expect(outside).toHaveBeenCalledOnce();
    expect(inside.mock.calls[0][0]).toBe(outside.mock.calls[0][0].detail);
    expect(Object.isFrozen(inside.mock.calls[0][0])).toBe(true);
  });

  it('delivers native scroll events across shadow roots and updates accessible values', async () => {
    const { el, viewport, track } = await fixture();
    const outside = vi.fn();
    document.body.addEventListener('scroll', outside, { once: true });
    viewport.scrollLeft = 200;
    viewport.scrollTop = 80;
    viewport.dispatchEvent(new Event('scroll'));
    viewport.dispatchEvent(new Event('scroll'));
    await settle(el);
    expect(outside).toHaveBeenCalledOnce();
    expect(outside.mock.calls[0][0].composed).toBe(true);
    expect(el.scrollState).toMatchObject({ scrollLeft: 200, scrollTop: 80 });
    expect(track('horizontal')?.getAttribute('aria-valuenow')).toBe('200');
    expect(track('vertical')?.getAttribute('aria-controls')).toBe(viewport.id);
  });

  it('lets internal content publish logical extents and position for virtual scrolling', async () => {
    const { el } = await fixture();
    let update: UpdateScrollMetrics | undefined;
    el.content = (callback) => {
      update = callback;
      return html`<div>virtual rows</div>`;
    };
    await settle(el);
    expect(update).toBeTypeOf('function');
    update?.({ scrollWidth: 2000, scrollHeight: 10000, scrollLeft: 100, scrollTop: 9000 });
    expect(el.scrollState).toMatchObject({
      scrollWidth: 2000,
      scrollHeight: 10000,
      scrollLeft: 100,
      scrollTop: 9000,
    });
    expect(el.shadowRoot?.querySelector<HTMLElement>('.extent')?.style.height).toBe('10000px');
    update?.({ scrollTop: 9500 });
    expect(el.scrollState.scrollHeight).toBe(10000);
    expect(el.scrollState.scrollTop).toBe(9500);
  });

  it('preserves nested content scroll events instead of treating them as viewport scrolling', async () => {
    const { el } = await fixture();
    const outside = vi.fn();
    el.addEventListener('scroll', outside);
    const detail = { scrollTop: 25 };
    el.firstElementChild?.dispatchEvent(
      new CustomEvent('scroll', { detail, bubbles: true, composed: true }),
    );
    expect(outside).toHaveBeenCalledOnce();
    expect(outside.mock.calls[0][0].detail).toBe(detail);
    expect(el.scrollState.scrollTop).toBe(0);
  });

  it('gives external values priority, revokes retained callbacks, and restores internal mode', async () => {
    const { el } = await fixture();
    let latest: UpdateScrollMetrics | undefined;
    el.content = (callback) => {
      latest = callback;
      return html`<div>rows</div>`;
    };
    await settle(el);
    const old = latest;
    el.metrics = { scrollWidth: 3000, scrollHeight: 20000, scrollLeft: 500, scrollTop: 12000 };
    await settle(el);
    expect(latest).toBeUndefined();
    old?.({ scrollHeight: 99, scrollTop: 0 });
    expect(el.scrollState).toMatchObject({
      scrollHeight: 20000,
      scrollLeft: 500,
      scrollTop: 12000,
    });
    el.metrics = { scrollWidth: 500, scrollHeight: 500, scrollLeft: 9999, scrollTop: -1 };
    await settle(el);
    expect(el.scrollState).toMatchObject({ scrollLeft: 300, scrollTop: 0 });
    el.metrics = undefined;
    await settle(el);
    expect(latest).toBeTypeOf('function');
    latest?.({ scrollHeight: 900 });
    expect(el.scrollState.scrollHeight).toBe(900);
  });

  it('keeps externally supplied extents on resize while allowing user scroll notifications', async () => {
    const { el, dimensions } = await fixture();
    el.metrics = { scrollHeight: 2000, scrollTop: 300 };
    await settle(el);
    const extent = el.shadowRoot?.querySelector<HTMLElement>('.extent');
    expect(extent?.style.width).toBe('1000px');
    expect(extent?.style.height).toBe('2000px');
    el.scrollTo({ top: 600 });
    dimensions.height = 200;
    el.refresh();
    expect(el.scrollState).toMatchObject({ scrollHeight: 2000, scrollTop: 600, clientHeight: 200 });
  });

  it.each([
    ['auto', { deltaX: 40, deltaY: 40 }, 40, 40],
    ['horizontal', { deltaY: 40 }, 40, 0],
    ['vertical', { deltaX: 40, deltaY: 0 }, 0, 40],
  ] as const)(
    'routes normal wheels in %s mode with a configured jump distance',
    async (direction, delta, left, top) => {
      const { el } = await fixture();
      el.wheelDirection = direction;
      expect(wheel(el, delta).defaultPrevented).toBe(true);
      expect(el.scrollState).toMatchObject({ scrollLeft: 0, scrollTop: 0 });
      browserFrame();
      expect(el.scrollState).toMatchObject({ scrollLeft: left, scrollTop: top });
      el.stepDistance = 75;
      const request: WheelEventInit = delta;
      wheel(el, {
        deltaX: Math.sign(request.deltaX ?? 0) * 75,
        deltaY: Math.sign(request.deltaY ?? 0) * 75,
      });
      browserFrame();
      expect(el.scrollState.scrollLeft || el.scrollState.scrollTop).toBe(left || top ? 115 : 0);
    },
  );

  it('configures Shift wheels separately, including browser-remapped horizontal deltas', async () => {
    const { el } = await fixture();
    wheel(el, { shiftKey: true, deltaY: 40 });
    browserFrame();
    expect(el.scrollState).toMatchObject({ scrollLeft: 40, scrollTop: 0 });
    el.shiftWheelDirection = 'vertical';
    wheel(el, { shiftKey: true, deltaX: 40, deltaY: 0 });
    browserFrame();
    expect(el.scrollState).toMatchObject({ scrollLeft: 40, scrollTop: 40 });
    el.shiftWheelDirection = 'none';
    expect(wheel(el, { shiftKey: true }).defaultPrevented).toBe(true);
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
    el.wheelDirection = 'none';
    expect(wheel(el).defaultPrevented).toBe(true);
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
  });

  it('preserves zoom and allows ancestors to scroll at an exhausted boundary', async () => {
    const { el } = await fixture();
    expect(wheel(el, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(el, { metaKey: true }).defaultPrevented).toBe(false);
    expect(el.scrollState.scrollTop).toBe(0);
    el.scrollTo({ top: 400 });
    expect(wheel(el).defaultPrevented).toBe(false);
  });

  it('normalizes line/page deltas and animates their sum with one write per frame', async () => {
    const { el, scrollTo } = await fixture();
    el.scrollBehavior = 'smooth';
    wheel(el, { deltaY: 2, deltaMode: 1 });
    wheel(el, { deltaY: 2, deltaMode: 1 });
    expect(scrollTo).not.toHaveBeenCalled();
    browserFrame();
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(el.scrollState.scrollTop).toBeGreaterThan(0);
    expect(el.scrollState.scrollTop).toBeLessThan(64);
    vi.advanceTimersByTime(300);
    expect(el.scrollState.scrollTop).toBe(64);
    wheel(el, { deltaY: 1, deltaMode: 2 });
    browserFrame();
    vi.advanceTimersByTime(300);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 164, behavior: 'instant' });
    el.scrollTo({ top: 0, behavior: 'instant' });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 0, behavior: 'instant' });
  });

  it('combines high-frequency fractional input into one animation and emits once per frame', async () => {
    const { el, scrollTo, viewport } = await fixture();
    el.scrollBehavior = 'smooth';
    const outside = vi.fn(),
      inside = vi.fn();
    el.addEventListener('scroll', outside);
    el.contentScroll = inside;
    for (let index = 0; index < 100; index++) {
      expect(wheel(el, { deltaX: 0.25, deltaY: 0.5 }).defaultPrevented).toBe(true);
    }
    expect(scrollTo).not.toHaveBeenCalled();
    browserFrame();
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(el.scrollState.scrollTop).toBeGreaterThan(0);
    expect(el.scrollState.scrollTop).toBeLessThan(50);
    expect(outside).toHaveBeenCalledOnce();
    expect(inside).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);
    expect(scrollTo.mock.calls.length).toBeLessThanOrEqual(16);
    expect(outside).toHaveBeenCalledTimes(scrollTo.mock.calls.length);
    expect(el.scrollState).toMatchObject({ scrollLeft: 25, scrollTop: 50 });
  });

  it('moves the same distance for one large event and many small events, including multiple jumps in a frame', async () => {
    const burst = await fixture(),
      single = await fixture();
    for (let index = 0; index < 20; index++) {
      wheel(burst.el, { deltaY: 7 });
    }
    wheel(single.el, { deltaY: 140 });
    expect(burst.el.scrollState.scrollTop).toBe(0);
    browserFrame();
    expect(burst.el.scrollState.scrollTop).toBe(120);
    expect(single.el.scrollState.scrollTop).toBe(120);
    expect(burst.scrollTo).toHaveBeenCalledOnce();
    wheel(burst.el, { deltaY: 20 });
    wheel(single.el, { deltaY: 20 });
    browserFrame();
    expect(burst.el.scrollState.scrollTop).toBe(160);
    expect(single.el.scrollState.scrollTop).toBe(160);
  });

  it('retains sub-step distances across frames until enough distance accumulates', async () => {
    const { el, scrollTo } = await fixture();
    for (let index = 0; index < 2; index++) {
      expect(wheel(el, { deltaY: 15 }).defaultPrevented).toBe(true);
      browserFrame();
      expect(el.scrollState.scrollTop).toBe(0);
      expect(scrollTo).not.toHaveBeenCalled();
    }
    wheel(el, { deltaY: 15 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
    wheel(el, { deltaY: 35 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(80);
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('discards a partial jump after input stops, so a new gesture starts without the old remainder', async () => {
    const { el, scrollTo } = await fixture();
    wheel(el, { deltaY: 30 });
    browserFrame();
    vi.advanceTimersByTime(150);
    expect(scrollTo).not.toHaveBeenCalled();
    wheel(el, { deltaY: 20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(0);
    wheel(el, { deltaY: 20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
  });

  it('preserves complete jumps but discards their remainder if a browser frame is delayed past idle', async () => {
    const { el } = await fixture();
    browserFrame();
    let callback: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', (next: FrameRequestCallback) => {
      callback = next;
      return 123;
    });
    wheel(el, { deltaY: 100 });
    vi.advanceTimersByTime(150);
    callback?.(0);
    expect(el.scrollState.scrollTop).toBe(80);
    wheel(el, { deltaY: 20 });
    callback?.(0);
    expect(el.scrollState.scrollTop).toBe(80);
    wheel(el, { deltaY: 20 });
    callback?.(0);
    expect(el.scrollState.scrollTop).toBe(120);
  });

  it('accumulates each axis independently and cancels opposing distances before quantizing', async () => {
    const { el } = await fixture();
    wheel(el, { deltaX: 25, deltaY: 45 });
    browserFrame();
    expect(el.scrollState).toMatchObject({ scrollLeft: 0, scrollTop: 40 });
    wheel(el, { deltaX: 15, deltaY: 35 });
    browserFrame();
    expect(el.scrollState).toMatchObject({ scrollLeft: 40, scrollTop: 80 });
    wheel(el, { deltaY: -50 });
    wheel(el, { deltaY: 30 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(80);
    wheel(el, { deltaY: -20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
  });

  it('lets reverse input cancel a pending movement even at the initial boundary', async () => {
    const { el, scrollTo } = await fixture();
    el.scrollBehavior = 'smooth';
    wheel(el, { deltaY: 100 });
    expect(wheel(el, { deltaY: -100 }).defaultPrevented).toBe(true);
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(0);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('does not lose a complete jump when fractional pixel sums have floating-point error', async () => {
    const { el } = await fixture();
    for (let index = 0; index < 400; index++) {
      wheel(el, { deltaY: 0.1 });
    }
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
  });

  it('treats a zero step as unquantized frame scrolling', async () => {
    const { el } = await fixture();
    el.stepDistance = 0;
    wheel(el, { deltaY: 12.5 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(12.5);
  });

  it('clamps multiple jumps at the edge and drops overflow before reversing direction', async () => {
    const { el } = await fixture();
    el.scrollTo({ top: 390 });
    wheel(el, { deltaY: 100 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(400);
    expect(wheel(el, { deltaY: 40 }).defaultPrevented).toBe(false);
    wheel(el, { deltaY: -20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(400);
    wheel(el, { deltaY: -20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(360);
  });

  it('cancels queued input and partial jumps when an explicit position is supplied', async () => {
    const { el } = await fixture();
    wheel(el, { deltaY: 100 });
    el.scrollTo({ top: 100 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(100);
    wheel(el, { deltaY: 30 });
    browserFrame();
    el.metrics = { scrollTop: 200 };
    await settle(el);
    wheel(el, { deltaY: 20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(200);
  });

  it('resets buffered input when policies change without discarding input already using the new policy', async () => {
    const { el } = await fixture();
    wheel(el, { deltaY: 30 });
    browserFrame();
    el.scrollBehavior = 'smooth';
    wheel(el, { deltaY: 10 });
    await settle(el);
    browserFrame();
    vi.advanceTimersByTime(300);
    expect(el.scrollState.scrollTop).toBe(10);
    wheel(el, { deltaY: 90 });
    el.wheelDirection = 'none';
    await settle(el);
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(10);
  });

  it('prevents nested containers from consuming the same partial jump and chains only at the edge', async () => {
    const outer = await fixture(),
      inner = await fixture();
    outer.el.append(inner.el);
    wheel(inner.el, { deltaY: 20 });
    browserFrame();
    wheel(inner.el, { deltaY: 20 });
    browserFrame();
    expect(inner.el.scrollState.scrollTop).toBe(40);
    expect(outer.el.scrollState.scrollTop).toBe(0);
    inner.el.scrollTo({ top: 400 });
    wheel(inner.el, { deltaY: 40 });
    browserFrame();
    expect(outer.el.scrollState.scrollTop).toBe(40);
  });

  it('honors reduced motion for smooth requests', async () => {
    const { el, scrollTo } = await fixture();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    el.scrollBehavior = 'smooth';
    el.scrollTo({ top: 100 });
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 100, behavior: 'instant' });
    wheel(el, { deltaY: 13 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(113);
  });

  it('cancels a smooth trajectory after resize clamps its target and lets reverse input move immediately', async () => {
    const { el, dimensions } = await fixture();
    el.scrollBehavior = 'smooth';
    wheel(el, { deltaY: 400 });
    vi.advanceTimersByTime(80);
    dimensions.scrollHeight = 200;
    el.refresh();
    expect(el.scrollState.scrollTop).toBe(100);
    wheel(el, { deltaY: -20 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBeLessThan(100);
    vi.advanceTimersByTime(300);
    expect(el.scrollState.scrollTop).toBe(80);
  });

  it.each(['horizontal', 'vertical'] as const)(
    'drags the %s thumb to the exact end without changing cursor styles',
    async (axis) => {
      const { el, track, thumb } = await fixture();
      const bar = track(axis),
        handle = thumb(axis);
      if (!bar || !handle) {
        throw new Error('missing scrollbar');
      }
      vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 20 } as DOMRect);
      pointer(handle, 'pointerdown', 10, 20);
      pointer(document, 'pointermove', 500, 500, 2);
      expect(el.scrollState.scrollLeft).toBe(0);
      pointer(document, 'pointermove', 500, 500);
      expect(axis === 'horizontal' ? el.scrollState.scrollLeft : el.scrollState.scrollTop).toBe(
        axis === 'horizontal' ? 800 : 400,
      );
      expect(handle.style.cursor).toBe('');
      expect(document.body.style.cursor).toBe('');
      el.dispatchEvent(new Event('pointerleave'));
      vi.advanceTimersByTime(2000);
      await settle(el);
      expect(track(axis)?.style.opacity).toBe('0.5');
      pointer(document, 'pointerup', 500, 500);
      vi.advanceTimersByTime(600);
      await settle(el);
      expect(track(axis)?.style.opacity).toBe('0');
    },
  );

  it('supports track clicks, pointer cancellation and ignores secondary buttons', async () => {
    const { el, track, thumb } = await fixture();
    const bar = track('horizontal'),
      handle = thumb('horizontal');
    if (!bar || !handle) {
      throw new Error('missing scrollbar');
    }
    pointer(bar, 'pointerdown', 150, 0, 1, 2);
    expect(el.scrollState.scrollLeft).toBe(0);
    pointer(bar, 'pointerdown', 150, 0);
    expect(el.scrollState.scrollLeft).toBeGreaterThan(400);
    pointer(document, 'pointercancel', 150, 0);
    const position = el.scrollState.scrollLeft;
    pointer(document, 'pointermove', 0, 0);
    expect(el.scrollState.scrollLeft).toBe(position);
  });

  it('uses current geometry during dragging and releases capture if resizing removes overflow', async () => {
    const { el, dimensions, thumb, track } = await fixture({ scrollHeight: 80 });
    const handle = thumb('horizontal');
    if (!handle) {
      throw new Error('missing thumb');
    }
    const capture = vi.fn(),
      release = vi.fn();
    handle.setPointerCapture = capture;
    handle.hasPointerCapture = () => true;
    handle.releasePointerCapture = release;
    pointer(handle, 'pointerdown', 0, 0);
    expect(capture).toHaveBeenCalledWith(1);
    dimensions.width = 400;
    el.refresh();
    pointer(document, 'pointermove', 400, 0);
    expect(el.scrollState.scrollLeft).toBe(600);
    dimensions.scrollWidth = 300;
    el.refresh();
    await settle(el);
    expect(track('horizontal')).toBeNull();
    expect(release).toHaveBeenCalledWith(1);
    pointer(document, 'pointermove', 200, 0);
    expect(el.scrollState.scrollLeft).toBe(0);
  });

  it('supports keyboard navigation and keeps focused bars visible', async () => {
    const { el, track } = await fixture();
    const bar = track('vertical');
    if (!bar) {
      throw new Error('missing scrollbar');
    }
    bar.focus();
    vi.advanceTimersByTime(2000);
    await settle(el);
    expect(track('vertical')?.style.opacity).toBe('0.5');
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', cancelable: true }));
    expect(el.scrollState.scrollTop).toBe(100);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', cancelable: true }));
    expect(el.scrollState.scrollTop).toBe(400);
    bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', cancelable: true }));
    expect(el.scrollState.scrollTop).toBe(0);
  });

  it('disconnects observers, timers and drag handlers and restores them after reconnecting', async () => {
    const { el, thumb, viewport } = await fixture();
    const handle = thumb('horizontal');
    if (!handle) {
      throw new Error('missing thumb');
    }
    pointer(handle, 'pointerdown', 0, 0);
    TestResizeObserver.instances[0].resize();
    el.remove();
    expect(TestResizeObserver.instances[0].elements.size).toBe(0);
    vi.advanceTimersByTime(2000);
    pointer(document, 'pointermove', 500, 500);
    expect(viewport.scrollLeft).toBe(0);
    document.body.append(el);
    await settle(el);
    expect(
      TestResizeObserver.instances[TestResizeObserver.instances.length - 1]?.elements.has(viewport),
    ).toBe(true);
    wheel(el, { deltaY: 40 });
    browserFrame();
    expect(el.scrollState.scrollTop).toBe(40);
  });
});
