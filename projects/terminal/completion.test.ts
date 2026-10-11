import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from './controller.ts';
import { TerminalModel } from './model.ts';
import { CoreConnection } from './core.ts';
import { completionInput } from './completion.ts';
import type { CompletionRequest } from './protocol.ts';

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
