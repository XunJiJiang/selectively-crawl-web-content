import { describe, expect, it, vi } from 'vitest';
import stringWidth from 'string-width';
import { TerminalController } from './controller.ts';
import { CoreConnection } from './core.ts';
import { TerminalModel } from './model.ts';
import { InputDecoder, type Key } from './input.ts';

const plain = (text: string) => text.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
function setup(command = true) {
  const model = new TerminalModel();
  if (command) {
    model.switch(model.windows[1].id);
  }
  const core = new CoreConnection({ args: [] });
  const controller = new TerminalController(model, core);
  return { model, core, controller };
}
async function type(controller: TerminalController, text: string) {
  for (const sequence of text) {
    await controller.key({ name: 'text', sequence });
  }
}
async function drag(controller: TerminalController, from: [number, number], to: [number, number]) {
  await controller.key({
    name: 'mouse',
    sequence: '',
    mouse: { column: from[0], row: from[1], button: 0, release: false },
  });
  await controller.key({
    name: 'mouse',
    sequence: '',
    mouse: { column: to[0], row: to[1], button: 32, release: false },
  });
  await controller.key({
    name: 'mouse',
    sequence: '',
    mouse: { column: to[0], row: to[1], button: 0, release: true },
  });
}

describe('inline command editing', () => {
  it('renders a prompt immediately after output, echoes submitted commands and retains history', async () => {
    const { model, core, controller } = setup();
    vi.spyOn(core, 'call').mockResolvedValue(undefined);
    model.append({ windowId: model.activeId, text: 'first\nsecond' });
    let rows = plain(controller.renderer.frame(model)).split('\r\n');
    expect(rows[3].trim()).toBe('>');
    expect(rows.at(-1)).not.toContain('COMMAND');
    await type(controller, 'plugin ls');
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.active.lines.at(-1)).toBe('> plugin ls');
    expect(model.active.history).toEqual(['plugin ls']);
    expect(model.active.draft).toBe('');
    rows = plain(controller.renderer.frame(model)).split('\r\n');
    expect(rows[4].trim()).toBe('>');
  });
  it('uses empty-input navigation and treats all text and editing keys as command input once typing starts', async () => {
    const { model, controller } = setup();
    model.newWindow();
    controller.renderer.width = 35;
    controller.renderer.frame(model);
    await controller.key({ name: 'left', sequence: '' });
    const offset = model.tabOffset;
    const id = model.activeId;
    await type(controller, 'i：');
    await controller.key({ name: 'tab', sequence: '\t' });
    await type(controller, ':x');
    await controller.key({ name: 'left', sequence: '' });
    expect(model.activeId).toBe(id);
    expect(model.tabOffset).toBe(offset);
    expect(model.active.draft).toBe('i：:x');
    expect(model.cursor).toBe(3);
    expect(model.mode).toBe('normal');
  });
  it('includes the draft in both command and global history without corrupting it through completion', async () => {
    const { model, controller } = setup();
    model.record(model.active, 'old command');
    await type(controller, 'half typed');
    await controller.key({ name: 'up', sequence: '' });
    expect(model.text).toBe('old command');
    await controller.key({ name: 'down', sequence: '' });
    expect(model.text).toBe('half typed');
    model.setInput('', 0);
    await controller.global('rename saved');
    await controller.key({ name: 'text', sequence: ':' });
    await type(controller, 'run 1 half');
    await controller.key({ name: 'up', sequence: '' });
    expect(model.text).toBe('rename saved');
    await controller.key({ name: 'down', sequence: '' });
    expect(model.text).toBe('run 1 half');
    await controller.key({ name: 'escape', sequence: '\x1b' });
    await controller.key({ name: 'text', sequence: ':' });
    expect(model.text).toBe('run 1 half');
  });
  it.each(['normal', 'global'] as const)(
    'supports word, edge and grapheme selection in %s input',
    async (mode) => {
      const { model, controller } = setup();
      model.mode = mode;
      model.setInput('one 中👨‍👩‍👧‍👦 three', 'one 中👨‍👩‍👧‍👦 three'.length);
      await controller.key({ name: 'left', sequence: '', ctrl: true, shift: true });
      expect(model.text.slice(model.cursor, model.selection)).toBe('three');
      await controller.key({ name: 'left', sequence: '', meta: true, shift: true });
      expect(model.text.slice(model.cursor, model.selection)).toBe('中👨‍👩‍👧‍👦 three');
      await controller.key({ name: 'left', sequence: '', alt: true, shift: true });
      expect(model.cursor).toBe(0);
      await controller.key({ name: 'right', sequence: '', alt: true });
      expect(model.cursor).toBe(model.text.length);
      expect(model.selection).toBeUndefined();
      await controller.key({ name: 'left', sequence: '', shift: true });
      await type(controller, '!');
      expect(model.text.endsWith('thre!')).toBe(true);
    },
  );
  it('warns on colon lookalikes only where a colon would enter global mode', async () => {
    const { model, controller } = setup(false);
    await type(controller, '：');
    expect(model.message).toContain('英文半角冒号');
    expect(model.mode).toBe('normal');
    model.switch(model.windows[1].id);
    await type(controller, '：﹕∶');
    expect(model.text).toBe('：﹕∶');
    expect(model.message).toBe('');
  });
  it('keeps Cmd+C with no selection from clearing drafts or exiting the terminal', async () => {
    const { model, controller } = setup();
    await type(controller, 'draft');
    await controller.key({ name: 'c', sequence: '', meta: true });
    expect(model.text).toBe('draft');
    expect(model.panel).toBeUndefined();
  });
});

