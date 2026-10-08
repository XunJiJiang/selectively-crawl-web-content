import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { RpcPeer } from '../process/rpc.ts';
import { PluginProcessError } from '../process/protocol.ts';
import { sharedPackageAssets } from '../../scripts/shared-package-assets.ts';
import { preparePluginWeb } from '../web/build.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const executable = path.join(root, 'dist/core', process.platform === 'win32' ? 'scwc.exe' : 'scwc');
const sticker = path.join(root, 'projects/server/plugins/scwc-plugin-sticker-management');
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('relocated sticker plugin with shared SDK', () => {
  for (const mode of ['source', 'executable'] as const) {
    it.skipIf(
      !existsSync(path.join(sticker, 'index.ts')) ||
        (mode === 'executable' && !existsSync(executable)),
    )(
      `activates read/write Workers and serves APIs from an unrelated directory in ${mode} mode`,
      async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-relocated-sticker-'));
        directories.push(directory);
        const plugin = path.join(directory, 'external plugins', path.basename(sticker));
        const data = path.join(directory, 'data');
        const temporary = path.join(directory, 'runtime-temp');
        await fs.mkdir(plugin, { recursive: true });
        await fs.mkdir(data);
        await fs.mkdir(temporary);
        for (const item of ['index.ts', 'package.json', 'src', 'shared', 'public', 'web/dist']) {
          const source = path.join(sticker, item);
          if (existsSync(source)) {
            await fs.cp(source, path.join(plugin, item), { recursive: true });
          }
        }
        // Only plugin-owned backend dependencies are provided. Core packages are absent.
        for (const [key, filename] of Object.entries(
          await sharedPackageAssets(sticker, ['image-dimensions', 'webpinfo', 'fflate']),
        )) {
          const destination = path.join(plugin, key);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(filename, destination);
        }
        for (const dependency of ['better-sqlite3', 'trash', 'zod', 'file-type']) {
          expect(existsSync(path.join(plugin, 'node_modules', dependency))).toBe(false);
        }
        const child = fork(
          fileURLToPath(new URL('../process/host.ts', import.meta.url)),
          mode === 'executable' ? ['--scwc-plugin-host'] : [],
          {
            execPath: mode === 'executable' ? executable : process.execPath,
            execArgv: [],
            cwd: data,
            detached: process.platform !== 'win32',
            serialization: 'advanced',
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: {
              ...process.env,
              NODE_OPTIONS: '',
              SCWC_RUNTIME_ROOT: undefined,
              TMP: temporary,
              TEMP: temporary,
              TMPDIR: temporary,
              REDIS_PORT: '9',
              REDIS_TIMEOUT: '100',
            },
          },
        );
        const peer = new RpcPeer((message, callback) => {
          if (child.connected) {
            child.send(message, callback);
          } else {
            callback(new Error('Plugin host disconnected'));
          }
        });
        peer.onCall = async (method, args) => {
          if (method !== 'web.prepare') {
            throw new Error('Unexpected host request');
          }
          await preparePluginWeb(
            plugin,
            path.join(plugin, 'index.ts'),
            (args as { entry: string }).entry,
            {
              info: () => undefined,
              pathInfo: () => undefined,
              warn: () => undefined,
              error: () => undefined,
            },
          );
        };
        child.on('message', (message) => peer.receive(message));
        child.on('error', (error) => peer.close(new PluginProcessError(error.message)));
        let stderr = '';
        child.stderr?.on('data', (chunk) => {
          stderr += String(chunk);
        });
        const exited = new Promise<void>((resolve) =>
          child.once('exit', () => {
            peer.close(new PluginProcessError(stderr || 'Plugin host exited'));
            resolve();
          }),
        );
        try {
          const manifest = await peer.call<{
            name: string;
            ui: { apis: { method: string; path: string }[] };
          }>(
            'initialize',
            {
              entry: path.join(plugin, 'index.ts'),
              name: 'sticker',
              pluginId: 'sticker',
              options: { mode: 'process', apiVersion: 2 },
            },
            25_000,
          );
          expect(manifest.name).toBe('sticker-management');
          const invoke = (route: string, payload: unknown = {}) => {
            const index = manifest.ui.apis.findIndex((api) => api.path === route);
            expect(index).toBeGreaterThanOrEqual(0);
            return peer.call<{ ok: boolean; data: Record<string, unknown> }>(
              'api',
              {
                identity: { executionId: 'sdk-test', windowId: 'sdk-test', sessionId: 'sdk-test' },
                payload: {
                  index,
                  data: payload,
                  request: {
                    method: manifest.ui.apis[index].method,
                    url: route,
                    params: {},
                    query: {},
                    headers: {},
                  },
                },
              },
              10_000,
            );
          };
          expect(await invoke('/api/bootstrap')).toMatchObject({ ok: true });
          expect(
            await invoke('/api/folders', {
              parentFolderUuid: '00000000-0000-4000-8000-000000000006',
              name: 'SDK folder',
            }),
          ).toMatchObject({ ok: true });
          expect(
            existsSync(path.join(data, 'data/sticker-management/db/sticker-management.sqlite')),
          ).toBe(true);
        } finally {
          await peer.call('unload', { isRestart: true }, 5000).catch(() => undefined);
          if (child.connected) {
            child.disconnect();
          }
          const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
          await exited;
          clearTimeout(timeout);
        }
      },
      40_000,
    );
  }
});
