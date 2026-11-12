import { afterEach, expect, it, vi } from 'vitest';
import { createJSONComponents } from './json-components.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('uses existing label height for feedback and falls back to an icon on resize or wrapping', () => {
  let resize: () => void = () => undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const content = document.createElement('div');
  content.innerHTML = `<div class="ui-setting">
    <div class="ui-setting-copy">Label and description</div>
    <div class="ui-setting-control"><div class="ui-field">
      <input><div class="ui-field-error"><span class="ui-field-error-text">Full warning</span></div>
    </div></div>
  </div>`;
  document.body.append(content);
  const copy = requireValue(content.querySelector<HTMLElement>('.ui-setting-copy'));
  const field = requireValue(content.querySelector<HTMLElement>('.ui-field'));
  const message = requireValue(content.querySelector<HTMLElement>('.ui-field-error'));
  copy.getBoundingClientRect = () => new DOMRect(0, 0, 160, 100);
  field.getBoundingClientRect = () => new DOMRect(180, 35, 180, 30);
  const components = createJSONComponents();
  components.mount(content);
  expect(message.dataset.uiErrorPlacement).toBe('below');

  copy.getBoundingClientRect = () => new DOMRect(0, 40, 160, 20);
  resize();
  expect(message.dataset.uiErrorPlacement).toBe('icon');
  expect(message.textContent).toBe('Full warning');

  copy.getBoundingClientRect = () => new DOMRect(0, 0, 160, 100);
  field.getBoundingClientRect = () => new DOMRect(180, 0, 180, 100);
  resize();
  expect(message.dataset.uiErrorPlacement).toBe('icon');

  field.getBoundingClientRect = () => new DOMRect(180, 35, 180, 30);
  resize();
  expect(message.dataset.uiErrorPlacement).toBe('below');

  // A tall description above the control is not spare space in its label column.
  field.getBoundingClientRect = () => new DOMRect(0, 108, 180, 30);
  resize();
  expect(message.dataset.uiErrorPlacement).toBe('icon');
  expect(field.style.marginBlock).toBe('');
  components.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(content.querySelector('scwc-tooltip')).toBeNull();
});

it('keeps standalone controls compact and tolerates environments without ResizeObserver', () => {
  vi.stubGlobal('ResizeObserver', undefined);
  const content = document.createElement('div');
  content.innerHTML = `<div class="ui-field"><input><div class="ui-field-error">Warning</div></div>`;
  document.body.append(content);
  const components = createJSONComponents();
  components.mount(content);
  expect(content.querySelector<HTMLElement>('.ui-field-error')?.dataset.uiErrorPlacement).toBe(
    'icon',
  );
  components.dispose();
});
