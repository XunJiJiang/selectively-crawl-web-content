import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

async function settings(args: string[]) {
  vi.stubGlobal('process', { argv: ['node', 'server.ts', ...args] });
  return import('./setupParam.ts');
}

it('defaults to production and the localhost Vite port', async () => {
  const result = await settings([]);
  expect(result.isProd).toBe(true);
  expect(result.WEB_ORIGIN).toBe('http://localhost:3201');
});

it.each([
  ['--mode=dev', '--web-port=3215'],
  ['--mode', 'development', '--web-port', '3215'],
])('uses the supplied development port for %j', async (...args) => {
  const result = await settings(args);
  expect(result.isDev).toBe(true);
  expect(result.WEB_PORT).toBe(3215);
  expect(result.WEB_ORIGIN).toBe('http://localhost:3215');
});

it('accepts an explicit development host', async () => {
  const result = await settings(['--web-host=127.0.0.1', '--web-port=3215']);
  expect(result.WEB_ORIGIN).toBe('http://127.0.0.1:3215');
});

it.each(['0', '65536', 'invalid', '3.5'])('rejects invalid Vite port %s', async (port) => {
  await expect(settings([`--web-port=${port}`])).rejects.toThrow('--web-port');
});
