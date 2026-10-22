import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import type { CommandEditor } from '../components/command-editor.ts';
import { WorkbenchTerminal } from '../components/terminal.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
vi.mock('../../../shared/store/config.ts', () => ({
  ConfigController: { config: { api: { host: 'http://localhost', port: '3200', token: 'test' } } },
}));
let store: WorkbenchStore;
beforeEach(() => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn() });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [] });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* No geometry in jsdom. */
      }
      disconnect() {
        /* No resources. */
      }
    },
  );
});
afterEach(() => {
  document.body.replaceChildren();
  store.lease = undefined;
  store.dispose();
  Reflect.deleteProperty(document, 'execCommand');
  Reflect.deleteProperty(Range.prototype, 'getClientRects');
  Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function fixture() {
  store = new WorkbenchStore();
  store.lease = { workspaceId: 'w', token: 'l', expiresAt: Date.now() + 30000 };
  store.terminals = ['a', 'b'].map((id) => ({
    id,
    title: id,
    draft: id === 'a' ? 'help' : 'other',
    history: [],
    revision: 1,
    archivedAt: null,
  }));
  vi.spyOn(store, 'loadOutput').mockResolvedValue();
  vi.spyOn(store, 'refreshTerminals').mockResolvedValue();
  vi.spyOn(store, 'syncExecutions').mockResolvedValue();
  const terminal = new WorkbenchTerminal();
  terminal.store = store;
  document.body.append(terminal);
  await terminal.updateComplete;
  return { terminal, root: requireValue(terminal.shadowRoot) };
}
describe('inline Web command terminal', () => {
  it('keeps the prompt in the output flow without a form toolbar, run button or placeholder', async () => {
    const { root } = await fixture();
    expect(root.querySelector('.terminal-output wb-command-editor')).not.toBeNull();
    expect(root.querySelector('.terminal-input-toolbar,.output-toolbar')).toBeNull();
    expect(root.querySelector('.btn.primary')).toBeNull();
    const editor = requireValue(root.querySelector<CommandEditor>('wb-command-editor'));
    await editor.updateComplete;
    expect(editor.shadowRoot?.querySelector('.cm-placeholder')).toBeNull();
    expect(root.querySelector('.terminal-input-status')?.textContent).toContain('NORMAL');
  });
  it('saves the departing terminal draft while retaining a newer local draft through fast switches', async () => {
    const { terminal, root } = await fixture();
    let finish!: (value: unknown) => void;
    const request = vi.spyOn(store.api, 'request').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const a = store.terminals[0];
    store.terminalView(a).draft = 'scratch';
    requireValue(root.querySelectorAll<HTMLButtonElement>('.terminal-select')[1]).click();
    await terminal.updateComplete;
    await Promise.resolve();
    expect(request.mock.calls[0][1]).toMatchObject({
      terminal: { id: 'a', draft: 'scratch', baseRevision: 1 },
    });
    requireValue(root.querySelectorAll<HTMLButtonElement>('.terminal-select')[0]).click();
    await terminal.updateComplete;
    store.terminalView(a).draft = 'newer scratch';
    finish({ ...a, draft: 'scratch', revision: 2 });
    await Promise.resolve();
    await terminal.updateComplete;
    expect(store.terminalView(a).draft).toBe('newer scratch');
    expect(store.terminalView(store.terminals[1]).draft).toBe('other');
  });
  it('submits once while a request is pending and keeps input typed during acceptance', async () => {
    const { terminal, root } = await fixture();
    let finish!: (value: unknown) => void;
    const request = vi.spyOn(store.api, 'request').mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const editor = requireValue(root.querySelector<CommandEditor>('wb-command-editor'));
    const send = () =>
      editor.dispatchEvent(
        new CustomEvent('submit-command', { detail: 'help', bubbles: true, composed: true }),
      );
    send();
    send();
    await Promise.resolve();
    await expect
      .poll(() => request.mock.calls.filter(([path]) => path === '/commands/execute').length)
      .toBe(1);
    store.terminalView(store.terminals[0]).draft = 'next';
    finish({ id: 'execution' });
    await Promise.resolve();
    await terminal.updateComplete;
    expect(store.terminalView(store.terminals[0]).draft).toBe('next');
  });
  it('scrolls output with Home/End without intercepting editor navigation', async () => {
    const { root } = await fixture();
    const output = requireValue(root.querySelector<HTMLElement>('.terminal-output'));
    Object.defineProperties(output, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 200 },
    });
    output.scrollTop = 1000;
    output.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }),
    );
    expect(output.scrollTop).toBe(0);
    expect(store.terminalView(store.terminals[0]).follow).toBe(false);
    output.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }),
    );
    expect(output.scrollTop).toBe(3000);
    expect(store.terminalView(store.terminals[0]).follow).toBe(true);
  });
});
