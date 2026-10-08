import { describe, expect, it, vi } from 'vitest';
import { TaskRegistry } from '../common/tasks.ts';

vi.mock('../plugin/load.ts', () => ({
  plugins: [{ pluginId: 'page', pluginDir: '/plugins/page' }],
  inactivePlugins: [],
  configuredPluginDirectory: async () => '/plugins',
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

describe('global plugin page build command', () => {
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
