import { afterEach, expect, it, vi } from 'vitest';
import { ScriptUIView } from './script-ui.ts';
import type { ScriptUIModel } from '../script-ui.ts';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});
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

function model(instanceId = 'initial'): ScriptUIModel {
  return {
    instanceId,
    compiled: {
      format: 'json',
      styles: [],
      expressions: [{ id: 'value', nodeId: 'q', attribute: 'value', parts: [] }],
      fields: [{ name: 'q', nodeId: 'q', kind: 'string' }],
      events: [
        {
          id: 'submit',
          nodeId: 'save',
          event: 'click',
          capture: ['q'],
          for: ['q'],
          program: { branches: [] },
        },
      ],
      nodes: [
        {
          id: 'root',
          tag: 'div',
          attrs: { 'data-layout': 'column' },
          children: [
            { id: 'q', tag: 'input', attrs: { name: 'q', value: 'initial' } },
            { id: 'save', tag: 'button', children: [{ id: 'caption', text: 'Save' }] },
          ],
        },
      ],
    },
    updates: [],
  };
}
it('keeps a focused draft and selection during template replacement and ignores late results', async () => {
  const view = new ScriptUIView();
  view.identity = 'p';
  view.model = model();
  view.values = {};
  let finish!: (result: { updates: { id: string; value: string }[] }) => void;
  view.invoke = vi.fn(
    () =>
      new Promise<{ updates: { id: string; value: string }[] }>((resolve) => {
        finish = resolve;
      }),
  );
  document.body.append(view);
  await view.updateComplete;
  const input = view.shadowRoot!.querySelector('input')!;
  input.focus();
  input.value = 'unsaved draft';
  input.setSelectionRange(2, 7);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  view.shadowRoot!.querySelector('button')!.click();
  view.model = { ...model('next'), updates: [{ id: 'value', value: 'remote' }] };
  await view.updateComplete;
  const next = view.shadowRoot!.querySelector('input')!;
  expect(next.value).toBe('unsaved draft');
  expect(view.shadowRoot!.activeElement).toBe(next);
  expect([next.selectionStart, next.selectionEnd]).toEqual([2, 7]);
  finish({ updates: [{ id: 'value', value: 'late' }] });
  await Promise.resolve();
  expect(next.value).toBe('unsaved draft');
});
it('recovers stale reads once, clears recovered errors and never replays a failed submission', async () => {
  vi.useFakeTimers();
  const view = new ScriptUIView();
  view.identity = 'p';
  view.model = { ...model(), boundFields: ['q'] };
  const stale = Object.assign(new Error('stale'), { code: 'UI_STALE_INSTANCE' });
  const invoke = vi.fn().mockRejectedValueOnce(stale).mockResolvedValue({ updates: [] });
  const refresh = vi.fn(async () => ({ ...model('recovered'), boundFields: ['q'] }));
  view.invoke = invoke;
  view.refreshModel = refresh;
  document.body.append(view);
  await view.updateComplete;
  await view.readValues();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(2);
  expect(view.shadowRoot!.querySelector('#error')!.textContent).toBe('');
  invoke.mockRejectedValue(stale);
  view.shadowRoot!.querySelector('button')!.click();
  await Promise.resolve();
  await Promise.resolve();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledTimes(3);
  await view.readValues();
  expect(refresh).toHaveBeenCalledTimes(2);
  const count = invoke.mock.calls.length;
  await vi.advanceTimersByTimeAsync(20000);
  expect(invoke).toHaveBeenCalledTimes(count);
});
