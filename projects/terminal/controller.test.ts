import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
import { restoreState } from './storage.ts';
import { InputDecoder } from './input.ts';
describe('terminal input routing', () => {
  it.each([0.5, 1.5, 2])(
    'scales reported wheel distance by speed %s without losing fractional rows',
    async (speed) => {
      const model = new TerminalModel();
      model.append({
        windowId: model.output.id,
        text: Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n'),
      });
      const controller = new TerminalController(model, new CoreConnection({ args: [] }));
      controller.scrollSpeed = speed;
      controller.renderer.height = 8;
      controller.renderer.frame(model, 0);
      const work: Promise<void>[] = [];
      const decoder = new InputDecoder((key) => work.push(controller.key(key)));
      const packets = '\x1b[<64;3;3M'.repeat(4);
      decoder.feed(packets.slice(0, 8));
      decoder.feed(packets.slice(8));
      await Promise.all(work);
      expect(model.output.scroll).toBe(4 * speed);
      decoder.feed('\x1b[<65;3;3M'.repeat(4));
      await Promise.all(work);
      expect(model.output.scroll).toBe(0);
      expect(model.output.anchor).toBeUndefined();
      decoder.dispose();
      await controller.dispose();
    },
  );
  it('does not transfer fractional wheel distance from the body to the panel', async () => {
    const model = new TerminalModel();
    model.append({
      windowId: model.output.id,
      text: Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n'),
    });
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    controller.scrollSpeed = 0.5;
    controller.renderer.frame(model, 0);
    const wheel = (row: number) =>
      controller.key({
        name: 'mouse',
        sequence: '',
        mouse: { row, column: 2, button: 64, release: false },
      });
    await wheel(2);
    expect(model.output.scroll).toBe(0);
    const panel = model.beginPanel('help');
    model.writePanel(Array.from({ length: 30 }, (_, i) => `help ${i}`).join('\n'));
    model.finishPanel(panel);
    controller.renderer.frame(model, 0);
    await wheel(20);
    expect(panel.scroll).toBe(0);
    await wheel(20);
    expect(panel.scroll).toBe(1);
    expect(model.output.scroll).toBe(0);
    await controller.dispose();
  });
  it('scrolls output one row per wheel event and accumulates bursts before repainting', async () => {
    const model = new TerminalModel();
    model.append({
      windowId: model.output.id,
      text: Array.from({ length: 40 }, (_, i) => `row ${i}`).join('\n'),
    });
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    controller.scrollSpeed = 1;
    controller.renderer.height = 8;
    controller.renderer.frame(model, 0);
    const wheel = (button: number) =>
      controller.key({
        name: 'mouse',
        sequence: '',
        mouse: { row: 2, column: 2, button, release: false },
      });
    await wheel(64);
    expect(model.output.scroll).toBe(1);
    await wheel(64);
    expect(model.output.scroll).toBe(2);
    await wheel(65);
    expect(model.output.scroll).toBe(1);
    expect(controller.renderer.frame(model, 0)).toContain('row 33');
    for (let i = 0; i < 40; i++) {
      await wheel(64);
    }
    expect(model.output.anchor?.line).toBe(0);
    await wheel(65);
    expect(model.output.anchor?.line).toBe(1);
    for (let i = 0; i < 40; i++) {
      await wheel(65);
    }
    expect(model.output.scroll).toBe(0);
    expect(model.output.anchor).toBeUndefined();
    await controller.dispose();
  });
  it('removes the restored-history marker when clearing output so it cannot reappear', async () => {
    const original = new TerminalModel();
    original.append({ windowId: original.windows[1].id, text: 'old one\nold two' });
    const model = restoreState({ version: 1, windows: original.windows });
    model.switch(model.windows[1].id);
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    await controller.global('clear output');
    expect(model.active.restoredHistoryEnd).toBeUndefined();
    model.append({ windowId: model.activeId, text: 'new one\nnew two\nnew three' });
    expect(controller.renderer.frame(model, 0)).not.toContain('还原的历史记录');
    await controller.dispose();
  });
  it('requests nested completions while editing, rejects stale responses, and replaces only the selected token', async () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    const core = new CoreConnection({ args: [] });
    const controller = new TerminalController(model, core);
    const first = Promise.withResolvers<unknown>();
    const call = vi.spyOn(core, 'call').mockImplementation(async (_method, value) => {
      const request = value as { command: string; cursor: number };
      if (request.command === 'asmr l') {
        return (await first.promise) as never;
      }
      return {
        from: 5,
        to: 7,
        items: [{ name: 'list', insertText: 'list', description: '作品列表' }],
      } as never;
    });
    core.emit('ready', { port: 3200, commands: [{ name: 'asmr' }] });
    await controller.key({ name: 'text', sequence: 'asmr l' });
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith('command.complete', { command: 'asmr l', cursor: 6 }),
    );
    await controller.key({ name: 'text', sequence: 'i' });
    await vi.waitFor(() => expect(model.candidates[0]?.description).toBe('作品列表'));
    first.resolve({ from: 5, to: 6, items: [{ name: 'late', insertText: 'late' }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(model.candidates[0]?.name).toBe('list');
    model.setInput('asmr li argument', 7);
    await controller.key({ name: 'tab', sequence: '\t' });
    expect(model.displayText).toBe('asmr list argument');
    expect(model.displayCursor).toBe(9);
    model.commitGlobalCompletion();
    expect(model.text).toBe('asmr list argument');
    expect(model.cursor).toBe(9);
    await controller.dispose();
  });
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
    expect(window.input).toBeDefined();
    if (window.input) {
      window.input.draft = 'draft';
    }
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
    model.switch(first.id);
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
  it('keeps confirmations until an explicit valid answer and Enter', async () => {
    const model = new TerminalModel();
    const core = new CoreConnection({ args: [] });
    const call = vi.spyOn(core, 'call').mockResolvedValue(undefined);
    const controller = new TerminalController(model, core);
    core.emit('confirmation.request', { id: 'config', text: 'confirm?' });
    await controller.key({
      name: 'mouse',
      sequence: '',
      mouse: { button: 32, column: 3, row: 0, release: false },
    });
    expect(model.confirmation).toBeDefined();
    await controller.key({ name: 'text', sequence: 'x' });
    expect(call).not.toHaveBeenCalled();
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.confirmation?.text).toContain('请输入 :y 或 :n');
    expect(call).not.toHaveBeenCalled();
    await controller.line(':n');
    expect(call).toHaveBeenCalledExactlyOnceWith('confirmation.answer', {
      id: 'config',
      answer: false,
    });
    expect(model.panel).toBeUndefined();
    expect(model.mode).toBe('normal');
  });
  it('allows editing a new window without changing the original command draft', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    const original = model.windows[1];
    model.switch(original.id);
    model.mode = 'normal';
    model.setInput('original', 8);
    await controller.global('new');
    await controller.key({ name: 'text', sequence: 'i' });
    expect(model.mode).toBe('normal');
    expect(model.active.draft).toBe('i');
    expect(original.draft).toBe('original');
    await controller.global('s 1');
    expect(model.active.draft).toBe('original');
  });
  it('leaves global input after a command with no output and requires a new colon', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    for (const sequence of ':new') {
      await controller.key({ name: 'text', sequence });
    }
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.windows).toHaveLength(3);
    expect(model.mode).toBe('normal');
    expect(model.globalDraft).toBe('');
    expect(model.active.draft).toBe('');
    expect(model.windows).toHaveLength(3);
    await controller.key({ name: 'text', sequence: ':' });
    expect(model.mode).toBe('global');
  });
  it('cycles completion previews without narrowing candidates and commits on Space or Enter', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    for (const sequence of ':r') {
      await controller.key({ name: 'text', sequence });
    }
    expect(model.globalCandidates.map((item) => item.name)).toEqual(['rename', 'restart', 'run']);
    await controller.key({ name: 'tab', sequence: '\t' });
    expect(model.displayText).toBe('rename');
    expect(model.globalDraft).toBe('r');
    await controller.key({ name: 'tab', sequence: '\t' });
    expect(model.displayText).toBe('restart');
    expect(model.globalCandidates).toHaveLength(3);
    await controller.key({ name: 'tab', sequence: '\x1b[Z', shift: true });
    expect(model.displayText).toBe('rename');
    await controller.key({ name: 'text', sequence: ' ' });
    expect(model.globalDraft).toBe('rename ');
    expect(model.globalCandidates).toEqual([]);
    expect(controller.renderer.frame(model)).toContain('rename [new title] <tab id>');
    for (const sequence of 'new-title 1') {
      await controller.key({ name: 'text', sequence });
    }
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.title(model.windows[1])).toBe('new-title');
    for (const sequence of ':h') {
      await controller.key({ name: 'text', sequence });
    }
    await controller.key({ name: 'tab', sequence: '\t' });
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.panel?.command).toBe('help');
  });
  it('keeps help only in the transient panel and scrolls it until Escape', async () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    controller.commands = Array.from({ length: 30 }, (_, i) => ({
      name: `plugin${i}`,
      description: 'desc',
    }));
    await controller.global('help');
    expect(model.mode).toBe('global-output');
    expect(model.panel?.running).toBe(false);
    expect(model.windows.every((window) => !window.lines.length && !window.history.length)).toBe(
      true,
    );
    controller.renderer.frame(model);
    await controller.key({ name: 'up', sequence: '\x1b[A' });
    expect(model.panel?.scroll).toBe(1);
    expect(model.active.scroll).toBe(0);
    await controller.key({
      name: 'mouse',
      sequence: '',
      mouse: { row: 20, column: 2, button: 64, release: false },
    });
    expect(model.panel?.scroll).toBe(3);
    await controller.key({ name: 'text', sequence: 'new' });
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.windows).toHaveLength(2);
    await controller.key({ name: 'escape', sequence: '\x1b' });
    expect(model.panel).toBeUndefined();
    expect(model.mode).toBe('normal');
    await controller.global('help');
    expect(model.panel?.lines.filter((line) => line.startsWith('全局命令'))).toHaveLength(1);
  });
  it('renames only command tabs, including inactive tabs and running tasks', async () => {
    const model = new TerminalModel();
    const window = model.windows[1];
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    await controller.global('rename "采集任务" 1');
    expect(model.title(window)).toBe('采集任务');
    model.switch(window.id);
    await controller.global('rename "新名称 with spaces"');
    model.execution({
      windowId: window.id,
      executionId: 'task',
      command: 'fetch',
      status: 'running',
    });
    expect(model.title(window)).toBe('新名称 with spaces');
    await controller.global('rename bad 0');
    expect(model.title(model.output)).toBe('输出');
    expect(model.panel?.lines.join('\n')).toContain('不能重命名');
    await controller.global('rename');
    expect(model.panel?.lines.join('\n')).toContain('参数错误');
  });
  it('dismisses notices on the next operation and returns normal Escape to the bottom', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    model.message = 'notice';
    await controller.key({
      name: 'mouse',
      sequence: '',
      mouse: { row: 0, column: 2, button: 32, release: false },
    });
    expect(model.message).toBe('notice');
    await controller.key({ name: 'up', sequence: '\x1b[A' });
    expect(model.message).toBe('');
    model.output.scroll = 10;
    model.output.anchor = { line: 2, offset: 0 };
    await controller.key({ name: 'escape', sequence: '\x1b' });
    expect(model.output.scroll).toBe(0);
    expect(model.output.anchor).toBeUndefined();
    await controller.global('transparent-bg false');
    expect(model.transparentBackground).toBe(false);
    expect(model.mode).toBe('normal');
  });
  it('advances replacement and forced cancellation through multiple next calls', async () => {
    const model = new TerminalModel();
    const window = model.windows[1];
    const core = new CoreConnection({ args: [] });
    const call = vi.spyOn(core, 'call').mockResolvedValue(undefined);
    const controller = new TerminalController(model, core);
    vi.spyOn(controller.plugins, 'cancel').mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    model.execution({ windowId: window.id, executionId: 'old', command: 'old', status: 'running' });
    await controller.global('run 1 next-task');
    expect(model.confirmation?.text).toContain('终止并执行');
    await controller.line('invalid');
    expect(model.confirmation?.text).toContain('请输入 :y 或 :n');
    expect(window.task?.executionId).toBe('old');
    await controller.line(':y');
    expect(model.confirmation?.text).toContain('整个插件进程');
    expect(window.history).toEqual([]);
    await controller.line(':y');
    expect(call).toHaveBeenCalledWith(
      'command.execute',
      expect.objectContaining({ command: 'next-task', windowId: window.id }),
    );
    expect(window.history).toEqual(['next-task']);
    expect(model.panel).toBeUndefined();
    expect(model.mode).toBe('normal');
  });
});
