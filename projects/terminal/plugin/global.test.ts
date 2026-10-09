import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TerminalController } from '../controller.ts';
import { TerminalModel } from '../model.ts';
import { CoreConnection } from '../core.ts';
import { splitCommand } from '../../server/utils/command.ts';

describe('global terminal extensions', () => {
  it('loads system commands and external global extensions through isolated hosts, routing output and next into the transient panel', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-global-plugin-'));
    const plugin = path.join(directory, 'example');
    await fs.mkdir(plugin);
    await fs.writeFile(
      path.join(plugin, 'package.json'),
      JSON.stringify({ type: 'module', main: 'index.ts' }),
    );
    await fs.writeFile(
      path.join(plugin, 'index.ts'),
      `export default {onLoad({registerCommand}) {
      registerCommand({name: 'ask-global', scope: 'global', usage: 'ask-global', description: 'global input', async execute(context) {
        context.write('before prompt');
        const [error, value] = await context.next('number?', Number);
        context.write(error ? 'cancelled:' + error.code : 'answer:' + value);
      }});
      registerCommand({name: 'local', description: 'ordinary tab command', execute(context) {context.write('local output');}});
      registerCommand({name: 'late-global', scope: 'global', description: 'late output', execute(context) {
        context.write('initial output');
        setTimeout(() => context.write('late global output'), 100);
      }});
      registerCommand({name: 'after-return', scope: 'global', description: 'background output', execute(context) {
        const handle = context.tasks.begin('later');
        setTimeout(() => {context.write('after return'); handle.end();}, 80);
      }});
    }};`,
    );
    const model = new TerminalModel();
    const core = new CoreConnection({ args: [] });
    const controller = new TerminalController(model, core);
    const commands = [
      { name: 'server', subCommands: ['info'], system: true },
      { name: 'plugin', subCommands: ['ls', 'ps', 'build-web'], system: true },
      { name: 'help', system: true },
      { name: 'exit', system: true },
      { name: 'business', system: false },
    ];
    const call = vi.spyOn(core, 'call').mockImplementation(async (method, value) => {
      if (method === 'command.execute') {
        const event = value as { command: string; windowId: string; executionId: string };
        core.emit('command.started', { ...event, status: 'running' });
        core.emit('output', { ...event, text: 'CORE:' + event.command });
        core.emit('command.finished', { ...event, status: 'succeeded' });
      }
      return {} as never;
    });
    core.emit('commands', commands);
    controller.plugins.resolveConflict = async () => 'a';
    try {
      await controller.plugins.load(directory, model.output.id, commands);
      expect(controller.plugins.list('global').map((item) => item.name)).toEqual(
        expect.arrayContaining(['scwc:server', 'scwc:plugin', 'scwc:help', 'ask-global']),
      );
      expect(controller.plugins.has('local')).toBe(true);
      expect(controller.plugins.has('ask-global')).toBe(false);
      expect(model.globalExtensions.map((item) => item.name)).not.toContain('business');
      model.output.lines = [];
      model.output.bytes = 0;
      await controller.global('scwc:plugin ps');
      await expect.poll(() => model.panel?.running).toBe(false);
      expect(call).toHaveBeenCalledWith(
        'command.execute',
        expect.objectContaining({ command: 'plugin "ps"', parentExecutionId: expect.any(String) }),
      );
      expect(model.panel?.lines).toContain('CORE:plugin "ps"');
      expect(model.windows.every((window) => !window.lines.length && !window.history.length)).toBe(
        true,
      );
      await controller.key({ name: 'text', sequence: ':' });
      model.setInput('scwc:server info', 16);
      await controller.key({ name: 'enter', sequence: '\r' });
      await expect.poll(() => model.panel?.running).toBe(false);
      expect(model.panel?.lines).toEqual(['CORE:plugin "ps"', 'CORE:server "info"']);
      await controller.global('scwc:help C:\\Users\\name\\');
      const forwarded = call.mock.calls.findLast(
        ([method, value]) =>
          method === 'command.execute' && (value as { command: string }).command.startsWith('help'),
      );
      expect(
        splitCommand((forwarded?.[1] as { command: string } | undefined)?.command ?? ''),
      ).toEqual(['help', 'C:\\Users\\name\\']);
      await controller.global('ask-global');
      expect(model.panel?.input?.text).toBe('number?');
      await controller.line('bad');
      await expect.poll(() => model.panel?.input?.text).toContain('有效的 number');
      await controller.line('12');
      await expect.poll(() => model.panel?.running).toBe(false);
      expect(model.panel?.lines).toContain('answer:12');
      await controller.global('ask-global');
      await controller.key({ name: 'c', ctrl: true, sequence: '\x03' });
      await expect.poll(() => model.panel?.running).toBe(false);
      expect(model.panel?.lines).toContain('cancelled:cancelled');
      await controller.global('after-return');
      await expect.poll(() => model.panel?.running).toBe(false);
      expect(model.panel?.lines.at(-1)).toBe('after return');
      await controller.key({ name: 'escape', sequence: '\x1b' });
      expect(model.panel).toBeUndefined();
      await controller.global('late-global');
      await controller.key({ name: 'escape', sequence: '\x1b' });
      await controller.global('help');
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(model.panel?.lines.join('\n')).not.toContain('late global output');
      expect(model.windows.every((window) => !window.lines.length)).toBe(true);
    } finally {
      await controller.plugins.unload();
      await fs.rm(directory, { recursive: true, force: true });
    }
  }, 15000);
});
