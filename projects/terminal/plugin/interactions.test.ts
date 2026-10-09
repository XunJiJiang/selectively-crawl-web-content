import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TerminalController } from '../controller.ts';
import { TerminalModel } from '../model.ts';
import { CoreConnection } from '../core.ts';
import { Renderer } from '../render.ts';

const plain = (value: string) => value.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
async function enter(controller: TerminalController, text: string) {
  for (const sequence of text) {
    await controller.key({ name: 'text', sequence });
  }
  await controller.key({ name: 'enter', sequence: '\r' });
}

describe('plugin choices and terminal rendering regressions', () => {
  it('validates custom identifiers in the real input flow and supports modifying both plugins', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'terminal-identifier-ui-'));
    for (const id of ['first', 'second', 'taken']) {
      const folder = path.join(directory, id);
      await fs.mkdir(folder);
      await fs.writeFile(
        path.join(folder, 'package.json'),
        JSON.stringify({ type: 'module', main: 'index.ts' }),
      );
      await fs.writeFile(
        path.join(folder, 'index.ts'),
        `export default {id: '${id === 'taken' ? 'occupied' : 'same'}',onLoad(){}};`,
      );
    }
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    const loading = controller.plugins.load(directory, model.output.id, []);
    try {
      await expect.poll(() => model.confirmation?.text).toContain(':c 两个都自定义');
      expect(model.text).toBe(':');
      await enter(controller, 'c');
      expect(model.confirmation?.text).toContain('第一个');
      await enter(controller, 'occupied');
      expect(model.confirmation?.text).toContain('已被占用');
      await enter(controller, 'alpha');
      expect(model.confirmation?.text).toContain('第二个');
      await enter(controller, 'alpha');
      expect(model.confirmation?.text).toContain('已被占用');
      await enter(controller, 'beta');
      await loading;
      expect(
        Object.values(model.pluginPreferences)
          .map((item) => item.identifier)
          .sort(),
      ).toEqual(['alpha', 'beta']);
    } finally {
      await controller.plugins.unload();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('protects the colon through deletion, selection replacement, cursor movement and paste without changing generic next input', async () => {
    const model = new TerminalModel();
    model.beginPanel('choice');
    const choice = model.nextChoice('choose :a or :b');
    model.move(-1, false, 'edge');
    model.edit('', 'delete');
    model.edit('', 'backspace');
    expect(model.text).toBe(':');
    expect(model.cursor).toBe(1);
    model.setInput(':abc', 0, 4);
    model.edit('a');
    expect(model.text).toBe(':a');
    model.setInput(':', 1);
    model.edit(':b');
    expect(model.text).toBe(':b');
    model.panel?.input?.reply(model.text);
    expect(await choice).toEqual([undefined, ':b']);
    const generic = model.next('literal value');
    expect(model.text).toBe('');
    model.panel?.input?.reply('abc');
    expect(await generic).toEqual([undefined, 'abc']);
  });
  it('exits an empty global command using Backspace while preserving internal next input', async () => {
    const model = new TerminalModel();
    const controller = new TerminalController(model, new CoreConnection({ args: [] }));
    await controller.key({ name: 'text', sequence: ':' });
    expect(model.mode).toBe('global');
    await controller.key({ name: 'backspace', sequence: '\x7f' });
    expect(model.mode).toBe('normal');
    model.beginPanel('generic');
    const answer = model.next('data');
    await controller.key({ name: 'backspace', sequence: '\x7f' });
    expect(model.panel?.input).toBeDefined();
    model.panel?.input?.reply('');
    await answer;
  });
  it('includes the menu row in the half-screen height budget and shows an empty inline caret', () => {
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    const renderer = new Renderer();
    renderer.frame(model);
    expect(renderer.frame(model)).toContain('\x1b[2;3H\x1b[?25h');
    const panel = model.beginPanel('output');
    model.writePanel(Array(100).fill('line').join('\n'));
    model.finishPanel(panel);
    for (const height of [4, 5, 6, 8, 10, 12, 24]) {
      renderer.height = height;
      renderer.frame(model);
      const count = Array.from({ length: height }, (_, row) => row).filter((row) =>
        renderer.panelAt(row),
      ).length;
      expect(count + 1).toBeLessThanOrEqual(Math.floor(height / 2));
    }
  });
  it('highlights the shared separator at both sides of an active tab', () => {
    const model = new TerminalModel();
    model.newWindow();
    model.switch(model.windows[1].id);
    const renderer = new Renderer();
    renderer.width = 100;
    const row = renderer.frame(model, 0).split('\r\n')[0];
    expect(plain(row).match(/┃/g)).toHaveLength(2);
    expect(row.match(/\x1b\[38;2;103;232;249m\x1b\[48;2;51;65;85m┃/g)).toHaveLength(2);
  });
});
