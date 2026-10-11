import { describe, expect, it, vi } from 'vitest';
import { TaskRegistry } from '../common/tasks.ts';

vi.mock('../plugin/load.ts', () => ({
  plugins: [
    { pluginId: 'page', pluginDir: '/plugins/page', handler: { ui: { entry: 'index.html' } } },
    { pluginId: 'headless', pluginDir: '/plugins/headless', handler: {} },
  ],
  inactivePlugins: [{ pluginId: 'disabled-page', handler: { ui: { entry: 'index.html' } } }],
  configuredPluginDirectory: async () => '/plugins',
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  reloadPlugin: vi.fn(),
}));
vi.mock('../common/env.ts', () => ({ TOKEN: '', ACTIVE_PORT: 3200, HOST: 'http://localhost' }));
vi.mock('../plugin/web/build.ts', () => ({ buildPluginWeb: vi.fn(async () => undefined) }));
vi.mock('../utils/command.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/command.ts')>()),
  registerCommand: vi.fn(),
}));
import { registerDefaultCommands } from './index.ts';
import { registerCommand } from '../utils/command.ts';
import { buildPluginWeb } from '../plugin/web/build.ts';
import { createCommandCompletionCache } from '../utils/commandCompletion.ts';

describe('global plugin page build command', () => {
  it('hints directory names for all built-in plugin arguments using live state and UI availability', async () => {
    const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
    registerDefaultCommands(logger);
    const complete = vi
      .mocked(registerCommand)
      .mock.calls.find((call) => call[1] === 'plugin')?.[9];
    expect(complete).toBeTypeOf('function');
    if (!complete) {
      throw new Error('Missing plugin candidate callback');
    }
    const request = async (sub: string, parents = ['plugin', sub], isKey = false) =>
      (
        await complete(
          `plugin ${sub} `,
          parents,
          createCommandCompletionCache(),
          sub,
          isKey,
          false,
          undefined,
          { signal: new AbortController().signal, logger },
        )
      ).commands;
    expect(await request('build-web')).toEqual(['page']);
    expect(await request('enable')).toEqual(['disabled-page']);
    expect(await request('disable')).toEqual(['page', 'headless']);
    expect(await request('reload')).toEqual(['page', 'headless']);
    expect(await request('ls')).toEqual([]);
    expect(await request('ps')).toEqual([]);
    expect(await request('build-web', ['plugin', 'build-web', 'page'])).toEqual([]);
    expect(await request('build-web', ['plugin', 'build-web'], true)).toEqual([]);
  });
  it('registers build-web, forwards the cancellation signal and rejects directory traversal', async () => {
    const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
    registerDefaultCommands(logger);
    const registration = vi.mocked(registerCommand).mock.calls.find((call) => call[1] === 'plugin');
    const command = registration?.[5]?.find((item) => item.name === 'build-web');
    if (!command) {
      throw new Error('Missing global build-web command');
    }
    const scope = new TaskRegistry().create('test', {
      executionId: 'build-test',
      windowId: 'build-window',
    });
    try {
      await command.execute(logger, [], [], ['plugin', 'build-web', 'page'], scope.context);
      expect(buildPluginWeb).toHaveBeenCalledWith('/plugins/page', logger, {
        signal: scope.context.signal,
      });
      await expect(
        command.execute(logger, [], [], ['plugin', 'build-web', '../outside'], scope.context),
      ).rejects.toThrow('用法');
    } finally {
      scope.finish();
    }
  });
});
