import { afterEach, expect, it, vi } from 'vitest';
import { ScriptUIView } from './script-ui.ts';
import type { ScriptUIModel } from '../script-ui.ts';

afterEach(() => document.body.replaceChildren());
it('restores saved fields, persists edits and sends v2 events using the current field snapshot', async () => {
  const view = new ScriptUIView();
  view.model = {
    instanceId: 'instance',
    compiled: {
      format: 'json',
      nodes: [
        { id: 'field', tag: 'input', attrs: { name: 'q', value: 'default' } },
        { id: 'button', tag: 'button', children: [{ id: 'text', text: 'Save' }] },
      ],
      fields: [{ name: 'q', nodeId: 'field', kind: 'string' }],
      events: [
        {
          id: 'save',
          nodeId: 'button',
          event: 'click',
          capture: ['q'],
          for: ['q'],
          program: { branches: [] },
        },
      ],
      expressions: [],
      styles: [],
    },
    updates: [],
  } satisfies ScriptUIModel;
  view.values = { q: 'saved' };
  const save = vi.fn(),
    invoke = vi.fn(async () => ({ updates: [] }));
  view.saveValues = save;
  view.invoke = invoke;
  document.body.append(view);
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('#error')?.textContent).toBe('');
  const input = view.shadowRoot?.querySelector('input');
  if (!input) {
    throw new Error('JSON 输入未渲染');
  }
  expect(input.value).toBe('saved');
  input.value = 'edited';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(save).toHaveBeenLastCalledWith({ q: 'edited' });
  view.values = { q: 'stale remote value' };
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('input')?.value).toBe('edited');
  view.shadowRoot?.querySelector('button')?.click();
  expect(invoke).toHaveBeenCalledWith(
    expect.objectContaining({
      version: 'v2',
      instanceId: 'instance',
      bindingId: 'save',
      fields: { q: { value: 'edited', editSequence: 1 } },
    }),
  );
  view.model = { ...view.model, instanceId: 'refreshed' };
  view.values = { q: 'edited' };
  await view.updateComplete;
  expect(view.shadowRoot?.querySelector('input')?.value).toBe('edited');
});
