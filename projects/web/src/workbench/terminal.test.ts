import type { WorkbenchScrollContainer } from '../components/scroll-container.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchStore } from './store.ts';
import type { CommandEditor } from '../components/command-editor.ts';
import { WorkbenchTerminal } from '../components/terminal.ts';
import { requireValue } from '../../../shared/workbench-protocol.ts';
import { ApiError } from '../api/workbench.ts';
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
      unobserve() {
        /* Geometry is supplied by the fixture. */
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
  it('hides ordinary input for running and returned tasks, but allows requested input and restores it on completion', async () => {
    const { terminal, root } = await fixture();
    const execution = {
      id: 'running',
      terminalId: 'a',
      status: 'running',
      coreBootId: 'boot',
      command: 'long',
    };
    store.executions = [execution] as typeof store.executions;
    store.changed();
    await terminal.updateComplete;
    const area = requireValue(root.querySelector<HTMLElement>('.terminal-input-area'));
    expect(area.hidden).toBe(true);
    execution.status = 'returned';
    store.changed();
    await terminal.updateComplete;
    expect(area.hidden).toBe(true);
    store.inputs = [
      { id: 'input', identity: { windowId: 'a', executionId: 'running' }, message: 'Answer' },
    ] as typeof store.inputs;
    store.changed();
    await terminal.updateComplete;
    expect(area.hidden).toBe(false);
    store.executions = [];
    store.inputs = [];
    store.changed();
    await terminal.updateComplete;
    expect(area.hidden).toBe(false);
  });
  it('reports unknown commands in the local status, retains the draft, and keeps unrelated errors visible', async () => {
    const { terminal, root } = await fixture();
    const toast = vi.spyOn(store, 'toast');
    const request = vi
      .spyOn(store.api, 'request')
      .mockRejectedValue(new ApiError('unknown_command', '未知命令: help', 400));
    const editor = requireValue(root.querySelector<CommandEditor>('wb-command-editor'));
    const send = () =>
      editor.dispatchEvent(
        new CustomEvent('submit-command', { detail: 'help', bubbles: true, composed: true }),
      );
    send();
    await expect
      .poll(() => root.querySelector('.terminal-input-status')?.textContent)
      .toContain('未知命令');
    expect(toast).not.toHaveBeenCalled();
    expect(store.terminalView(store.terminals[0]).draft).toBe('help');
    expect(root.querySelector<HTMLElement>('.terminal-input-area')?.hidden).toBe(false);
    editor.dispatchEvent(
      new CustomEvent('draft-change', { detail: 'help', bubbles: true, composed: true }),
    );
    await terminal.updateComplete;
    expect(root.querySelector('.terminal-input-status')?.textContent).not.toContain('未知命令');
    request.mockRejectedValue(new ApiError('internal_error', '工作台服务错误', 500));
    send();
    await expect.poll(() => toast.mock.calls.length).toBe(1);
  });
  it('grows multiline input and reveals its caret through the shared terminal viewport', async () => {
    const { root } = await fixture();
    const container = requireValue(
      root.querySelector<WorkbenchScrollContainer>('.terminal-output'),
    );
    const editor = requireValue(root.querySelector<CommandEditor>('wb-command-editor'));
    await container.updateComplete;
    await editor.updateComplete;
    const output = requireValue(container.scrollElement);
    const input = requireValue(editor.shadowRoot?.querySelector<HTMLTextAreaElement>('textarea'));
    Object.defineProperties(input, { scrollHeight: { value: 3000 }, clientWidth: { value: 400 } });
    editor.value = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n');
    await editor.updateComplete;
    expect(input.style.height).toBe('3000px');
    expect(input.scrollTop).toBe(0);
    await new Promise(requestAnimationFrame);
    Object.defineProperties(requireValue(container.shadowRoot?.querySelector('.frame')), {
      clientHeight: { value: 200 },
      clientWidth: { value: 400 },
    });
    Object.defineProperty(
      requireValue(container.shadowRoot?.querySelector('.content')),
      'scrollHeight',
      { value: 3000 },
    );
    Object.defineProperties(output, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 200 },
    });
    container.refresh();
    store.terminalView(store.terminals[0]).follow = false;
    output.scrollTop = 500;
    vi.spyOn(output, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 400, 200));
    const caret = requireValue(editor.shadowRoot?.querySelector<HTMLElement>('.cursor'));
    vi.spyOn(caret, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 10, 20));
    editor.dispatchEvent(
      new CustomEvent('reveal-command-caret', { detail: caret, bubbles: true, composed: true }),
    );
    await new Promise(requestAnimationFrame);
    expect(output.scrollTop).toBe(450);
    expect(input.scrollTop).toBe(0);
  });
  it('routes Ctrl+C from the output pane to cancellation while a command is running', async () => {
    const { terminal, root } = await fixture();
    store.executions = [
      { id: 'running', terminalId: 'a', status: 'running', coreBootId: 'boot', command: 'long' },
    ] as typeof store.executions;
    store.changed();
    await terminal.updateComplete;
    const request = vi.spyOn(store.api, 'request').mockResolvedValue({ needsForce: false });
    const event = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    requireValue(root.querySelector('.terminal-output')).dispatchEvent(event);
    await Promise.resolve();
    expect(event.defaultPrevented).toBe(true);
    expect(request).toHaveBeenCalledWith(
      '/commands/cancel',
      expect.objectContaining({ executionId: 'running' }),
    );
  });
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
    const container = requireValue(
      root.querySelector<WorkbenchScrollContainer>('.terminal-output'),
    );
    await container.updateComplete;
    const output = requireValue(container.scrollElement);
    Object.defineProperties(output, {
      scrollHeight: { value: 3000 },
      clientHeight: { value: 200 },
    });
    output.scrollTop = 1000;
    output.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Home',
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    expect(output.scrollTop).toBe(0);
    expect(store.terminalView(store.terminals[0]).follow).toBe(false);
    output.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true, composed: true, cancelable: true }),
    );
    expect(output.scrollTop).toBe(3000);
    expect(store.terminalView(store.terminals[0]).follow).toBe(true);
  });
});

it('preserves input focus before a click elsewhere in terminal output', async () => {
  const { root } = await fixture();
  const editor = requireValue(root.querySelector<CommandEditor>('wb-command-editor'));
  await editor.updateComplete;
  editor.focus();
  const input = requireValue(editor.shadowRoot?.querySelector('textarea'));
  const blur = vi.fn();
  input.addEventListener('blur', blur);
  const output = requireValue(root.querySelector('.terminal-output'));
  expect(
    output.dispatchEvent(
      new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }),
    ),
  ).toBe(false);
  expect(editor.shadowRoot?.activeElement).toBe(input);
  expect(blur).not.toHaveBeenCalled();
});
