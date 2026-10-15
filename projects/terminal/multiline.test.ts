import { afterEach, describe, expect, it, vi } from 'vitest';
import stringWidth from 'string-width';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
import { restoreState } from './storage.ts';
import type { CompletionRequest } from './protocol.ts';

const controllers: TerminalController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
});

function setup() {
  const model = new TerminalModel();
  model.switch(model.windows[1].id);
  const core = new CoreConnection({ args: [] });
  const controller = new TerminalController(model, core);
  controllers.push(controller);
  const call = vi.spyOn(core, 'call').mockImplementation(async (method, params) => {
    if (method === 'command.execute') {
      core.emit('command.finished', { ...(params as object), status: 'succeeded' });
    }
    return undefined as never;
  });
  return { model, core, controller, renderer: controller.renderer, call };
}

async function type(controller: TerminalController, text: string) {
  for (const sequence of text) {
    await controller.key({ name: 'text', sequence });
  }
}
const press = (controller: TerminalController, name: string, shift = false) =>
  controller.key({ name, sequence: '', shift });
const rows = (controller: TerminalController) =>
  controller.renderer
    .frame(controller.model, 0)
    .replace(/\x1b\[[\d;?]*[A-Za-z]/g, '')
    .split('\r\n');
function caret(controller: TerminalController) {
  const match = /\x1b\[(\d+);(\d+)H\x1b\[\?25h$/.exec(
    controller.renderer.frame(controller.model, 0),
  );
  expect(match).not.toBeNull();
  return { row: Number(match?.[1]) - 1, column: Number(match?.[2]) - 1 };
}

describe('multiline command input and history', () => {
  it('protects non-final continuation backslashes from adjacent Backspace and Delete', async () => {
    const { model, controller } = setup();
    const text = 'cmd \\\nC:\\path\\\n\\\nlast\\';
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '\\' || text[index + 1] !== '\n') {
        continue;
      }
      model.setInput(text, index + 1);
      await press(controller, 'backspace');
      expect(model.text).toBe(text);
      expect(model.cursor).toBe(index);
      await press(controller, 'delete');
      expect(model.text).toBe(text);
      expect(model.cursor).toBe(index);
    }
    model.setInput(text, text.length);
    await press(controller, 'backspace');
    expect(model.text).toBe(text.slice(0, -1));
    model.setInput(text, text.length - 1);
    await press(controller, 'delete');
    expect(model.text).toBe(text.slice(0, -1));
    const pathSlash = text.indexOf('C:') + 2;
    model.setInput(text, pathSlash);
    await press(controller, 'delete');
    expect(model.text).toBe(text.slice(0, pathSlash) + text.slice(pathSlash + 1));
  });

  it('keeps ordinary input answers editable when they contain a backslash before a newline', async () => {
    const { model, core, controller } = setup();
    core.emit('input.request', {
      id: 'answer',
      identity: { windowId: model.activeId, executionId: 'execution' },
      message: 'value?',
      type: 'string',
    });
    model.setInput('a\\\nb', 2);
    await press(controller, 'backspace');
    expect(model.text).toBe('a\nb');
    model.setInput('a\\\nb', 1);
    await press(controller, 'delete');
    expect(model.text).toBe('a\nb');
  });

  it.each(['plugin\\\n\\\n\\\n', 'pl\\\n\\\n\\\n'])(
    'preserves trailing continuation rows when completing the first word in %j',
    async (text) => {
      const { model, core, controller, call } = setup();
      core.emit('ready', { port: 3200, commands: [{ name: 'plugin' }] });
      const end = text.indexOf('\\');
      for (let cursor = 0; cursor <= text.length; cursor++) {
        model.clearServiceCompletion();
        model.setInput(text, cursor);
        await press(controller, 'tab');
        expect(model.text).toBe(text);
        expect(model.displayText).toBe('plugin' + text.slice(end));
        expect(model.cursor).toBe(end);
        expect(model.displayCursor).toBe(6);
        expect(model.candidates.map((item) => item.name)).toEqual(['plugin']);
        model.commitGlobalCompletion();
        expect(model.text).toBe('plugin' + text.slice(end));
        expect(model.cursor).toBe(6);
      }
      model.setInput(text, text.length);
      await press(controller, 'tab');
      await type(controller, ' ');
      expect(model.text).toBe('plugin ' + text.slice(end));
      expect(model.cursor).toBe(7);
      expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(['plugin \\\n\\\n', 'plugin \\\n\\\n\\'])(
    'completes an empty second word on any continuation row in %j',
    async (text) => {
      const { model, core, controller, call } = setup();
      core.emit('ready', { port: 3200, commands: [{ name: 'plugin' }] });
      call.mockImplementation(async (method, value) => {
        if (method !== 'command.complete') {
          return undefined as never;
        }
        const request = value as CompletionRequest;
        expect(request.command).toBe('plugin ');
        expect(request.cursor).toBe(7);
        return {
          command: request.command,
          from: 7,
          to: 7,
          items: [{ name: 'list', insertText: 'list' }],
        } as never;
      });
      for (let cursor = 7; cursor <= text.length; cursor++) {
        model.clearServiceCompletion();
        model.setInput(text, cursor);
        await press(controller, 'tab');
        const expectedCursor = text[cursor - 1] === '\\' ? cursor - 1 : cursor;
        expect(model.text).toBe(text);
        expect(model.cursor).toBe(expectedCursor);
        const expected = text.slice(0, expectedCursor) + 'list' + text.slice(expectedCursor);
        expect(model.displayText).toBe(expected);
        expect(model.displayCursor).toBe(expectedCursor + 4);
        model.commitGlobalCompletion();
        expect(model.text).toBe(expected);
        expect(model.cursor).toBe(expectedCursor + 4);
      }
    },
  );

  it('preserves empty continuation rows after a nonempty second word when completing from a later row', async () => {
    const { model, core, controller, call } = setup();
    core.emit('ready', { port: 3200, commands: [{ name: 'plugin' }] });
    const text = 'plugin li\\\n\\\n';
    call.mockImplementation(async (_method, value) => {
      const request = value as CompletionRequest;
      expect(request.command).toBe('plugin li');
      return {
        command: request.command,
        from: 7,
        to: 9,
        items: [{ name: 'list', insertText: 'list' }],
      } as never;
    });
    model.setInput(text, text.length);
    await press(controller, 'tab');
    expect(model.displayText).toBe('plugin list\\\n\\\n');
    expect(model.displayCursor).toBe(11);
    await type(controller, ' ');
    expect(model.text).toBe('plugin list \\\n\\\n');
    expect(model.cursor).toBe(12);
    await type(controller, 'x');
    expect(model.text).toBe('plugin list x\\\n\\\n');
  });

  it('keeps a trailing backslash literal in global command arguments', async () => {
    const { model, controller } = setup();
    model.enterGlobal();
    const text = 'cmd C:\\';
    model.setInput(text, text.length);
    vi.spyOn(controller.plugins, 'has').mockReturnValue(true);
    const complete = vi
      .spyOn(controller.plugins, 'complete')
      .mockImplementation(async (_name, request) => {
        expect(request.command).toBe(text);
        expect(request.cursor).toBe(text.length);
        return { command: text, from: 4, to: text.length, items: [] };
      });
    await press(controller, 'tab');
    expect(complete).toHaveBeenCalledOnce();
    expect(model.text).toBe(text);
    expect(model.cursor).toBe(text.length);
  });

  it('continues on a trailing backslash, executes the joined command once and keeps raw multiline history', async () => {
    const { model, controller, call } = setup();
    await type(controller, 'cmd "hel\\');
    await press(controller, 'enter');
    expect(call).not.toHaveBeenCalled();
    expect(model.text).toBe('cmd "hel\\\n');
    expect(
      rows(controller)
        .slice(1, 3)
        .map((row) => row.trimEnd()),
    ).toEqual(['> cmd "hel\\', '>']);
    await type(controller, 'lo" --path=C:\\data');
    const original = model.text;
    await press(controller, 'enter');
    expect(call).toHaveBeenCalledWith('command.validate', {
      command: 'cmd "hello" --path=C:\\data',
    });
    expect(call.mock.calls.filter(([name]) => name === 'command.execute')).toHaveLength(1);
    expect(model.active.history).toEqual([original]);
    expect(model.active.lines).toEqual(['> cmd "hel\\', '> lo" --path=C:\\data']);
    expect(model.text).toBe('');
    await press(controller, 'up');
    expect(model.text).toBe(original);
    expect(model.cursor).toBe(original.indexOf('\n'));
    await press(controller, 'enter');
    expect(model.text).toBe('');
    expect(call.mock.calls.filter(([name]) => name === 'command.execute')).toHaveLength(2);
  });

  it('preserves pasted newlines without executing and supports joining and splitting input rows', async () => {
    const { model, controller, call } = setup();
    await controller.key({ name: 'paste', sequence: 'cmd \\\r\narg' });
    expect(model.text).toBe('cmd \\\narg');
    expect(call).not.toHaveBeenCalled();
    await press(controller, 'home');
    await press(controller, 'backspace');
    expect(model.text).toBe('cmd \\arg');
    model.setInput('cmd \\\narg', 0);
    await press(controller, 'end');
    expect(model.cursor).toBe(5);
    await press(controller, 'delete');
    expect(model.text).toBe('cmd \\arg');
  });

  it('uses arrows only to move through a fresh multiline draft, preserving a visual column through short rows', async () => {
    const { model, controller } = setup();
    model.record(model.active, 'previous');
    const first = 'abcd中éZ';
    const last = '12中éXYZ';
    const text = `${first}\nx\n${last}`;
    model.setInput(text, first.length);
    await press(controller, 'down');
    expect(model.cursor).toBe(first.length + 2);
    await press(controller, 'down');
    expect(model.cursor).toBe(text.length);
    await press(controller, 'down');
    expect(model.text).toBe(text);
    await press(controller, 'up');
    await press(controller, 'up');
    expect(model.cursor).toBe(first.length);
    await press(controller, 'up');
    expect(model.text).toBe(text);
    expect(model.active.historyCursor).toBe(model.active.history.length);
    model.setInput('\n中\n👨‍👩‍👧‍👦', 0);
    await press(controller, 'down');
    expect(model.cursor).toBe(1);
    await press(controller, 'up');
    expect(model.cursor).toBe(0);
  });

  it('recalls upward onto the first row and downward onto the last row, switching history only at the respective boundaries', async () => {
    const { model, controller } = setup();
    const first = 'first \\\nalpha';
    const second = 'second \\\nbeta';
    for (const command of [first, second, 'last']) {
      model.record(model.active, command);
    }
    await press(controller, 'up');
    expect(model.text).toBe('last');
    await press(controller, 'up');
    expect(model.text).toBe(second);
    expect(model.cursor).toBe(second.indexOf('\n'));
    await press(controller, 'up');
    expect(model.text).toBe(first);
    await press(controller, 'down');
    expect(model.text).toBe(first);
    expect(model.cursor).toBeGreaterThan(first.indexOf('\n'));
    await press(controller, 'down');
    expect(model.text).toBe(second);
    expect(model.cursor).toBe(second.length);
    await press(controller, 'up');
    expect(model.text).toBe(second);
    await press(controller, 'down');
    await press(controller, 'down');
    expect(model.text).toBe('last');
    await press(controller, 'down');
    expect(model.text).toBe('');
  });

  it('locks edited recalled multiline history even after undoing the edit or deleting the newline', async () => {
    const { model, controller } = setup();
    model.record(model.active, 'older');
    const original = 'cmd \\\narg';
    model.record(model.active, original);
    await press(controller, 'up');
    await type(controller, 'x');
    await press(controller, 'backspace');
    expect(model.text).toBe(original);
    await press(controller, 'up');
    expect(model.text).toBe(original);
    model.setInput('edited', 0);
    await press(controller, 'up');
    await press(controller, 'down');
    expect(model.text).toBe('edited');
    await press(controller, 'escape');
    expect(model.text).toBe('');
    expect(model.active.history.at(-1)).toBe('edited');
    expect(model.active.historyCursor).toBe(model.active.history.length);
    expect(model.active.historyDraft).toBe('');
    await press(controller, 'up');
    expect(model.text).toBe('edited');
    await press(controller, 'up');
    expect(model.text).toBe(original);
  });

  it.each(['escape', 'ctrl+c'])(
    'archives and clears single or multiline input on %s, including selections',
    async (key) => {
      const { model, controller, call } = setup();
      controller.onCopy = vi.fn().mockResolvedValue(undefined);
      for (const text of ['unfinished "quote', 'cmd \\\npart \\\nlast']) {
        model.setInput(text, text.length, 0);
        if (key === 'ctrl+c') {
          await controller.key({ name: 'c', sequence: '\x03', ctrl: true });
        } else {
          await press(controller, 'escape');
        }
        expect(model.text).toBe('');
        expect(model.cursor).toBe(0);
        expect(model.selection).toBeUndefined();
        expect(model.active.history.at(-1)).toBe(text);
        expect(model.active.historyDraft).toBe('');
        expect(controller.onCopy).not.toHaveBeenCalled();
        await press(controller, 'up');
        expect(model.text).toBe(text);
        const firstLineEnd = text.indexOf('\n');
        expect(model.cursor).toBe(firstLineEnd < 0 ? text.length : firstLineEnd);
        await press(controller, 'escape');
      }
      expect(call).not.toHaveBeenCalled();
    },
  );

  it('retains multiline histories and the edited-history lock through state restoration', async () => {
    const { model, controller } = setup();
    model.setInput('cmd \\\narg', 0);
    await press(controller, 'escape');
    await press(controller, 'up');
    model.edit('changed');
    const restored = restoreState({ version: 1, activeId: model.activeId, windows: model.windows });
    const draft = restored.text;
    restored.history(1);
    expect(restored.text).toBe(draft);
    restored.clearCommand(true);
    restored.history(-1);
    expect(restored.text).toBe(draft);
    restored.history(-1);
    expect(restored.text).toBe('cmd \\\narg');
  });

  it('maps completion requests and replacements across continuation markers', async () => {
    const { model, core, controller, call } = setup();
    core.emit('ready', { port: 3200, commands: [{ name: 'cmd' }] });
    call.mockImplementation(async (method, value) => {
      if (method !== 'command.complete') {
        return undefined as never;
      }
      const request = value as CompletionRequest;
      expect(request.command).toBe('cmd sub val');
      return {
        command: request.command,
        from: 8,
        to: 11,
        items: [{ name: 'value', insertText: 'value' }],
      } as never;
    });
    const text = 'cmd \\\nsub val';
    model.setInput(text, text.length);
    await press(controller, 'tab');
    await press(controller, 'tab');
    await vi.waitFor(() => expect(model.inlineCompletionOpen).toBe(true));
    await press(controller, 'tab');
    expect(model.displayText).toBe('cmd \\\nsub value');
    await type(controller, ' ');
    expect(model.text).toBe('cmd \\\nsub value ');
  });

  it('maps shallow completions and keeps other windows’ drafts and history independent', async () => {
    const { model, core, controller, call } = setup();
    core.emit('ready', { port: 3200, commands: [{ name: 'cmd' }] });
    call.mockImplementation(async (method, value) => {
      const request = value as CompletionRequest;
      if (method === 'command.complete') {
        expect(request.command).toBe('cmd s');
        expect(request.cursor).toBe(5);
        return { from: 4, to: 5, items: [{ name: 'sub', insertText: 'sub' }] } as never;
      }
      return undefined as never;
    });
    const original = model.active;
    model.setInput('cmd \\\ns', 7);
    await press(controller, 'tab');
    expect(model.displayText).toBe('cmd \\\nsub');
    await type(controller, ' ');
    expect(model.text).toBe('cmd \\\nsub ');
    const other = model.newWindow();
    model.setInput('other', 5);
    await press(controller, 'escape');
    model.switch(original.id);
    expect(model.text).toBe('cmd \\\nsub ');
    expect(model.active.history).toEqual([]);
    expect(other.history).toEqual(['other']);
  });
});

describe('multiline viewport and selection', () => {
  it('scrolls every row horizontally by the same amount and keeps that offset until the caret leaves it', async () => {
    const { model, controller, renderer } = setup();
    renderer.width = 12;
    const text = 'abcdefghijk\\\n01234567890';
    model.setInput(text, text.length);
    expect(
      rows(controller)
        .slice(1, 3)
        .map((row) => row.trimEnd()),
    ).toEqual(['> cdefghijk\\', '> 234567890']);
    await press(controller, 'left');
    expect(rows(controller)[1].trimEnd()).toBe('> cdefghijk\\');
    await press(controller, 'home');
    expect(
      rows(controller)
        .slice(1, 3)
        .map((row) => row.trimEnd()),
    ).toEqual(['> abcdefghij', '> 0123456789']);
  });

  it('keeps two rows around the caret and scrolls only when it enters that margin', async () => {
    const { model, controller, renderer } = setup();
    renderer.height = 9;
    const text = Array.from({ length: 14 }, (_, index) => `row${index}`).join('\n');
    model.setInput(text, 0);
    expect(rows(controller)[1].trimEnd()).toBe('> row0');
    for (let index = 1; index <= 4; index++) {
      await press(controller, 'down');
      expect(rows(controller)[1].trimEnd()).toBe('> row0');
      expect(caret(controller).row).toBe(index + 1);
    }
    await press(controller, 'down');
    expect(rows(controller)[1].trimEnd()).toBe('> row1');
    expect(caret(controller).row).toBe(5);
    for (let index = 0; index < 2; index++) {
      await press(controller, 'up');
      expect(rows(controller)[1].trimEnd()).toBe('> row1');
    }
    await press(controller, 'up');
    expect(rows(controller)[1].trimEnd()).toBe('> row0');
    expect(caret(controller).row).toBe(3);
    model.setInput(text, text.length);
    expect(rows(controller)[7].trimEnd()).toBe('> row13');
    expect(caret(controller).row).toBe(7);
  });

  it('preserves manual scrolling until editing resumes, handles resize and never pins old output over input', async () => {
    const { model, controller, renderer } = setup();
    renderer.height = 9;
    model.echoCommand(model.active, 'old-command');
    model.append({ windowId: model.activeId, text: Array(20).fill('output').join('\n') });
    const text = Array.from({ length: 20 }, (_, index) => `row${index}`).join('\n');
    model.setInput(text, text.length);
    expect(rows(controller)[1]).not.toContain('old-command');
    renderer.scroll(model, 12);
    const before = rows(controller);
    expect(rows(controller)).toEqual(before);
    await press(controller, 'left');
    expect(caret(controller).row).toBeGreaterThanOrEqual(1);
    for (const height of [1, 2, 3, 4, 5, 6, 12]) {
      renderer.height = height;
      renderer.width = 7;
      const screen = rows(controller);
      expect(screen).toHaveLength(height);
      expect(screen.every((row) => stringWidth(row) <= 7)).toBe(true);
      if (height >= 3) {
        expect(caret(controller).row).toBeGreaterThanOrEqual(1);
        expect(caret(controller).row).toBeLessThan(height - 1);
      }
    }
  });

  it('keeps an input row visible while asynchronous output arrives above the editor', () => {
    const { model, controller, renderer } = setup();
    renderer.height = 9;
    const text = Array.from({ length: 20 }, (_, index) => `row${index}`).join('\n');
    model.setInput(text, text.indexOf('row10'));
    expect(caret(controller).row).toBe(3);
    model.append({ windowId: model.activeId, text: Array(15).fill('new output').join('\n') });
    expect(caret(controller).row).toBe(5);
    expect(rows(controller)[5].trimEnd()).toBe('> row10');
    expect(rows(controller)[1]).not.toContain('new output');
  });

  it('selects complete graphemes across input rows with the mouse or Shift+arrows', async () => {
    const { model, controller, renderer } = setup();
    const text = 'A中B\n👨‍👩‍👧‍👦CD';
    model.setInput(text, 0);
    rows(controller);
    renderer.beginSelection(model, 3, 1);
    renderer.dragSelection(model, 4, 2, true, false);
    expect(renderer.selectedText(model)).toBe('中B\n👨‍👩‍👧‍👦C');
    rows(controller);
    renderer.beginSelection(model, 4, 2);
    renderer.dragSelection(model, 3, 1, true, false);
    expect(renderer.selectedText(model)).toBe('中B\n👨‍👩‍👧‍👦C');
    model.setInput(text, 1);
    await press(controller, 'down', true);
    expect(model.selection).toBe(1);
    expect(model.text.slice(1, model.cursor)).toBe('中B\n');
  });
});
