import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/cache.ts', () => ({
  addErrorHandler: vi.fn(),
  createNamespacedCache: () => {
    const values = new Map<string, SCWC.TPluginCacheableData>();
    return {
      set: async (key: string, data: SCWC.TPluginCacheableData) => {
        values.set(key, data);
        return data;
      },
      get: async (key: string) => values.get(key),
      setRedirect: async (_key: string, target: string) => target,
      del: async (key: string) => values.delete(key),
      mdel: async () => true,
    };
  },
}));
vi.mock('../../utils/log.ts', () => ({
  createLogger: () => ({ info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../utils/command.ts', () => ({
  registerCommand: vi.fn(),
  CommandError: class extends Error {},
}));
vi.mock('../../common/env.ts', () => ({ TOKEN: '' }));
import { loadPlugins, plugins, inactivePlugins } from '../load.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const plugin of plugins.splice(0)) {
    await plugin.handler?.onUnload?.(plugin.logger, { isRestart: false });
  }
  inactivePlugins.length = 0;
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('default isolated v2 plugin loader', () => {
  it('isolates plugins with omitted or partial settings while startup fails or hangs', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-loader-'));
    roots.push(root);
    const runtime = {
      mode: 'process',
      apiVersion: 2,
      startupTimeoutMs: 1000,
      shutdownTimeoutMs: 100,
    };
    const fixture = fs.readFileSync(new URL('./fixtures/plugin.ts', import.meta.url), 'utf8');
    const definitions: { dir: string; runtime?: unknown; source: string; enabled?: boolean }[] = [
      {
        dir: '00-hang',
        runtime: { ...runtime, startupTimeoutMs: 300 },
        source:
          'export default { apiVersion: 2, onRequest() {}, onLoad() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000); } };',
      },
      { dir: '01-good', runtime, source: fixture },
      {
        dir: '02-default',
        runtime: undefined,
        source: 'export default { name: "default-plugin", onRequest() {}, onLoad() {} };',
      },
      {
        dir: '03-fail',
        runtime,
        source:
          'export default { apiVersion: 2, onRequest() {}, onLoad() { throw new Error("failed activation"); } };',
      },
      {
        dir: '04-invalid',
        runtime: { mode: 'process', apiVersion: 1 },
        source: 'throw new Error("must not import this");',
      },
      {
        dir: '05-partial',
        runtime: { requestTimeoutMs: 1000 },
        source: 'export default { onRequest() {} };',
      },
      {
        dir: '06-disabled',
        enabled: false,
        source: 'throw new Error("disabled plugin must not load");',
      },
    ];
    for (const item of definitions) {
      const dir = path.join(root, item.dir);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({
          name: item.dir,
          type: 'module',
          main: 'index.ts',
          runtime: item.runtime,
          enabled: item.enabled,
        }),
      );
      fs.writeFileSync(path.join(dir, 'index.ts'), item.source);
    }
    const loading = loadPlugins(root);
    await vi.waitFor(() =>
      expect(plugins.some((plugin) => plugin.pluginId === '01-good')).toBe(true),
    );
    await loading;
    expect(plugins.map((plugin) => plugin.pluginId).sort()).toEqual([
      '01-good',
      '02-default',
      '05-partial',
    ]);
    expect(plugins.find((plugin) => plugin.pluginId === '01-good')?.runtime).toMatchObject({
      status: 'ready',
      apiVersion: 2,
    });
    for (const plugin of plugins) {
      expect(plugin.runtime).toMatchObject({
        mode: 'process',
        status: 'ready',
        apiVersion: 2,
        pid: expect.any(Number),
      });
      expect(plugin.runtime?.pid).not.toBe(process.pid);
    }
    expect(inactivePlugins.map((plugin) => plugin.pluginId).sort()).toEqual([
      '00-hang',
      '03-fail',
      '04-invalid',
      '06-disabled',
    ]);
    expect(inactivePlugins.find((plugin) => plugin.pluginId === '03-fail')?.reason).toContain(
      'failed activation',
    );
    expect(inactivePlugins.find((plugin) => plugin.pluginId === '04-invalid')?.reason).toContain(
      '默认第二版契约',
    );
    expect((globalThis as { scwcFixturePid?: number }).scwcFixturePid).toBeUndefined();
  });
});
