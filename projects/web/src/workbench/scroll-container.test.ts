import { afterEach, expect, it } from 'vitest';
import { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { wheelTiming } from '../../../shared/components/scroll-container/wheel-motion.ts';

afterEach(() => document.body.replaceChildren());

it('finishes the slowest wheel gesture sooner while decelerating longer with zero acceleration', () => {
  const area = new WorkbenchScrollContainer();
  const previous = wheelTiming(1000, { accelerationRatio: 0, minAcceleration: 0 });
  const current = wheelTiming(1000, area.smoothWheel);
  expect(current.duration).toBeLessThan(previous.duration);
  expect(current.deceleration).toBeGreaterThan(previous.deceleration);
  expect(current.acceleration).toBe(0);
});

async function fixture() {
  const area = new WorkbenchScrollContainer();
  document.body.append(area);
  await area.updateComplete;
  expect(area.horizontal.size).toBe(4);
  expect(area.vertical.size).toBe(4);
  const viewport = requireValue(area.scrollElement);
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 300 },
    clientHeight: { configurable: true, value: 100 },
  });
  Object.defineProperties(requireValue(area.shadowRoot?.querySelector('.frame')), {
    clientWidth: { value: 300 },
    clientHeight: { value: 100 },
  });
  Object.defineProperties(requireValue(area.shadowRoot?.querySelector('.content')), {
    scrollWidth: { value: 300 },
    scrollHeight: { value: 1000 },
  });
  viewport.scrollTo = (options: ScrollToOptions | number = {}, y?: number) => {
    viewport.scrollTop =
      typeof options === 'number' ? (y ?? 0) : (options.top ?? viewport.scrollTop);
    viewport.scrollLeft =
      typeof options === 'number' ? options : (options.left ?? viewport.scrollLeft);
  };
  area.refresh();
  return { area, viewport };
}

it('caps each oversized wheel event before accumulation and discards the excess', async () => {
  const { area, viewport } = await fixture();
  area.scrollBehavior = 'instant';
  area.stepDistance = 20;
  await area.updateComplete;
  const wheel = (deltaY: number) =>
    area.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
  wheel(1000);
  wheel(1000);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(160);
  wheel(20);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(180);
  wheel(-1000);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(100);
});

it.each([
  { mode: 0, delta: 100, ratio: 0.5, max: 60, expected: 50 },
  { mode: 0, delta: 100, ratio: 2, max: 60, expected: 60 },
  { mode: 1, delta: 10, ratio: 0.5, max: 60, expected: 60 },
  { mode: 2, delta: 1, ratio: 0.5, max: 60, expected: 50 },
  { mode: 0, delta: 100, ratio: 2, max: 0, expected: 200 },
  { mode: 0, delta: 100, ratio: 0, max: 60, expected: 0 },
])(
  'normalizes and scales wheel input before applying the limit: %j',
  async ({ mode, delta, ratio, max, expected }) => {
    const { area, viewport } = await fixture();
    area.scrollBehavior = 'instant';
    area.stepDistance = 0;
    area.setAttribute('wheel-distance-ratio', String(ratio));
    area.setAttribute('max-wheel-distance', String(max));
    await area.updateComplete;
    const event = new WheelEvent('wheel', { deltaY: delta, deltaMode: mode, cancelable: true });
    area.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(expected);
  },
);

it('clears pending wheel distance when the ratio or maximum changes', async () => {
  const { area, viewport } = await fixture();
  area.scrollBehavior = 'instant';
  area.stepDistance = 20;
  await area.updateComplete;
  area.dispatchEvent(new WheelEvent('wheel', { deltaY: 15, cancelable: true }));
  await new Promise(requestAnimationFrame);
  area.wheelDistanceRatio = 2;
  area.maxWheelDistance = 40;
  await area.updateComplete;
  area.dispatchEvent(new WheelEvent('wheel', { deltaY: 5, cancelable: true }));
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(0);
});

