import { createServer, request, type Server } from 'node:http';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({ host: 'http://127.0.0.1', token: 'startup-token' }));
vi.mock('../../common/env.ts', () => ({
  get HOST() {
    return startup.host;
  },
  get TOKEN() {
    return startup.token;
  },
}));

import { localConfig } from './local-config.ts';

let server: Server;
let origin: string;

beforeEach(async () => {
  startup.host = 'http://127.0.0.1';
  startup.token = 'startup-token';
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    next();
  });
  app.get('/web/local-config', localConfig);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('测试服务器未分配端口');
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

function getConfig(headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      request(
        `${origin}/web/local-config`,
        {
          headers: {
            Referer: `${origin}/web`,
            'X-SCWC-Local-Config': '1',
            'Sec-Fetch-Site': 'same-origin',
            ...headers,
          },
        },
        (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk) => (body += chunk));
          response.on('end', () =>
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body }),
          );
          response.on('error', reject);
        },
      )
        .on('error', reject)
        .end();
    },
  );
}

describe('local startup configuration', () => {
  it('returns the current token and actual listening port without bearer authentication', async () => {
    const response = await getConfig();
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body).data).toEqual({
      host: 'http://127.0.0.1',
      port: new URL(origin).port,
      token: startup.token,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    startup.token = '';
    expect(JSON.parse((await getConfig()).body).data.token).toBe('');
  });

  it.each<Record<string, string>>([
    { Origin: 'http://evil.example' },
    { Referer: 'http://127.0.0.1:1/web' },
    { Origin: 'https://127.0.0.1' },
    { Origin: 'null' },
    { Referer: '' },
    { Host: 'evil.example' },
    { 'X-SCWC-Local-Config': '' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Sec-Fetch-Site': 'same-site' },
  ])('rejects mismatched or missing page identity: %j', async (headers) => {
    const response = await getConfig(headers);
    expect(response.status).toBe(403);
    expect(response.body).not.toContain(startup.token);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['http://localhost', 'http://192.168.1.2', 'http://example.com'])(
    'does not expose a token for a different startup hostname: %s',
    async (host) => {
      startup.host = host;
      expect((await getConfig()).status).toBe(403);
    },
  );

  it('rejects a remote peer even when all URL headers match', () => {
    const req = {
      protocol: 'http',
      socket: { remoteAddress: '192.168.1.2', localPort: new URL(origin).port },
      get: (name: string) =>
        ({
          Host: new URL(origin).host,
          Referer: `${origin}/web`,
          'X-SCWC-Local-Config': '1',
        })[name],
    };
    const res = { removeHeader: vi.fn(), setHeader: vi.fn(), status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    localConfig(req as unknown as express.Request, res as unknown as express.Response);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
