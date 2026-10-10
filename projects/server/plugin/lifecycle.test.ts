import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import express from 'express';
import WebSocket from 'ws';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../utils/cache.ts', () => ({
  addErrorHandler: vi.fn(),
  createNamespacedCache: () => ({}),
}));
vi.mock('../common/env.ts', () => ({ TOKEN: '' }));

import {
  loadPlugins,
  plugins,
  inactivePlugins,
  enablePlugin,
  disablePlugin,
  reloadPlugin,
} from './load.ts';
import { completeCommand, validateCommand } from '../utils/command.ts';
import apiRouter, { pluginResourceRouter } from '../router/web/api/load.ts';
import { pluginWebSocketRegistry } from '../router/web/websocket.ts';

describe('core plugin runtime lifecycle', () => {
  it('persists enable/disable, reloads fresh hosts and removes old commands, routes and sockets', async () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-lifecycle-')));
    const directory = path.join(root, 'life');
    fs.mkdirSync(directory);
    const pkgFile = path.join(directory, 'package.json');
    const sourceFile = path.join(directory, 'index.ts');
    fs.writeFileSync(
      pkgFile,
      JSON.stringify({
        type: 'module',
        main: 'index.ts',
        enabled: false,
        commandName: 'life-command',
      }),
    );
    fs.writeFileSync(path.join(directory, 'index.html'), '<html><body>life</body></html>');
    const writePlugin = (sub: string) =>
      fs.writeFileSync(
        sourceFile,
        `
      import fs from 'node:fs';
      const record = (event) => fs.appendFileSync(new URL('./events.txt', import.meta.url), event + '\\n');
      export default {
        onRequest() {},
        onLoad() { record('load'); },
        onUnload(_logger, state) { record('unload:' + state.isRestart); },
        pluginConfig: {command: {subCommands: [{name: '${sub}', description: '${sub} description', execute() {}}]}},
        ui: {entry: './index.html',
          api: [{path: '/value', method: 'GET', handler() {return '${sub}';}}],
          resources: [{path: '/text', handler() {return {kind: 'response', status: 200, body: '${sub}'};}}],
          websocket: [{path: 'events', onConnect(context) {context.send('ready');}}],
        },
      };
    `,
      );
    writePlugin('list');
    const app = express();
    app.use('/api', apiRouter);
    app.use('/resources', pluginResourceRouter);
    const server = createServer(app);
    pluginWebSocketRegistry.attach(server);
    let socket: WebSocket | undefined;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const enabled = () => JSON.parse(fs.readFileSync(pkgFile, 'utf8')).enabled;
    const events = () =>
      fs.readFileSync(path.join(directory, 'events.txt'), 'utf8').trim().split('\n');
    const active = () => plugins.find((item) => item.pluginId === 'life');
    const requireActive = () => {
      const plugin = active();
      if (!plugin) {
        throw new Error('测试插件未加载');
      }
      return plugin;
    };
    try {
      await loadPlugins(root);
      expect(active()).toBeUndefined();
      await Promise.all([enablePlugin('life'), enablePlugin('life')]);
      expect(enabled()).toBe(true);
      expect(events()).toEqual(['load']);
      const first = requireActive();
      expect(completeCommand({ command: 'life-command l', cursor: 14 }).items[0]?.description).toBe(
        'list description',
      );
      expect((await fetch(`${base}/api/${first.safeId}/value`)).status).toBe(200);
      expect(await (await fetch(`${base}/resources/${first.safeId}/text`)).text()).toBe('list');
      const connection = new WebSocket(
        `${base.replace('http:', 'ws:')}/web/websocket/plugin/${first.safeId}/events?site=${encodeURIComponent(base)}`,
        { origin: base },
      );
      socket = connection;
      await new Promise<void>((resolve, reject) => {
        connection.once('message', () => resolve());
        connection.once('error', reject);
      });
      const closed = new Promise<void>((resolve) => connection.once('close', () => resolve()));
      writePlugin('fresh');
      await reloadPlugin('life');
      await closed;
      const second = requireActive();
      expect(second.runtime?.pid).not.toBe(first.runtime?.pid);
      expect(second.safeId).not.toBe(first.safeId);
      expect(events()).toEqual(['load', 'unload:true', 'load']);
      expect((await fetch(`${base}/api/${first.safeId}/value`)).status).toBe(404);
      expect((await fetch(`${base}/resources/${first.safeId}/text`)).status).toBe(404);
      expect((await (await fetch(`${base}/api/${second.safeId}/value`)).json()).data).toBe('fresh');
      expect(
        completeCommand({ command: 'life-command ', cursor: 13 }).items.map((item) => item.name),
      ).toEqual(['fresh']);
      fs.writeFileSync(
        sourceFile,
        'export default {onRequest() {}, onLoad() {throw new Error("reload failure");}};',
      );
      await expect(reloadPlugin('life')).rejects.toThrow('reload failure');
      expect(active()).toBeUndefined();
      expect(() => validateCommand('life-command')).toThrow('未知命令');
      expect((await fetch(`${base}/api/${second.safeId}/value`)).status).toBe(404);
      writePlugin('restored');
      await enablePlugin('life');
      await disablePlugin('life');
      expect(enabled()).toBe(false);
      expect(events().at(-1)).toBe('unload:false');
      expect(() => validateCommand('life-command')).toThrow('未知命令');
      await loadPlugins(root);
      expect(active()).toBeUndefined();
      expect(inactivePlugins.filter((item) => item.pluginId === 'life')).toHaveLength(1);
      expect(() => enablePlugin('../life')).toThrow();
    } finally {
      socket?.terminate();
      if (active()) {
        await disablePlugin('life');
      }
      inactivePlugins.length = 0;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 15000);
});
