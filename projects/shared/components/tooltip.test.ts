import { afterEach, expect, it } from 'vitest';
import { attachTooltip, type SCWCTooltip } from './tooltip.ts';

afterEach(() => document.body.replaceChildren());

it('shows complete plain text on hover/focus and closes when feedback changes or the surface scrolls', async () => {
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const message = document.createElement('div');
  message.textContent = '<b>完整提示</b>\n第二行';
  root.append(message);
  document.body.append(host);
  const dispose = attachTooltip(message, () => message.textContent ?? '');
  const tooltip = root.querySelector('scwc-tooltip') as SCWCTooltip;
  message.dispatchEvent(new MouseEvent('mouseenter'));
  await tooltip.updateComplete;
  expect(tooltip.hidden).toBe(false);
  expect(tooltip.shadowRoot?.textContent).toContain('<b>完整提示</b>\n第二行');
  expect(tooltip.shadowRoot?.querySelector('b')).toBeNull();
  expect(message.hasAttribute('title')).toBe(false);
  message.textContent = '新错误';
  await Promise.resolve();
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focus'));
  await tooltip.updateComplete;
  expect(tooltip.text).toBe('新错误');
  expect(tooltip.hidden).toBe(false);
  root.dispatchEvent(new Event('scroll'));
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focus'));
  await tooltip.updateComplete;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(tooltip.hidden).toBe(true);
  dispose();
  expect(root.querySelector('scwc-tooltip')).toBeNull();
});

it('cancels pending opens when a view is replaced or disposed', async () => {
  const message = document.createElement('div');
  document.body.append(message);
  const dispose = attachTooltip(message, () => '旧视图的提示');
  const tooltip = document.querySelector('scwc-tooltip') as SCWCTooltip;
  message.dispatchEvent(new MouseEvent('mouseenter'));
  dispose();
  await tooltip.updateComplete;
  expect(tooltip.isConnected).toBe(false);
  expect(tooltip.hidden).toBe(true);
  message.dispatchEvent(new FocusEvent('focus'));
  expect(document.querySelector('scwc-tooltip')).toBeNull();
});
