import { describe, expect, it, vi } from 'vitest';
import {
  splitCommand,
  registerCommand,
  parseAndRunCommands,
  validateCommand,
  getCommands,
  completeCommand,
  unregisterPluginCommand,
  SYSTEM_SYMBOL,
} from './command.ts';
import { TaskRegistry, outputWindowId } from '../common/tasks.ts';
import { setLogSink } from './log.ts';
import type { TCommandComplete } from '../types/command.d.ts';

const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
describe('command invocation contract', () => {
  it('passes raw spacing, all completed words, value/key state and an isolated timestamped cache', async () => {
    const complete = vi.fn<TCommandComplete>(
      (command, _parents, cache, _sub, _isKey, isValue, _key) => {
        const previous = cache.get<number>('count');
        cache.set('count', (previous?.value ?? 0) + 1);
        return { command, commands: isValue ? ['debug', 'production'] : ['page', 'other'] };
      },
    );
    registerCommand(
      logger,
      'deep-command',
      vi.fn(),
      'deep-owner',
      '',
      [],
      [{ name: 'never-automatic' }],
      '',
      undefined,
      complete,
    );
    registerCommand(
      logger,
      'other-command',
      vi.fn(),
      'other-owner',
      '',
      [],
      [],
      '',
      undefined,
      complete,
    );
    const request = (command: string) => completeCommand({ command, cursor: command.length });
    try {
      const raw = 'deep-command  build sc';
      expect((await request(raw)).items.map((item) => item.name)).toEqual(['page', 'other']);
      expect(complete.mock.calls[0].slice(0, 2)).toEqual([raw, ['deep-command', 'build']]);
      expect(complete.mock.calls[0].slice(3, 7)).toEqual(['build', false, false, undefined]);
      await request('deep-command  build ');
      expect(complete.mock.calls[1][1]).toEqual(['deep-command', 'build']);
      expect(complete.mock.calls[1][2]).toBe(complete.mock.calls[0][2]);
      const cached = complete.mock.calls[1][2].get<number>('count');
      expect(cached?.value).toBe(2);
      expect(cached?.updatedAt).toBeGreaterThan(0);
      const value = 'deep-command build --mode=de';
      expect((await request(value)).items.map((item) => item.name)).toEqual([
        'debug',
        'production',
      ]);
      expect(complete.mock.calls[2].slice(3, 7)).toEqual(['build', true, true, 'mode']);
      await request('deep-command build -mode=');
      expect(complete.mock.calls[3][6]).toBe('mode');
      await request('deep-command build page leaf ');
      expect(complete.mock.calls[4][1]).toEqual(['deep-command', 'build', 'page', 'leaf']);
      await request('other-command build ');
      expect(complete.mock.calls[5][2]).not.toBe(complete.mock.calls[0][2]);
      const count = complete.mock.calls.length;
      await completeCommand({ command: 'deep-command build page', cursor: 5 });
      expect(complete).toHaveBeenCalledTimes(count);
    } finally {
      unregisterPluginCommand('deep-owner');
      unregisterPluginCommand('other-owner');
    }
  });
  it('returns empty hints without a callback and cancels noncooperating providers without executing', async () => {
    const execute = vi.fn();
    registerCommand(logger, 'empty-hints', execute, 'empty-hints', '', [], [{ name: 'option' }]);
    const callback = vi.fn<TCommandComplete>(
      () =>
        new Promise(() => {
          /* Deliberately never settles, to verify cancellation. */
        }),
    );
    registerCommand(
      logger,
      'pending-hints',
      execute,
      'pending-hints',
      '',
      [],
      [],
      '',
      undefined,
      callback,
    );
    try {
      const raw = 'empty-hints sub --';
      expect(await completeCommand({ command: raw, cursor: raw.length })).toMatchObject({
        command: raw,
        items: [],
      });
      const controller = new AbortController();
      const pending = completeCommand(
        { command: 'pending-hints sub ', cursor: 18 },
        controller.signal,
      );
      const rejection = expect(pending).rejects.toThrow();
      controller.abort();
      await rejection;
      expect(callback.mock.calls[0][7].signal.aborted).toBe(true);
      expect(execute).not.toHaveBeenCalled();
    } finally {
      unregisterPluginCommand('empty-hints');
      unregisterPluginCommand('pending-hints');
    }
  });
  it('routes callback logger output to the output tab, without creating execution tasks', async () => {
    const output: unknown[] = [];
    setLogSink((event) => output.push(event));
    registerCommand(
      logger,
      'logging-hints',
      vi.fn(),
      'logging-hints',
      '',
      [],
      [],
      '',
      undefined,
      (command, _parents, _cache, _sub, _isKey, _isValue, _key, context) => {
        context.logger.info('loaded hints');
        return { command, commands: ['leaf'] };
      },
    );
    try {
      await completeCommand({ command: 'logging-hints sub ', cursor: 18 });
      expect(output).toContainEqual(
        expect.objectContaining({
          windowId: outputWindowId,
          text: expect.stringContaining('loaded hints'),
        }),
      );
    } finally {
      unregisterPluginCommand('logging-hints');
      setLogSink();
    }
  });
  it('completes two levels with descriptions and only requests deeper hints in the last word', async () => {
    registerCommand(logger, 'hint-example', vi.fn(), 'hint-example', 'example description', [
      { name: 'list', description: '列出项目', execute: vi.fn() },
      { name: 'load', description: '加载项目', execute: vi.fn() },
    ]);
    expect((await completeCommand({ command: 'hint-ex', cursor: 7 })).items).toContainEqual({
      name: 'hint-example',
      insertText: 'hint-example',
      description: 'example description',
    });
    expect(
      (await completeCommand({ command: 'hint-example ', cursor: 13 })).items.map(
        (item) => item.name,
      ),
    ).toEqual(['list', 'load']);
    expect(
      (await completeCommand({ command: 'hint-example --flag ', cursor: 20 })).items.map(
        (item) => item.name,
      ),
    ).toEqual([]);
    expect(await completeCommand({ command: 'hint-example li', cursor: 15 })).toEqual({
      command: 'hint-example li',
      from: 13,
      to: 15,
      items: [{ name: 'list', insertText: 'list', description: '列出项目' }],
    });
    expect((await completeCommand({ command: 'hint-example list ', cursor: 18 })).items).toEqual(
      [],
    );
    expect(
      (await completeCommand({ command: 'hint-example li argument', cursor: 15 })).items,
    ).toEqual([]);
    unregisterPluginCommand('hint-example');
  });
  it('removes reloaded registrations and restores a surviving conflicting command name', () => {
    for (const id of ['conflict-a', 'conflict-b', 'conflict-c']) {
      registerCommand(logger, 'same-command', vi.fn(), id);
    }
    expect(getCommands().filter((item) => item.name.endsWith(':same-command'))).toHaveLength(3);
    unregisterPluginCommand('conflict-b');
    unregisterPluginCommand('conflict-c');
    expect(validateCommand('same-command').pluginId).toBe('conflict-a');
    unregisterPluginCommand('conflict-a');
    registerCommand(logger, 'same-command', vi.fn(), 'conflict-a');
    expect(validateCommand('same-command').pluginId).toBe('conflict-a');
    unregisterPluginCommand('conflict-a');
    expect(() => validateCommand('same-command')).toThrow('未知命令');
  });
  it('distinguishes system commands from business plugin commands in terminal discovery', () => {
    registerCommand(logger, 'test-system-discovery', vi.fn(), SYSTEM_SYMBOL);
    registerCommand(logger, 'test-business-discovery', vi.fn(), 'discovery-plugin');
    expect(getCommands().find((item) => item.name === 'test-system-discovery')?.system).toBe(true);
    expect(getCommands().find((item) => item.name === 'test-business-discovery')?.system).toBe(
      false,
    );
  });
  it('preserves quotes, empty arguments, whitespace and literal Windows paths', () => {
    expect(splitCommand('example "" "a b"\tC:\\Users\\name')).toEqual([
      'example',
      '',
      'a b',
      'C:\\Users\\name',
    ]);
    expect(() => splitCommand('example "unterminated')).toThrow('引号未闭合');
  });
  it('executes a failing subcommand once, never falling back to its main handler', async () => {
    const main = vi.fn();
    const sub = vi.fn(() => {
      throw new Error('sub failed');
    });
    registerCommand(logger, 'test-sub-single', main, 'test-single', '', [
      { name: 'fail', execute: sub },
    ]);
    await expect(parseAndRunCommands('test-sub-single fail')).rejects.toThrow('sub failed');
    expect(sub).toHaveBeenCalledOnce();
    expect(main).not.toHaveBeenCalled();
  });
  it('passes a fixed logger and the matching task context as the fifth argument', async () => {
    const execute = vi.fn();
    registerCommand(logger, 'test-scoped', execute, 'test-scoped');
    const registry = new TaskRegistry();
    const scope = registry.create('core', { windowId: 'window', executionId: 'execution' });
    await parseAndRunCommands('test-scoped "a b"', scope.context);
    expect(execute.mock.calls[0][0].windowId).toBe('window');
    expect(execute.mock.calls[0][0].executionId).toBe('execution');
    expect(execute.mock.calls[0][4].tasks).toBe(scope.reporter);
    scope.finish();
  });
  it('rejects stopped plugins before cancelling a task to replace them', () => {
    registerCommand(
      logger,
      'test-unavailable',
      () => undefined,
      'test-unavailable',
      '',
      [],
      [],
      '',
      () => false,
    );
    expect(() => validateCommand('test-unavailable')).toThrow('插件已停止');
  });
});
