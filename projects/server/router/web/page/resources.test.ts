import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, request, type Server } from 'node:http';
import express from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('../../../common/env.ts', () => ({ SERVER_ROOT: fixture.root }));
vi.mock('../../../plugin/load.ts', () => ({ plugins: [] }));

let server: Server;
let port: number;

beforeAll(async () => {
  fixture.root = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-public-resources-'));
  for (const directory of [
    'router/web/page',
    'public/resources/macos/SCWC.icon',
    'public/resources/styles',
    'public/resources/svg',
    'public/resources/macos-public',
    'outside',
  ]) {
    await fs.mkdir(path.join(fixture.root, directory), { recursive: true });
  }
  for (const [file, content] of [
    ['router/web/page/worry.html', '<p>{{message}}</p>'],
    ['public/resources/macos/Assets.car', 'private catalog'],
    ['public/resources/macos/SCWC.icon/icon.json', '{"private":true}'],
    ['public/resources/styles/public.css', 'body { color: red; }'],
    ['public/resources/svg/scwc.svg', '<svg xmlns="http://www.w3.org/2000/svg" />'],
    ['public/resources/macos-public/readme.txt', 'public resource'],
    ['outside/secret.txt', 'outside resources'],
  ]) {
    await fs.writeFile(path.join(fixture.root, file), content);
  }
  for (const [target, alias] of [
    ['public/resources/macos', 'public/resources/alias-macos'],
    ['outside', 'public/resources/alias-outside'],
  ]) {
    await fs.symlink(path.join(fixture.root, target), path.join(fixture.root, alias), 'junction');
  }
  const { default: router } = await import('./index.ts');
  const app = express();
  app.use('/web/page', router);
  server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (fixture.root) await fs.rm(fixture.root, { recursive: true, force: true });
});

// Keep encoded separators and traversal intact instead of normalizing them in a URL parser.
function resource(suffix: string, method = 'GET') {
  return new Promise<{ status: number; text: string; type: string }>((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/web/page/resources' + suffix, method },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString('utf8'),
            type: res.headers['content-type'] ?? '',
          }),
        );
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

it('serves public styles and icons without requiring authentication', async () => {
  expect(await resource('/styles/public.css')).toMatchObject({
    status: 200,
    text: 'body { color: red; }',
    type: expect.stringContaining('text/css'),
  });
  expect(await resource('/svg/scwc.svg')).toMatchObject({
    status: 200,
    text: '<svg xmlns="http://www.w3.org/2000/svg" />',
  });
  expect(await resource('/macos-public/readme.txt')).toMatchObject({
    status: 200,
    text: 'public resource',
  });
});

it.each([
  '/macos',
  '/macos/',
  '/macos/Assets.car',
  '/macos/SCWC.icon/icon.json',
  '/MACOS/Assets.car',
  '/%6dacos/Assets.car',
  '/macos%2FAssets.car',
  '/macos%5CAssets.car',
  '/%6d%61%63%6f%73%2fSCWC.icon%2ficon.json',
  '/alias-macos/Assets.car',
  '/alias-outside/secret.txt',
  '/missing.txt',
  '/',
])('returns 404 for filtered or unavailable resource %s', async (suffix) => {
  expect(await resource(suffix)).toMatchObject({ status: 404, text: 'not found' });
});

it('also filters HEAD requests', async () => {
  expect(await resource('/macos/Assets.car', 'HEAD')).toMatchObject({ status: 404, text: '' });
});

it.each([
  '/styles/..%2fmacos/Assets.car',
  '/%2e%2e/outside/secret.txt',
  '/..%5Cmacos%5CAssets.car',
  '/%2Fmacos%2FAssets.car',
])('rejects invalid resource path %s', async (suffix) => {
  expect(await resource(suffix)).toMatchObject({ status: 400, text: 'invalid path' });
});
