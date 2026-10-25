import { afterEach, expect, it } from 'vitest';
import { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

afterEach(() => document.body.replaceChildren());

async function fixture() {
  const area = new WorkbenchScrollContainer();
  document.body.append(area);
  await area.updateComplete;
  const viewport = requireValue(area.scrollElement);
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

it('accumulates wheel input into single rendered log lines and updates the step with typography', async () => {
  const { area, viewport } = await fixture();
  area.innerHTML =
    '<div class="output-line" style="line-height:20px;padding:1px 0"><span style="padding-top:2px">log</span></div>';
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
  requireValue(area.querySelector<HTMLElement>('.output-line')).style.lineHeight = '30px';
  area.refresh();
  expect(area.stepDistance).toBe(34);
});

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
