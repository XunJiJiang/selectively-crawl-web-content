import { describe, expect, it, vi } from 'vitest';
import stringWidth from 'string-width';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
import { Renderer } from './render.ts';
import { restoreState } from './storage.ts';

const screenRows = (renderer: Renderer, model: TerminalModel) =>
  renderer
    .frame(model, 0)
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '')
    .split('\r\n');

function setup() {
  const model = new TerminalModel();
  model.switch(model.windows[1].id);
  const renderer = new Renderer();
  renderer.width = 24;
  renderer.height = 8;
  return { model, renderer };
}

function output(model: TerminalModel, count: number, prefix = 'output') {
  model.append({
    windowId: model.activeId,
    text: Array.from({ length: count }, (_, index) => `${prefix} ${index}`).join('\n'),
  });
}

describe('command context while scrolling', () => {
  it('pins an executed command and scrolls to its echo on a mouse click', async () => {
    const { model } = setup();
    const core = new CoreConnection({ args: [] });
    const controller = new TerminalController(model, core);
    const renderer = controller.renderer;
    renderer.width = 24;
    renderer.height = 8;
    vi.spyOn(core, 'call').mockImplementation(async (method, params) => {
      if (method === 'command.execute') {
        core.emit('command.finished', { ...(params as object), status: 'succeeded' });
      }
      return undefined as never;
    });
    try {
      await controller.line('scan');
      output(model, 20);
      model.append({ windowId: model.activeId, text: '> ordinary log' });
      let rows = screenRows(renderer, model);
      expect(rows[1].trim()).toBe('> scan');
      expect(rows[5].trim()).toBe('> ordinary log');
      expect(rows[6].trim()).toBe('>');
      await controller.key({
        name: 'mouse',
        sequence: '',
        mouse: { row: 1, column: 3, button: 0, release: false },
      });
      expect(model.active.anchor).toEqual({ line: 0, offset: 0 });
      rows = screenRows(renderer, model);
      expect(rows[1].trim()).toBe('> scan');
      expect(rows[2].trim()).toBe('output 0');
      expect(rows.filter((row) => row.trim() === '> scan')).toHaveLength(1);
      expect(renderer.selectedText(model)).toBe('');
      expect(renderer.revealPinnedCommand(model, 1)).toBe(false);
      renderer.beginSelection(model, 0, 1);
      renderer.dragSelection(model, 5, 1, true, false);
      expect(renderer.selectedText(model)).toBe('> scan');
    } finally {
      await controller.dispose();
    }
  });

  it('uses the nearest earlier command and leaves commands already at the top visible once', () => {
    const { model, renderer } = setup();
    model.echoCommand(model.active, 'first');
    output(model, 8, 'first');
    model.echoCommand(model.active, 'second');
    output(model, 8, 'second');
    expect(screenRows(renderer, model)[1].trim()).toBe('> second');
    model.active.anchor = { line: 5, offset: 0 };
    expect(screenRows(renderer, model)[1].trim()).toBe('> first');
    model.active.anchor = { line: 9, offset: 0 };
    const rows = screenRows(renderer, model);
    expect(rows[1].trim()).toBe('> second');
    expect(rows[2].trim()).toBe('second 0');
    expect(rows).not.toContain(expect.stringContaining('> first'));
    model.active.anchor = { line: 0, offset: 0 };
    expect(screenRows(renderer, model)[2].trim()).toBe('first 0');
  });

  it('does not pin short content, output windows or content before the first command', () => {
    const { model, renderer } = setup();
    model.echoCommand(model.active, 'short');
    output(model, 1);
    expect(screenRows(renderer, model).filter((row) => row.trim() === '> short')).toHaveLength(1);
    model.switch(model.newWindow().id);
    output(model, 10, 'before');
    model.echoCommand(model.active, 'later');
    output(model, 10);
    model.active.anchor = { line: 3, offset: 0 };
    expect(screenRows(renderer, model)[1].trim()).toBe('before 3');
    model.switch(model.output.id);
    output(model, 20, '> output');
    expect(screenRows(renderer, model)[1].trim()).toBe('> output 14');
  });

  it('ellipsizes wide colored commands and suppresses the pin while their wrapped echo is on top', () => {
    const { model, renderer } = setup();
    model.echoCommand(model.active, '\x1b[31m查找 中文路径 参数参数参数\x1b[0m');
    output(model, 20);
    renderer.width = 11;
    model.active.anchor = { line: 0, offset: 11 };
    expect(screenRows(renderer, model)[1]).not.toContain('…');
    model.active.anchor = { line: 1, offset: 0 };
    expect(screenRows(renderer, model)[1].trimEnd()).toMatch(/^> 查找.*…$/);
    for (const width of [1, 2, 4, 11, 30]) {
      renderer.width = width;
      const rows = screenRows(renderer, model);
      expect(rows).toHaveLength(8);
      expect(rows.every((row) => stringWidth(row) <= width)).toBe(true);
      expect(renderer.revealPinnedCommand(model, 1)).toBe(true);
      expect(model.active.anchor).toEqual({ line: 0, offset: 0 });
      model.active.anchor = { line: 1, offset: 0 };
    }
  });

  it('keeps the command and scroll anchor stable across new output, resize and window switches', () => {
    const { model, renderer } = setup();
    const window = model.active;
    model.echoCommand(window, 'first');
    output(model, 30);
    screenRows(renderer, model);
    renderer.scroll(model, 10);
    const before = screenRows(renderer, model);
    output(model, 2, 'new');
    expect(screenRows(renderer, model)).toEqual(before);
    renderer.width = 30;
    expect(screenRows(renderer, model)[1].trim()).toBe('> first');
    const other = model.newWindow();
    expect(screenRows(renderer, model)[1].trim()).toBe('>');
    renderer.beginSelection(model, 2, 1);
    expect(other.anchor).toBeUndefined();
    model.switch(window.id);
    expect(screenRows(renderer, model)[1].trim()).toBe('> first');
  });

  it('restores command positions, rejects invalid markers and drops truncated commands', () => {
    const { model, renderer } = setup();
    model.echoCommand(model.active, 'saved');
    output(model, 20);
    const restored = restoreState({ version: 1, activeId: model.activeId, windows: model.windows });
    expect(screenRows(renderer, restored)[1].trim()).toBe('> saved');
    const legacy = restoreState({
      version: 1,
      activeId: model.activeId,
      windows: model.windows.map((window) => ({ ...window, commandLines: undefined })),
    });
    expect(legacy.active.commandLines).toEqual([0]);
    expect(screenRows(renderer, legacy)[1].trim()).toBe('> saved');
    const invalid = restoreState({
      version: 1,
      activeId: model.activeId,
      windows: model.windows.map((window) => ({ ...window, commandLines: [-1, 0, 0, 1, 99] })),
    });
    expect(invalid.active.commandLines).toEqual([0]);
    output(model, 10010);
    expect(model.active.commandLines).toEqual([]);
    expect(screenRows(renderer, model)[1]).not.toContain('> saved');
  });

  it('clears command positions with output while preserving executable history', async () => {
    const { model } = setup();
    model.echoCommand(model.active, 'old');
    model.record(model.active, 'old');
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    try {
      await controller.global('clear output');
      expect(model.active.commandLines).toEqual([]);
      expect(model.active.history).toEqual(['old']);
      output(model, 30);
      expect(screenRows(controller.renderer, model)[1]).not.toContain('> old');
    } finally {
      await controller.dispose();
    }
  });
});
