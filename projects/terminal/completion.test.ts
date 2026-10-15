import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from './controller.ts';
import { TerminalModel } from './model.ts';
import { CoreConnection } from './core.ts';
import { completionInput } from './completion.ts';
import { Renderer } from './render.ts';
import stringWidth from 'string-width';
import type { CompletionRequest, CompletionResult } from './protocol.ts';

const tab = { name: 'tab', sequence: '\t' } as const;
function setup(words = ['alpha', 'alpine', 'beta']) {
  const model = new TerminalModel();
  model.switch(model.windows[1].id);
  const core = new CoreConnection({ args: [] });
  const controller = new TerminalController(model, core);
  const call = vi.spyOn(core, 'call').mockImplementation(async (method, value) => {
    if (method !== 'command.complete') {
      return undefined as never;
    }
    const request = value as CompletionRequest;
    const input = completionInput(request.command, request.cursor);
    return {
      command: request.command,
      from: input.from,
      to: input.to,
      items: words.map((name) => ({ name, insertText: name })),
    } as never;
  });
  core.emit('ready', { port: 3200, commands: [{ name: 'cmd' }] });
  const load = async (text: string, cursor = text.length) => {
    model.setInput(text, cursor);
    await controller.key(tab);
    await controller.key(tab);
    await expect.poll(() => model.inlineCompletionOpen).toBe(true);
  };
  return { model, core, controller, call, load };
}

