import fs from 'node:fs';
import { spawn } from 'node:child_process';

Object.assign(globalThis, { scwcFixturePid: process.pid });
let cache: SCWC.IPluginCache;
let logger: SCWC.TLogger;
let theme = 'light';

export default {
  apiVersion: 2,
  name: 'process-fixture',
  onLoad: async (log, context) => {
    logger = log;
    cache = context.cache;
    if (process.env.SCWC_FIXTURE_MODE === 'fail') {
      throw new Error('fixture startup failure');
    }
    if (process.env.SCWC_FIXTURE_MODE === 'hang') {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    }
    await cache.set('startup', { pid: process.pid, bytes: Buffer.from('loaded'), count: 2n });
  },
  onUnload: (_logger, { isRestart }) => {
    if (process.env.SCWC_FIXTURE_UNLOAD) {
      fs.writeFileSync(process.env.SCWC_FIXTURE_UNLOAD, String(isRestart));
    }
  },
  onRequest: ({ site }, log) => {
    log.toWeb(site.pathname, 'success');
  },
  pluginConfig: {
    command: {
      description: 'fixture command',
      execute: async (_log, _options, _unused, origin) => {
        await cache.set('command', origin);
      },
      subCommands: [
        {
          name: 'sub',
          execute: async () => {
            await cache.set('sub', true);
          },
        },
      ],
    },
    scripts: {
      title: 'fixture controls',
      controls: (_logger, { site }) => [
        {
          channel: 'echo',
          type: 'button',
          label: site.pathname,
          trigger: (_log, context) => ({
            type: 'notification',
            data: { type: 'success', message: String(context.relatedValues.label) },
          }),
        },
      ],
    },
  },
  ui: {
    entry: process.env.SCWC_FIXTURE_PAGE ?? '',
    html: () => `<html><body data-theme="${theme}">fixture page</body></html>`,
    api: ({ add }) =>
      add(
        {
          method: 'POST',
          path: '/echo/:uuid',
          handler: (data, { request }) => ({ pid: process.pid, data, request }),
        },
        { method: 'GET', path: '/cache', handler: () => cache.get('startup') },
        {
          method: 'POST',
          path: '/block',
          handler: (data) => {
            logger.info('blocking-started');
            Atomics.wait(
              new Int32Array(new SharedArrayBuffer(4)),
              0,
              0,
              Number(typeof data === 'number' ? data : (data as { duration: number }).duration),
            );
            return { finished: true };
          },
        },
        {
          method: 'POST',
          path: '/theme',
          handler: (data) => {
            theme = String(data);
            return theme;
          },
        },
        { method: 'POST', path: '/crash', handler: () => process.exit(42) },
        {
          method: 'POST',
          path: '/descendant',
          handler: () =>
            spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }).pid,
        },
        { method: 'GET', path: '/oversize', handler: () => Buffer.alloc(17 * 1024 * 1024) },
      ),
    resources: [
      {
        path: '/media',
        handler: (_data, { request }) =>
          request.query.ticket === 'valid'
            ? {
                kind: 'file',
                path: process.env.SCWC_FIXTURE_MEDIA ?? '',
                contentType: 'application/octet-stream',
                headers: { 'Cache-Control': 'private, max-age=60' },
              }
            : { kind: 'response', status: 404, body: 'not found' },
      },
      {
        path: '/download',
        handler: () => ({
          kind: 'file',
          path: process.env.SCWC_FIXTURE_MEDIA ?? '',
          downloadName: 'fixture.bin',
        }),
      },
    ],
    websocket: [
      {
        path: 'events',
        onConnect: (context) => {
          context.send({ ready: true, connectionId: context.connectionId });
          return () => logger.info('socket-cleaned');
        },
        onMessage: (data, context) => context.broadcast(data),
        onClose: () => logger.info('socket-closed'),
      },
    ],
  },
} satisfies SCWC.IProcessPluginHandler;
