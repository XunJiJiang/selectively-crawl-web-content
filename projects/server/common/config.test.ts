import { describe, expect, it, vi } from 'vitest';
import {
  parseStartupArgs,
  pluginDirectorySettings,
  portSettings,
  redisSettings,
} from './config.ts';
import { resolvePluginDirectory } from './pluginDirectory.ts';

describe('startup configuration', () => {
  it('supports both CLI forms and preserves equals signs in values', () => {
    expect(parseStartupArgs(['--plugin-dir', '/tmp/a=b c', '--port=3210'])).toEqual({
      'plugin-dir': '/tmp/a=b c',
      port: '3210',
    });
  });
  it('uses environment values and lets CLI port settings override them', () => {
    expect(portSettings({ PORT: '4000', PORT_SEARCH_RANGE: '3' })).toEqual({
      port: 4000,
      range: 3,
    });
    expect(
      portSettings({ PORT: '4000', PORT_SEARCH_RANGE: '3' }, { port: '5000', 'port-range': '0' }),
    ).toEqual({ port: 5000, range: 0 });
    expect(portSettings({ PORT: '65535' })).toEqual({ port: 65535, range: 0 });
  });
  it.each([
    { PORT: '0' },
    { PORT: '65536' },
    { PORT: '3.5' },
    { PORT: 'NaN' },
    { PORT_SEARCH_RANGE: '-1' },
    { PORT: '65535', PORT_SEARCH_RANGE: '1' },
  ])('rejects invalid port configuration %j', (env) => {
    expect(() => portSettings(env)).toThrow();
  });
  it('rejects startup options with missing values', () => {
    expect(() => portSettings({}, { port: true })).toThrow('--port');
  });
});

describe('Redis configuration', () => {
  it('supports password-only authentication with literal special characters', () => {
    const settings = redisSettings({
      REDIS_HOST: '[::1]',
      REDIS_PORT: '6380',
      REDIS_PASSWORD: 'p@ss:/?#%',
      REDIS_KEY_PREFIX: 'instance-a',
    });
    expect(settings.connection).toEqual({
      socket: { host: '::1', port: 6380, connectTimeout: 5000 },
      password: 'p@ss:/?#%',
    });
    expect(settings.namespace).toBe('instance-a');
  });
  it('supports ACL authentication and timeout', () => {
    expect(
      redisSettings({ REDIS_USER: 'alice', REDIS_PASSWORD: 'secret', REDIS_TIMEOUT: '1000' })
        .connection,
    ).toEqual({
      socket: { host: '127.0.0.1', port: 6379, connectTimeout: 1000 },
      username: 'alice',
      password: 'secret',
    });
  });
  it.each([
    { REDIS_PORT: '0' },
    { REDIS_PORT: '65536' },
    { REDIS_TIMEOUT: '0' },
    { REDIS_HOST: 'http://localhost' },
    { REDIS_KEY_PREFIX: '' },
    { REDIS_KEY_PREFIX: '*' },
    { REDIS_KEY_PREFIX: 'other[ab]' },
  ])('rejects invalid Redis configuration %j', (env) => {
    expect(() => redisSettings(env)).toThrow();
  });
});

describe('plugin directory selection', () => {
  const options = {
    env: {},
    args: {},
    appDir: '/deploy',
    root: '/repo',
    envDir: '/config',
    cwd: '/launch',
    isDev: false,
  };
  it('resolves defaults by mode independently of cwd', async () => {
    expect(await resolvePluginDirectory(pluginDirectorySettings(options))).toBe('/deploy/plugins');
    expect(await resolvePluginDirectory(pluginDirectorySettings({ ...options, isDev: true }))).toBe(
      '/repo/projects/server/plugins',
    );
  });
  it('resolves environment paths beside the environment file', async () => {
    expect(
      await resolvePluginDirectory(
        pluginDirectorySettings({ ...options, env: { SCWC_PLUGIN_DIR: './custom' } }),
      ),
    ).toBe('/config/custom');
  });
  it('accepts a CLI path without confirmation when the environment has no path', async () => {
    const confirm = vi.fn(async () => false);
    expect(
      await resolvePluginDirectory(
        pluginDirectorySettings({ ...options, args: { 'plugin-dir': './custom' } }),
        confirm,
      ),
    ).toBe('/launch/custom');
    expect(confirm).not.toHaveBeenCalled();
  });
  it('keeps the environment directory on cancellation and only overrides after confirmation', async () => {
    const settings = pluginDirectorySettings({
      ...options,
      env: { SCWC_PLUGIN_DIR: './env' },
      args: { 'plugin-dir': './cli' },
    });
    const decline = vi.fn(async () => false);
    const accept = vi.fn(async () => true);
    expect(await resolvePluginDirectory(settings, decline)).toBe('/config/env');
    expect(await resolvePluginDirectory(settings, accept)).toBe('/launch/cli');
    expect(decline).toHaveBeenCalledOnce();
    expect(accept).toHaveBeenCalledOnce();
  });
});