describe('stable command hints', () => {
  it.each([
    { level: 'first', text: 'c\\\nmd a', cursor: 1, direction: 'down', from: 0, to: 3 },
    { level: 'second', text: 'cmd \\\n\\\n', cursor: 8, direction: 'up', from: 4, to: 4 },
  ])('retains $level-level service hints while moving between input rows', async (scenario) => {
    const { model, controller, call } = setup();
    const items = [
      {
        name: scenario.level === 'first' ? 'cmd' : 'alpha',
        insertText: scenario.level === 'first' ? 'cmd' : 'alpha',
      },
    ];
    const response = (request: CompletionRequest, resultItems = items) => ({
      command: request.command,
      from: scenario.from,
      to: scenario.to,
      items: resultItems,
    });
    call.mockImplementation(
      async (_method, request) => response(request as CompletionRequest) as never,
    );
    try {
      model.setInput(scenario.text, scenario.cursor);
      await controller.key(tab);
      const original = model.candidates;
      const changed = vi.fn();
      controller.onChange = changed;
      for (const direction of [scenario.direction, scenario.direction === 'up' ? 'down' : 'up']) {
        const pending = Promise.withResolvers<CompletionResult>();
        let request: CompletionRequest | undefined;
        call.mockImplementation(async (_method, value) => {
          request = value as CompletionRequest;
          return (await pending.promise) as never;
        });
        await controller.key({ name: direction, sequence: '' });
        expect(model.candidates).toBe(original);
        expect(controller.renderer.frame(model, 0)).toContain(items[0].name);
        const notifications = changed.mock.calls.length;
        await vi.waitFor(() => expect(request).toBeDefined());
        pending.resolve(response(request as CompletionRequest));
        await vi.waitFor(() => expect(model.hasCurrentCompletion).toBe(true));
        expect(model.candidates).toBe(original);
        expect(changed).toHaveBeenCalledTimes(notifications);
      }
      const replacement = Promise.withResolvers<CompletionResult>();
      let request: CompletionRequest | undefined;
      call.mockImplementation(async (_method, value) => {
        request = value as CompletionRequest;
        return (await replacement.promise) as never;
      });
      await controller.key({ name: scenario.direction, sequence: '' });
      expect(model.candidates).toBe(original);
      await vi.waitFor(() => expect(request).toBeDefined());
      const notifications = changed.mock.calls.length;
      replacement.resolve(
        response(request as CompletionRequest, [{ name: 'new', insertText: 'new' }]),
      );
      await vi.waitFor(() => expect(model.candidates[0]?.name).toBe('new'));
      expect(changed).toHaveBeenCalledTimes(notifications + 1);
    } finally {
      await controller.dispose();
    }
  });

  it('keeps local first-level hints visible throughout vertical navigation', async () => {
    const { model, controller, call } = setup();
    try {
      const text = 'c\\\nmd\\\n';
      model.setInput(text, text.length);
      const hints: string[][] = [];
      controller.onChange = () => hints.push(model.candidates.map((item) => item.name));
      for (const direction of ['up', 'up', 'down', 'down']) {
        await controller.key({ name: direction, sequence: '' });
        expect(model.candidates.map((item) => item.name)).toEqual(['cmd']);
        expect(controller.renderer.frame(model, 0)).toContain('命令候选');
      }
      expect(hints).toHaveLength(4);
      expect(hints.every((items) => items.length === 1 && items[0] === 'cmd')).toBe(true);
      expect(call).not.toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });

  it('replaces first-level hints directly with second-level hints when moving into another word', async () => {
    const { model, controller, call } = setup();
    const pending = Promise.withResolvers<CompletionResult>();
    try {
      call.mockImplementation(async (_method, value) => {
        const request = value as CompletionRequest;
        if (request.cursor <= 3) {
          return {
            command: request.command,
            from: 0,
            to: 3,
            items: [{ name: 'cmd', insertText: 'cmd' }],
          } as never;
        }
        return (await pending.promise) as never;
      });
      model.setInput('cmd \\\na', 3);
      await controller.key(tab);
      await controller.key({ name: 'down', sequence: '' });
      expect(model.candidates[0]?.name).toBe('cmd');
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      pending.resolve({
        command: 'cmd a',
        from: 4,
        to: 5,
        items: [{ name: 'alpha', insertText: 'alpha' }],
      });
      await vi.waitFor(() => expect(model.candidates[0]?.name).toBe('alpha'));
      await controller.key(tab);
      expect(model.displayText).toBe('cmd \\\nalpha');
    } finally {
      pending.resolve({ from: 4, to: 5, items: [] });
      await controller.dispose();
    }
  });

  it.each(['normal', 'global'] as const)(
    'retains second-level hints while editing in %s mode and replaces only changed results',
    async (mode) => {
      const { model, controller, call } = setup(['alpha']);
      if (mode === 'global') {
        model.enterGlobal();
        vi.spyOn(controller.plugins, 'has').mockReturnValue(true);
        vi.spyOn(controller.plugins, 'complete').mockImplementation((_name, request, signal) =>
          controller.core.call('command.complete', request, 0, signal),
        );
      }
      const changed = vi.fn();
      controller.onChange = changed;
      try {
        await controller.key({ name: 'text', sequence: 'cmd a' });
        await vi.waitFor(() => expect(model.hasCurrentCompletion).toBe(true));
        const original = model.candidates;
        const unchanged = Promise.withResolvers<CompletionResult>();
        call.mockImplementation(async () => (await unchanged.promise) as never);
        await controller.key({ name: 'text', sequence: 'l' });
        expect(model.hasCurrentCompletion).toBe(false);
        expect(model.candidates).toBe(original);
        expect(controller.renderer.frame(model)).toContain('alpha');
        const updates = changed.mock.calls.length;
        await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
        unchanged.resolve({
          command: 'cmd al',
          from: 4,
          to: 6,
          items: [{ name: 'alpha', insertText: 'alpha' }],
        });
        await vi.waitFor(() => expect(model.hasCurrentCompletion).toBe(true));
        expect(model.candidates).toBe(original);
        expect(changed).toHaveBeenCalledTimes(updates);

        const replacement = Promise.withResolvers<CompletionResult>();
        call.mockImplementation(async () => (await replacement.promise) as never);
        await controller.key({ name: 'backspace', sequence: '\x7f' });
        expect(model.candidates).toBe(original);
        await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(3));
        const beforeReplacement = changed.mock.calls.length;
        replacement.resolve({
          command: 'cmd a',
          from: 4,
          to: 5,
          items: [{ name: 'alpha', insertText: 'alpha', description: 'updated description' }],
        });
        await vi.waitFor(() => expect(model.hasCurrentCompletion).toBe(true));
        expect(changed).toHaveBeenCalledTimes(beforeReplacement + 1);
        expect(model.candidates[0]?.description).toBe('updated description');
        await controller.key(tab);
        expect(model.displayText).toBe('cmd alpha');
        expect(model.displayCursor).toBe(9);
        expect(call).toHaveBeenCalledTimes(3);

        model.setInput('other ', 6);
        await controller.key({ name: 'unknown', sequence: '' });
        expect(model.candidates).toEqual([]);
      } finally {
        await controller.dispose();
      }
    },
  );

  it('computes first-word hints from a joined multiline command without requesting second-level hints', async () => {
    const { model, controller, call } = setup();
    try {
      const text = 'c\\\nmd';
      model.setInput(text, text.length);
      expect(model.candidates.map((item) => item.name)).toEqual(['cmd']);
      await controller.key(tab);
      expect(model.displayText).toBe('cmd');
      expect(call).not.toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });

  const screen = (renderer: Renderer, model: TerminalModel) =>
    stripVTControlCharacters(renderer.frame(model, 0)).split('\r\n');
  const caret = (renderer: Renderer, model: TerminalModel) => {
    const frame = renderer.frame(model, 0);
    const position = /\x1b\[(\d+);\d+H\x1b\[\?25h$/.exec(frame);
    expect(position).not.toBeNull();
    return Number(position?.[1]) - 1;
  };

  it('overlays hints above a single-line editor and preserves its row as the list grows or shrinks', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.commands = ['plugin', 'plug', 'ping'].map((name) => ({ name }));
    model.append({ windowId: model.activeId, text: Array(30).fill('output').join('\n') });
    const renderer = new Renderer();
    renderer.height = 12;
    const row = caret(renderer, model);
    for (const text of ['p', 'pl', 'plugin ', 'p', '']) {
      model.setInput(text, text.length);
      expect(caret(renderer, model)).toBe(row);
      const rows = screen(renderer, model);
      expect(rows[row].trimEnd()).toBe(`> ${text}`.trimEnd());
      const hint = rows.findIndex((line) => line.includes('命令候选'));
      if (model.candidates.length) {
        expect(hint).toBeGreaterThan(0);
        expect(hint).toBeLessThan(row);
        expect(renderer.panelAt(row - 1)).toBe(true);
        expect(renderer.panelAt(row)).toBe(false);
      }
    }
    model.setInput('pl', 2);
    screen(renderer, model);
    renderer.beginSelection(model, 2, row);
    renderer.dragSelection(model, 3, row, true, false);
    expect(renderer.selectedText(model)).toBe('pl');
    renderer.scroll(model, 10);
    expect(screen(renderer, model)).toHaveLength(12);
    expect(renderer.panelAt(1)).toBe(false);
  });

  it('keeps every multiline editor row in place when hints fit above it', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.append({ windowId: model.activeId, text: Array(6).fill('output').join('\n') });
    const renderer = new Renderer();
    renderer.height = 16;
    const text = 'cmd \\\ns';
    model.setInput(text, text.length);
    const before = screen(renderer, model);
    const row = caret(renderer, model);
    model.setServiceCompletion(model.completionKey ?? '', {
      command: text,
      from: 6,
      to: 7,
      items: [{ name: 'sub', insertText: 'sub' }],
    });
    expect(caret(renderer, model)).toBe(row);
    const after = screen(renderer, model);
    expect(after[row - 1]).toBe(before[row - 1]);
    expect(after[row]).toBe(before[row]);
    expect(after[row - 2]).toContain('sub');
    expect(renderer.panelAt(row - 1)).toBe(false);
  });

  it('docks hints below the tabs when the multiline editor fills the viewport and preserves caret and mouse coordinates', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    const renderer = new Renderer();
    renderer.height = 10;
    const text = 'cmd \\\nsub \\\n' + 'arg \\\n'.repeat(18) + 'v';
    model.setInput(text, text.length);
    model.setServiceCompletion(model.completionKey ?? '', {
      command: text,
      from: text.length - 1,
      to: text.length,
      inline: true,
      items: [{ name: 'value', insertText: 'value' }],
    });
    const first = screen(renderer, model);
    expect(first[1]).toContain('命令候选');
    expect(first[2]).toContain('value');
    expect(first[3]).toMatch(/^> /);
    expect(screen(renderer, model)).toEqual(first);
    const inputRow = caret(renderer, model);
    renderer.beginSelection(model, 2, inputRow);
    renderer.dragSelection(model, 2, inputRow, true, true);
    expect(model.cursor).toBe(text.length - 1);
    for (const height of [1, 2, 3, 4, 5, 9, 12]) {
      renderer.width = 9;
      renderer.height = height;
      const rows = screen(renderer, model);
      expect(rows).toHaveLength(height);
      expect(rows.every((row) => stringWidth(row) <= 9)).toBe(true);
      if (height >= 3) {
        expect(caret(renderer, model)).toBeGreaterThanOrEqual(1);
        expect(caret(renderer, model)).toBeLessThan(height - 1);
      }
    }
  });
});