it.each(['output-line', 'terminal-output-line'])(
  'limits each wheel event to one %s and updates the limit with typography',
  async (rowClass) => {
    const { area, viewport } = await fixture();
    area.innerHTML = `<div class="${rowClass}" style="line-height:20px;padding:1px 0"><span style="padding-top:2px">log</span></div>`;
    area.lineScroll = true;
    area.scrollBehavior = 'instant';
    await area.updateComplete;
    area.refresh();
    const wheel = (deltaY: number) =>
      area.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true }));
    expect(wheel(10)).toBe(false);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(0);
    wheel(14);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(24);
    expect(area.maxWheelDistance).toBe(24);
    wheel(1000);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(48);
    wheel(-1000);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(24);
    requireValue(area.querySelector<HTMLElement>(`.${rowClass}`)).style.lineHeight = '30px';
    area.refresh();
    expect(area.stepDistance).toBe(34);
    expect(area.maxWheelDistance).toBe(34);
    wheel(1000);
    await new Promise(requestAnimationFrame);
    expect(viewport.scrollTop).toBe(58);
  },
);

it('lets native configuration textareas scroll until their boundary before scrolling the parent', async () => {
  const { area, viewport } = await fixture();
  area.scrollBehavior = 'instant';
  const input = document.createElement('textarea');
  area.append(input);
  Object.defineProperties(input, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
  const wheel = () =>
    input.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 40, bubbles: true, composed: true, cancelable: true }),
    );
  expect(wheel()).toBe(true);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(0);
  input.scrollTop = 400;
  expect(wheel()).toBe(false);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(40);
});

it('keeps only whole rows and puts the remainder above the viewport without accumulating margins', async () => {
  const { area } = await fixture();
  area.innerHTML = '<div class="output-line" style="line-height:21px">one line</div>';
  area.lineScroll = true;
  area.wholeLines = true;
  let available = 203;
  area.getBoundingClientRect = () =>
    new DOMRect(0, 0, 300, available - (Number.parseFloat(area.style.marginTop) || 0));
  await area.updateComplete;
  area.refresh();
  expect(area.stepDistance).toBe(21);
  expect(area.style.marginTop).toBe('14px');
  area.refresh();
  expect(area.style.marginTop).toBe('14px');
  available = 219;
  area.refresh();
  expect(area.style.marginTop).toBe('9px');
  expect(area.getBoundingClientRect().height).toBe(210);
});

it('allows only thumb dragging for layout scrollbars while preserving inner controls and zoom', async () => {
  const { area, viewport } = await fixture();
  Object.defineProperties(viewport, { clientWidth: { value: 300 }, clientHeight: { value: 100 } });
  area.refresh();
  area.dragOnly = true;
  area.wheelDirection = 'none';
  area.shiftWheelDirection = 'none';
  await area.updateComplete;
  const event = (key: string) =>
    new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true });
  expect(viewport.dispatchEvent(event('ArrowDown'))).toBe(false);
  expect(viewport.dispatchEvent(event('Tab'))).toBe(true);
  const input = document.createElement('textarea');
  area.append(input);
  expect(input.dispatchEvent(event('ArrowDown'))).toBe(true);
  const track = requireValue(area.shadowRoot?.querySelector<HTMLElement>('.track'));
  expect(
    track.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, composed: true, cancelable: true, button: 0 }),
    ),
  ).toBe(false);
  expect(track.classList.contains('dragging')).toBe(false);
  Object.defineProperty(track, 'getBoundingClientRect', {
    value: () => new DOMRect(296, 0, 4, 100),
  });
  const thumb = requireValue(track.querySelector('.thumb'));
  thumb.dispatchEvent(
    new MouseEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      button: 0,
      clientY: 10,
    }),
  );
  document.dispatchEvent(
    new MouseEvent('pointermove', { bubbles: true, cancelable: true, clientY: 50 }),
  );
  expect(viewport.scrollTop).toBeGreaterThan(0);
  document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientY: 50 }));
  area.scrollTo({ top: 0 });
  for (const shiftKey of [false, true]) {
    expect(
      area.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 40, shiftKey, bubbles: true, cancelable: true }),
      ),
    ).toBe(false);
  }
  expect(
    area.dispatchEvent(
      new WheelEvent('wheel', { deltaY: 40, ctrlKey: true, bubbles: true, cancelable: true }),
    ),
  ).toBe(true);
  await new Promise(requestAnimationFrame);
  expect(viewport.scrollTop).toBe(0);
});
