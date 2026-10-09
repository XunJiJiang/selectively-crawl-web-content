import { describe, expect, it, vi } from 'vitest';
import {
  splitCommand,
  registerCommand,
  parseAndRunCommands,
  validateCommand,
  getCommands,
  SYSTEM_SYMBOL,
} from './command.ts';
import { TaskRegistry } from '../common/tasks.ts';

const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
describe('command invocation contract', () => {
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
