import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
describe('terminal input routing', () => {
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
