import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandEditor } from '../components/command-editor.ts';
import type { WorkbenchStore } from './store.ts';
afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
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
    editor.store = { preferences: { values: { keybindings: [] } } } as unknown as WorkbenchStore;
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