describe('transient footer and text selection', () => {
  it('keeps outputs through colon and subsequent commands and discards the whole session on Escape', async () => {
    const { model, controller } = setup(false);
    await controller.global('help');
    const lines = [...(model.panel?.lines ?? [])];
    await controller.key({ name: 'text', sequence: ':' });
    expect(model.mode).toBe('global');
    expect(model.panel?.lines).toEqual(lines);
    await type(controller, 'transparent-bg false');
    await controller.key({ name: 'enter', sequence: '\r' });
    expect(model.panel?.lines).toEqual(lines);
    expect(model.mode).toBe('global-output');
    await controller.key({ name: 'escape', sequence: '\x1b' });
    expect(model.panel).toBeUndefined();
    expect(model.output.lines).toEqual([]);
  });
  it('sizes the footer to its content, caps the whole footer at half the terminal height and fixes the menu background after the status label', () => {
    const { model, controller } = setup(false);
    const renderer = controller.renderer;
    const panel = model.beginPanel('short');
    model.writePanel('one');
    model.finishPanel(panel);
    const frame = renderer.frame(model);
    expect(renderer.panelAt(21)).toBe(true);
    expect(renderer.panelAt(20)).toBe(false);
    const menu = frame.split('\r\n').at(-1) ?? '';
    expect(menu).toContain('\x1b[48;2;76;29;149m GLOBAL ');
    expect(menu).toContain('\x1b[48;2;30;41;59m');
    model.writePanel(Array.from({ length: 20 }, (_, i) => String(i)).join('\n'));
    renderer.frame(model);
    expect(renderer.panelAt(12)).toBe(true);
    expect(renderer.panelAt(11)).toBe(false);
    model.panel = undefined;
    model.mode = 'global';
    model.globalDraft = 'rename ';
    expect(renderer.frame(model)).not.toContain('[] 必填');
  });
  it('copies complete wide graphemes in either drag direction, clears selection and preserves soft wraps', async () => {
    const { model, controller } = setup(false);
    const copy = vi.fn().mockResolvedValue(undefined);
    controller.onCopy = copy;
    controller.renderer.width = 8;
    model.append({ windowId: model.activeId, text: '\x1b[31m甲乙丙丁戊己\x1b[0m' });
    controller.renderer.frame(model);
    await drag(controller, [1, 1], [2, 2]);
    expect(controller.renderer.selectedText(model)).toBe('甲乙丙丁戊己');
    await controller.key({ name: 'c', sequence: '', ctrl: true });
    expect(copy).toHaveBeenCalledWith('甲乙丙丁戊己');
    expect(controller.renderer.selectedText(model)).toBe('');
    controller.renderer.frame(model);
    await drag(controller, [2, 1], [1, 1]);
    await controller.key({ name: 'c', sequence: '', meta: true });
    expect(copy).toHaveBeenLastCalledWith('甲乙');
  });
  it('selects and copies footer output and inline command text, including half of a wide character', async () => {
    const { model, controller } = setup(false);
    controller.onCopy = vi.fn().mockResolvedValue(undefined);
    const panel = model.beginPanel('copy');
    model.writePanel('A中文B');
    model.finishPanel(panel);
    controller.renderer.frame(model);
    await drag(controller, [2, 22], [3, 22]);
    expect(controller.renderer.selectedText(model)).toBe('中文');
    await controller.key({ name: 'c', sequence: '', ctrl: true });
    expect(controller.onCopy).toHaveBeenCalledWith('中文');
    await controller.key({ name: 'escape', sequence: '' });
    model.switch(model.windows[1].id);
    await type(controller, '中abc');
    controller.renderer.frame(model);
    await drag(controller, [3, 1], [4, 1]);
    expect(controller.renderer.selectedText(model)).toBe('中a');
    await controller.key({ name: 'c', sequence: '', meta: true });
    expect(model.selection).toBeUndefined();
    expect(model.text).toBe('中abc');
  });
  it('keeps the inline caret visible above candidates when output fills the viewport', async () => {
    const { model, core, controller } = setup();
    core.emit('commands', [{ name: 'plugin', description: 'plugin tools' }]);
    model.append({ windowId: model.activeId, text: Array(30).fill('output').join('\n') });
    await type(controller, 'p');
    const frame = controller.renderer.frame(model);
    const rows = plain(frame).split('\r\n');
    expect(rows.some((row) => row.startsWith('> p'))).toBe(true);
    expect(frame).toContain('\x1b[?25h');
    for (const height of [1, 2, 3, 5]) {
      controller.renderer.height = height;
      controller.renderer.width = 5;
      const compact = plain(controller.renderer.frame(model)).split('\r\n');
      expect(compact).toHaveLength(height);
      expect(compact.every((row) => stringWidth(row) <= 5)).toBe(true);
    }
  });
  it('decodes fragmented modifier combinations, CSI-u copying and legacy Option arrows', () => {
    const keys: Key[] = [];
    const decoder = new InputDecoder((key) => keys.push(key));
    decoder.feed('\x1b[1;');
    decoder.feed('6D\x1b[1;4C\x1b[99;9u\x1bb\x1bf\x1b[99;5:3u');
    expect(keys).toMatchObject([
      { name: 'left', ctrl: true, shift: true },
      { name: 'right', alt: true, shift: true },
      { name: 'c', meta: true },
      { name: 'left', alt: true },
      { name: 'right', alt: true },
    ]);
    decoder.dispose();
  });
});
