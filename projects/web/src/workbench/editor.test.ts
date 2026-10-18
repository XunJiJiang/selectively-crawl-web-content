import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { CommandEditor } from '../components/command-editor.ts';
import type { WorkbenchStore } from './store.ts';
import type { Terminal, TerminalViewState } from './types.ts';
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});
describe('command editor keyboard precedence', () => {
  it('submits Enter before CodeMirror defaults, preserves Shift+Enter and IME', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* No browser geometry in this keyboard fixture. */
        }
        disconnect() {
          /* No allocated observer. */
        }
      },
    );
    const editor = new CommandEditor();
    editor.store = mockStore();
    editor.terminal = {
      id: 't',
      title: 'T',
      draft: '',
      history: [],
      revision: 0,
      archivedAt: null,
    };
    editor.value = 'help';
    document.body.append(editor);
    await editor.updateComplete;
    const input = editor.shadowRoot?.querySelector<HTMLElement>('.cm-content');
    if (!input) {
      throw new Error('missing editor');
    }
    const submit = vi.fn();
    editor.addEventListener('submit-command', submit);
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0][0].detail).toBe('help');
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });
});

function mockStore() {
  const views = new Map<string, TerminalViewState>();
  return {
    preferences: { values: { keybindings: [] } },
    terminalView(t: Terminal) {
      let view = views.get(t.id);
      if (!view) {
        view = {
          draft: t.draft,
          historyCursor: -1,
          historyDraft: '',
          historyLocked: false,
          selectionAnchor: t.draft.length,
          selectionHead: t.draft.length,
          follow: true,
          scrollTop: 0,
        };
        views.set(t.id, view);
      }
      return view;
    },
    session: () => ({ workspaceId: 'w', lease: 'lease' }),
    api: { request: vi.fn() },
    toast: vi.fn(),
    message: String,
  } as unknown as WorkbenchStore;
}
async function fixture(value = '', entries: string[] = []) {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn() });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* No layout in jsdom. */
      }
      disconnect() {
        /* No observer resources. */
      }
    },
  );
  const editor = new CommandEditor();
  editor.store = mockStore();
  editor.terminal = {
    id: 'a',
    title: 'A',
    draft: value,
    history: entries,
    revision: 1,
    archivedAt: null,
  };
  editor.value = value;
  document.body.append(editor);
  await editor.updateComplete;
  const input = requireValue(editor.shadowRoot?.querySelector<HTMLElement>('.cm-content'));
  const key = (key: string, extra: KeyboardEventInit = {}) =>
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }),
    );
  return { editor, key };
}
it('restores the history cursor and scratch draft independently when switching terminals', async () => {
  const { editor, key } = await fixture('scratch', ['first', 'second']);
  key('ArrowUp');
  expect(editor.value).toBe('second');
  const a = editor.terminal;
  editor.terminal = { ...a, id: 'b', draft: 'other' };
  editor.value = 'other';
  await editor.updateComplete;
  editor.terminal = { ...a, revision: 2 };
  editor.value = editor.store.terminalView(a).draft;
  await editor.updateComplete;
  key('ArrowUp');
  expect(editor.value).toBe('first');
  key('ArrowDown');
  key('ArrowDown');
  expect(editor.value).toBe('scratch');
  key('Escape');
  expect(editor.value).toBe('');
});
it('opens all candidates on double Tab, navigates and accepts without submitting', async () => {
  const { editor, key } = await fixture('he');
  const request = vi.mocked(editor.store.api.request);
  request.mockResolvedValueOnce({
    command: 'he',
    from: 0,
    to: 2,
    items: [{ name: 'help', insertText: 'help', description: '帮助' }],
  });
  request.mockResolvedValueOnce({
    command: '',
    from: 0,
    to: 0,
    items: [
      { name: 'help', insertText: 'help' },
      { name: 'status', insertText: 'status', description: '状态' },
    ],
  });
  const submit = vi.fn();
  editor.addEventListener('submit-command', submit);
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  expect(editor.shadowRoot?.querySelector('[role="option"]')?.textContent).toContain('帮助');
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  expect(request.mock.calls[1][1]).toMatchObject({ command: '', cursor: 0 });
  key('ArrowDown');
  key('Enter');
  expect(editor.value).toBe('status');
  expect(submit).not.toHaveBeenCalled();
  key('Enter');
  expect(submit).toHaveBeenCalledTimes(1);
});
it('ignores a completion response from the previous terminal and preserves Ctrl+C copying', async () => {
  const { editor, key } = await fixture('help');
  let finish!: (value: unknown) => void;
  vi.mocked(editor.store.api.request).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }) as never,
  );
  key('Tab');
  editor.terminal = { ...editor.terminal, id: 'b' };
  editor.value = 'new';
  await editor.updateComplete;
  finish({ from: 0, to: 4, items: [{ name: 'old', insertText: 'old' }] });
  await Promise.resolve();
  await editor.updateComplete;
  expect(editor.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();
  const cancel = vi.fn();
  editor.addEventListener('cancel-command', cancel);
  editor.busy = true;
  await editor.updateComplete;
  key('c', { ctrlKey: true });
  expect(cancel).toHaveBeenCalledTimes(1);
  editor.busy = false;
  await editor.updateComplete;
  key('c', { ctrlKey: true });
  expect(editor.value).toBe('');
});
it('filters provider candidates and preserves the argument key on double Tab', async () => {
  const { editor, key } = await fixture('crawl run --format=j');
  const request = vi.mocked(editor.store.api.request);
  const items = [
    { name: 'json', insertText: 'json' },
    { name: 'html', insertText: 'html' },
  ];
  request.mockResolvedValueOnce({ command: 'crawl run --format=j', from: 19, to: 20, items });
  request.mockResolvedValueOnce({ command: 'crawl run --format=', from: 19, to: 19, items });
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  expect(editor.shadowRoot?.querySelectorAll('[role="option"]')).toHaveLength(1);
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  expect(request.mock.calls[1][1]).toMatchObject({ command: 'crawl run --format=', cursor: 19 });
  key('ArrowDown');
  key('Enter');
  expect(editor.value).toBe('crawl run --format=html');
});
