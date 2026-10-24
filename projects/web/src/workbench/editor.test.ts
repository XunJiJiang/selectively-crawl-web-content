import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { CommandEditor, hasOpenQuote } from '../components/command-editor.ts';
import type { WorkbenchStore } from './store.ts';
import type { Terminal, TerminalViewState } from './types.ts';
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, 'execCommand');
});
describe('command editor keyboard precedence', () => {
  it('submits Enter from the independent input, preserves Shift+Enter and IME', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {
          /* No browser geometry in this keyboard fixture. */
        }
        unobserve() {
          /* Geometry is supplied by the fixture. */
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
    const input = editor.shadowRoot?.querySelector<HTMLElement>('textarea');
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
      unobserve() {
        /* Geometry is supplied by the fixture. */
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
  const input = requireValue(editor.shadowRoot?.querySelector<HTMLElement>('textarea'));
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
it('cycles prefix matches on repeated Tab without requesting all commands', async () => {
  const { editor, key } = await fixture('he');
  const request = vi.mocked(editor.store.api.request);
  request.mockResolvedValueOnce({
    command: 'he',
    from: 0,
    to: 2,
    items: [
      { name: 'help', insertText: 'help' },
      { name: 'hello', insertText: 'hello' },
      { name: 'status', insertText: 'status' },
    ],
  });
  const submit = vi.fn();
  editor.addEventListener('submit-command', submit);
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  key('Tab');
  await editor.updateComplete;
  expect(request).toHaveBeenCalledTimes(1);
  key('Enter');
  expect(editor.value).toBe('hello');
  expect(submit).not.toHaveBeenCalled();
  key('Enter');
  expect(submit).toHaveBeenCalledTimes(1);
});
it.each(['plugin li', 'plugin list de', 'plugin list detail ch'])(
  'filters terminal candidates at every level: %s',
  async (command) => {
    const { editor, key } = await fixture(command);
    const from = command.lastIndexOf(' ') + 1;
    const word = command.slice(from);
    vi.mocked(editor.store.api.request).mockResolvedValueOnce({
      command,
      from,
      to: command.length,
      items: [
        { name: word + 'tail', insertText: word + 'tail' },
        { name: 'other', insertText: 'other' },
      ],
    });
    key('Tab');
    await Promise.resolve();
    await editor.updateComplete;
    expect(editor.shadowRoot?.textContent).not.toContain('没有匹配的命令候选');
    key('Enter');
    expect(editor.value).toBe(command + 'tail');
  },
);
it('continues a trailing backslash with Enter and ignores Command+Enter', async () => {
  const { editor, key } = await fixture('help' + String.fromCharCode(92));
  const submit = vi.fn();
  editor.addEventListener('submit-command', submit);
  key('Enter');
  expect(editor.value).toBe('help' + String.fromCharCode(92) + '\n');
  expect(submit).not.toHaveBeenCalled();
  key('Enter', { metaKey: true });
  expect(editor.value).toBe('help' + String.fromCharCode(92) + '\n');
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
it('preserves prefix filtering and the argument key on repeated Tab', async () => {
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
  expect(request).toHaveBeenCalledTimes(1);
  key('ArrowDown');
  key('Enter');
  expect(editor.value).toBe('crawl run --format=json');
});

it.each(["'", '"', '`'])(
  'continues an unclosed %s quote and submits after closing it',
  async (quote) => {
    const { editor, key } = await fixture('echo ' + quote + '中文');
    const submit = vi.fn();
    editor.addEventListener('submit-command', submit);
    key('Enter');
    expect(editor.value).toBe('echo ' + quote + '中文\n');
    expect(submit).not.toHaveBeenCalled();
    editor.value += quote;
    await editor.updateComplete;
    key('End');
    key('Enter');
    expect(submit).toHaveBeenCalledTimes(1);
  },
);
it('distinguishes escaped quotes and apostrophes inside other quote types', () => {
  expect(hasOpenQuote('echo "it' + "'" + 's fine"')).toBe(false);
  expect(hasOpenQuote('echo ' + String.fromCharCode(92) + '"')).toBe(false);
  expect(hasOpenQuote('echo "a' + String.fromCharCode(92) + '"b')).toBe(true);
});
it('moves and selects whole graphemes, and renders a wide cursor character', async () => {
  const { editor, key } = await fixture('a中文👨‍👩‍👧‍👦');
  const input = requireValue(editor.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea'));
  key('ArrowLeft');
  expect(input.selectionStart).toBe(3);
  key('ArrowLeft');
  expect(input.selectionStart).toBe(2);
  await editor.updateComplete;
  expect(editor.shadowRoot?.querySelector('.cursor')?.textContent).toBe('文');
  key('ArrowLeft', { shiftKey: true });
  expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('中');
  key('Home', { shiftKey: true });
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(2);
});
it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }])(
  'supports word movement, selection, deletion and undo with %j',
  async (modifier) => {
    const { editor, key } = await fixture('one two three');
    const input = requireValue(editor.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea'));
    key('ArrowLeft', modifier);
    expect(input.selectionStart).toBe(8);
    key('ArrowLeft', { ...modifier, shiftKey: true });
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('two ');
    key('Backspace', modifier);
    expect(editor.value).toBe('one three');
    key('z', { ctrlKey: true });
    expect(editor.value).toBe('one two three');
    key('z', { ctrlKey: true, shiftKey: true });
    expect(editor.value).toBe('one three');
    key('Delete', modifier);
    expect(editor.value).toBe('one ');
  },
);
it('cycles backward through suggestions with Shift+Tab and cancels them with Escape', async () => {
  const { editor, key } = await fixture('h');
  vi.mocked(editor.store.api.request).mockResolvedValueOnce({
    from: 0,
    to: 1,
    items: [
      { name: 'help', insertText: 'help' },
      { name: 'hello', insertText: 'hello' },
    ],
  });
  key('Tab');
  await Promise.resolve();
  await editor.updateComplete;
  key('Tab', { shiftKey: true });
  key('Enter');
  expect(editor.value).toBe('hello');
  key('Tab');
  await Promise.resolve();
  key('Escape');
  await editor.updateComplete;
  expect(editor.shadowRoot?.querySelector('[role="listbox"]')).toBeNull();
});
it('keeps undo history isolated between terminals and records native paste/input edits', async () => {
  const { editor, key } = await fixture('a');
  const input = requireValue(editor.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea'));
  input.value = 'a paste';
  input.setSelectionRange(7, 7);
  input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste' }));
  expect(editor.value).toBe('a paste');
  const original = editor.terminal;
  editor.terminal = { ...original, id: 'b' };
  editor.value = 'b';
  await editor.updateComplete;
  key('z', { ctrlKey: true });
  expect(editor.value).toBe('b');
  editor.terminal = original;
  editor.value = 'a paste';
  await editor.updateComplete;
  key('z', { ctrlKey: true });
  expect(editor.value).toBe('a');
});
it('leaves vertical movement in multiline input to the native editor instead of history', async () => {
  const { editor, key } = await fixture('one\ntwo', ['old']);
  expect(key('ArrowUp')).toBe(true);
  expect(editor.value).toBe('one\ntwo');
});
