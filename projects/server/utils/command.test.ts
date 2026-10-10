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
import { TaskRegistry } from '../common/tasks.ts';

const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
describe('command invocation contract', () => {
  it('completes two levels with descriptions, preserving cursor replacement ranges', () => {
    registerCommand(logger, 'hint-example', vi.fn(), 'hint-example', 'example description', [
      { name: 'list', description: '列出项目', execute: vi.fn() },
      { name: 'load', description: '加载项目', execute: vi.fn() },
    ]);
    expect(completeCommand({ command: 'hint-ex', cursor: 7 }).items).toContainEqual({
      name: 'hint-example',
      insertText: 'hint-example',
      description: 'example description',
    });
    expect(
      completeCommand({ command: 'hint-example ', cursor: 13 }).items.map((item) => item.name),
    ).toEqual(['list', 'load']);
    expect(
      completeCommand({ command: 'hint-example --flag ', cursor: 20 }).items.map(
        (item) => item.name,
      ),
    ).toEqual(['list', 'load']);
    expect(completeCommand({ command: 'hint-example li argument', cursor: 15 })).toEqual({
      from: 13,
      to: 15,
      items: [{ name: 'list', insertText: 'list', description: '列出项目' }],
    });
    expect(completeCommand({ command: 'hint-example list ', cursor: 18 }).items).toEqual([]);
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
