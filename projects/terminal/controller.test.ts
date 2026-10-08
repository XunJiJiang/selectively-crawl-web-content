import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
describe('terminal input routing', () => {
  it('renders structured core and plugin colors, including existing ANSI output', () => {
    vi.stubEnv('FORCE_COLOR', '1');
    try {
      const model = new TerminalModel();
      const controller = new TerminalController(model, new CoreConnection({ args: [] }));
      const stdout: string[] = [];
      controller.onOutput = (text) => stdout.push(text);
      controller.output({
        windowId: model.output.id,
        text: '[core] [warn] warning',
        level: 'warn',
      });
      controller.output({ windowId: model.output.id, text: 'terminal error', level: 'error' });
      controller.output({ windowId: model.output.id, text: '\x1b[35mcustom\x1b[39m' });
      const frame = controller.renderer.frame(model, 0);
      expect(frame).toContain('\x1b[33m');
      expect(frame).toContain('\x1b[31m');
      expect(frame).toContain('\x1b[35m');
      expect(stdout).toEqual(model.output.lines);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('cancels a pending next on Ctrl+C without clearing drafts or cancelling the command', async () => {
    const model = new TerminalModel();
    const window = model.windows[1];
    model.switch(window.id);
    const core = new CoreConnection({ args: [] });
    const call = vi.spyOn(core, 'call').mockResolvedValue(undefined);
    const controller = new TerminalController(model, core);
    model.execution({
      executionId: 'a',
      windowId: window.id,
      command: 'prompt',
      status: 'running',
    });
    core.emit('input.request', {
      id: 'input',
      identity: { windowId: window.id, executionId: 'a' },
      message: 'prompt?',
      type: 'string',
    });
    window.input!.draft = 'draft';
    await controller.key({ name: 'c', ctrl: true, sequence: '\x03' });
    expect(call).toHaveBeenCalledExactlyOnceWith('input.answer', {
      id: 'input',
      value: undefined,
      error: 'cancelled',
    });
    expect(window.input).toBeUndefined();
    expect(window.task).toBeDefined();
  });
  it('answers intermediate prompts with literal text or empty input without recording commands', async () => {
    const model = new TerminalModel();
    const window = model.windows[1];
    model.switch(window.id);
    window.draft = 'saved command';
    const core = new CoreConnection({ args: [] });
    const call = vi.spyOn(core, 'call').mockResolvedValue(undefined);
    const controller = new TerminalController(model, core);
    core.emit('input.request', {
      id: 'first',
      identity: { windowId: window.id, executionId: 'execution' },
      message: '请输入',
      type: 'string',
    });
    await controller.line(':literal text');
    expect(call).toHaveBeenCalledWith('input.answer', {
      id: 'first',
      value: ':literal text',
      error: undefined,
    });
    core.emit('input.request', {
      id: 'second',
      identity: { windowId: window.id, executionId: 'execution' },
      message: '请输入',
      type: 'string',
    });
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(call).toHaveBeenLastCalledWith('input.answer', {
      id: 'second',
      value: '',
      error: undefined,
    });
    expect(window.history).toEqual([]);
    expect(window.draft).toBe('saved command');
  });
  it('keeps input drafts in their originating windows and clears prompts on disconnect', async () => {
    const model = new TerminalModel();
    const first = model.windows[1];
    const second = model.newWindow();
    const core = new CoreConnection({ args: [] });
    vi.spyOn(core, 'call').mockResolvedValue(undefined);
    const controller = new TerminalController(model, core);
    for (const [id, window] of [
      ['a', first],
      ['b', second],
    ] as const) {
      model.execution({
        windowId: window.id,
        executionId: id,
        command: 'prompt',
        status: 'running',
      });
      core.emit('command.started', window.task);
      core.emit('input.request', {
        id,
        identity: { windowId: window.id, executionId: id },
        message: id,
        type: 'string',
      });
    }
    await controller.key({ name: 'text', sequence: 'B' });
    await controller.key({ name: 'tab', sequence: '\t', shift: true });
    await controller.key({ name: 'text', sequence: 'A' });
    expect(first.input?.draft).toBe('A');
    expect(second.input?.draft).toBe('B');
    core.emit('closed');
    expect(first.input).toBeUndefined();
    expect(second.input).toBeUndefined();
    await controller.dispose();
  });
  it('keeps global colon literals and restores the global draft after Escape', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    await controller.key({ name: 'text', sequence: ':' });
    for (const character of 'run 1 fetch https://x') {
      await controller.key({ name: 'text', sequence: character });
    }
    expect(model.globalDraft).toBe('run 1 fetch https://x');
    await controller.key({ name: 'escape', sequence: '\x1b' });
    await controller.key({ name: 'text', sequence: ':' });
    expect(model.globalDraft).toBe('run 1 fetch https://x');
    expect(model.mode).toBe('global');
  });
  it('ignores mouse motion during confirmation and cancels only from keyboard input', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    const accept = vi.fn();
    const decline = vi.fn();
    model.ask('confirm?', accept, decline);
    await controller.key({
      name: 'mouse',
      sequence: '',
      mouse: { button: 32, column: 3, row: 0, release: false },
    });
    expect(model.confirmation).toBeDefined();
    await controller.key({ name: 'text', sequence: 'x' });
    expect(decline).toHaveBeenCalledOnce();
    expect(accept).not.toHaveBeenCalled();
  });
  it('allows editing a new window without changing the original command draft', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    const original = model.windows[1];
    model.switch(original.id);
    model.mode = 'command';
    model.setInput('original', 8);
    await controller.global('new');
    await controller.key({ name: 'text', sequence: 'i' });
    expect(model.active.draft).toBe('i');
    expect(original.draft).toBe('original');
    await controller.global('s 1');
    expect(model.active.draft).toBe('original');
  });
});