describe('deep terminal completion', () => {
  it('filters the complete returned list even when a matching word occurs beyond the old 512-item limit', async () => {
    const { model, controller, load } = setup([
      ...Array.from({ length: 600 }, (_, index) => `item-${index}`),
      'last-match',
    ]);
    try {
      await load('cmd sub last');
      expect(model.candidates.map((item) => item.name)).toEqual(['last-match']);
    } finally {
      await controller.dispose();
    }
  });
  it('requires double Tab, filters locally, starts selection separately, and restores the draft on first Backspace', async () => {
    const { model, controller, call, load } = setup();
    try {
      await controller.key({ name: 'text', sequence: 'cmd sub a' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(call).not.toHaveBeenCalled();
      await controller.key(tab);
      expect(call).not.toHaveBeenCalled();
      await controller.key(tab);
      await expect.poll(() => model.inlineCompletionOpen).toBe(true);
      expect(model.completionPreview).toBe(false);
      expect(model.candidates.map((item) => item.name)).toEqual(['alpha', 'alpine']);
      await controller.key({ ...tab, shift: true });
      expect(model.displayText).toBe('cmd sub alpine');
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      expect(model.displayText).toBe('cmd sub a');
      expect(model.completionPreview).toBe(false);
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      expect(model.text).toBe('cmd sub ');
      expect(model.candidates).toHaveLength(3);
      await controller.key(tab);
      expect(model.displayText).toBe('cmd sub alpha');
      await controller.key({ name: 'text', sequence: 'b' });
      expect(model.text).toBe('cmd sub b');
      expect(model.candidates.map((item) => item.name)).toEqual(['beta']);
      expect(call.mock.calls.filter(([method]) => method === 'command.complete')).toHaveLength(1);
      await controller.key({ name: 'escape', sequence: '\x1b' });
      expect(model.inlineCompletionOpen).toBe(false);
      await load('cmd sub b');
      expect(call.mock.calls.filter(([method]) => method === 'command.complete')).toHaveLength(2);
    } finally {
      await controller.dispose();
    }
  });
  it('edits the actual cursor inside the last word and moves to the end only on commit', async () => {
    const { model, controller, load, call } = setup(['cmd3']);
    try {
      await load('cmd1 cmd2 cmd3', 12); // Between m and d.
      await controller.key(tab);
      expect(model.completionPreview).toBe(true);
      await controller.key({ name: 'text', sequence: 's' });
      expect(model.text).toBe('cmd1 cmd2 cmsd3');
      expect(model.cursor).toBe(13);
      await load('cmd1 cmd2 cmd3', 12);
      await controller.key(tab);
      await controller.key({ name: 'text', sequence: ' ' });
      expect(model.text).toBe('cmd1 cmd2 cmd3 ');
      expect(model.cursor).toBe(model.text.length);
      expect(model.inlineCompletionOpen).toBe(false);
      call.mockClear();
      model.setInput('cmd1 cmd2 cmd3', 7);
      await controller.key(tab);
      await controller.key(tab);
      expect(call).not.toHaveBeenCalled();
    } finally {
      await controller.dispose();
    }
  });
  it('commits option keys with equals and completes only the value after equals', async () => {
    const { model, controller, load, call } = setup(['--mode', '--other']);
    try {
      await load('cmd sub --mo');
      await controller.key(tab);
      await controller.key({ name: 'text', sequence: '=' });
      expect(model.text).toBe('cmd sub --mode=');
      expect(model.cursor).toBe(model.text.length);
      expect(model.inlineCompletionOpen).toBe(false);
      call.mockImplementation(async (_method, value) => {
        const request = value as CompletionRequest;
        return {
          command: request.command,
          from: 0,
          to: request.cursor,
          items: ['debug', 'production'].map((name) => ({ name, insertText: name })),
        } as never;
      });
      await load('cmd sub --mode=de');
      expect(model.candidates.map((item) => item.name)).toEqual(['debug']);
      await controller.key(tab);
      expect(model.displayText).toBe('cmd sub --mode=debug');
      await controller.key({ name: 'text', sequence: ' ' });
      expect(model.text).toBe('cmd sub --mode=debug ');
    } finally {
      await controller.dispose();
    }
  });
  it('executes the selected candidate on Enter and clears candidates', async () => {
    const { model, controller, load, call } = setup();
    try {
      await load('cmd sub a');
      await controller.key(tab);
      await controller.key({ name: 'enter', sequence: '\r' });
      expect(call).toHaveBeenCalledWith(
        'command.execute',
        expect.objectContaining({ command: 'cmd sub alpha' }),
      );
      expect(model.inlineCompletionOpen).toBe(false);
      expect(model.text).toBe('');
    } finally {
      await controller.dispose();
    }
  });
  it('cancels pending work on edit and rejects late results even if input returns to the same string', async () => {
    const { model, controller, call } = setup();
    const late = Promise.withResolvers<unknown>();
    let signal: AbortSignal | undefined;
    call.mockImplementation(async (_method, _value, timeout, currentSignal) => {
      expect(timeout).toBe(0);
      signal = currentSignal;
      return (await late.promise) as never;
    });
    try {
      model.setInput('cmd sub a', 9);
      await controller.key(tab);
      await controller.key(tab);
      expect(signal?.aborted).toBe(false);
      await controller.key({ name: 'text', sequence: 'b' });
      expect(signal?.aborted).toBe(true);
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      late.resolve({
        command: 'cmd sub a',
        from: 8,
        to: 9,
        items: [{ name: 'alpha', insertText: 'alpha' }],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(model.inlineCompletionOpen).toBe(false);
    } finally {
      late.resolve(undefined);
      await controller.dispose();
    }
  });
  it.each([{ items: [] }, { items: [{ name: 'alpha', insertText: 'alpha' }] }])(
    're-requests empty or mismatched results after another double Tab (%j)',
    async ({ items }) => {
      const { model, controller, call } = setup();
      call.mockResolvedValue({ command: 'different input', from: 8, to: 9, items } as never);
      try {
        model.setInput('cmd sub a', 9);
        for (let i = 0; i < 2; i++) {
          await controller.key(tab);
          await controller.key(tab);
          await new Promise((resolve) => setTimeout(resolve, 0));
          expect(model.inlineCompletionOpen).toBe(false);
        }
        expect(call).toHaveBeenCalledTimes(2);
      } finally {
        await controller.dispose();
      }
    },
  );
  it('lays out inline words on shared rows, wraps, and reveals the highlighted candidate', async () => {
    const words = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
    const { model, controller, load } = setup(words);
    try {
      controller.renderer.width = 12;
      controller.renderer.height = 12;
      await load('cmd sub ');
      const first = stripVTControlCharacters(controller.renderer.frame(model));
      expect(first).toContain('alpha beta');
      expect(first).toContain('gamma delta');
      await controller.key({ ...tab, shift: true });
      expect(model.displayText).toBe('cmd sub zeta');
      expect(controller.renderer.frame(model)).toContain('zeta');
    } finally {
      await controller.dispose();
    }
  });
  it('also treats first- and second-level previews as removable by the first Backspace', async () => {
    const { model, controller } = setup();
    try {
      model.setInput('c', 1);
      await controller.key(tab);
      expect(model.displayText).toBe('cmd');
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      expect(model.text).toBe('c');
      expect(model.displayText).toBe('c');
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      expect(model.text).toBe('');
      model.setInput('cmd a', 5);
      await controller.key(tab);
      expect(model.displayText).toBe('cmd alpha');
      await controller.key({ name: 'backspace', sequence: '\x7f' });
      expect(model.displayText).toBe('cmd a');
    } finally {
      await controller.dispose();
    }
  });
});
