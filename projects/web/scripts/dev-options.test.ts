import { afterEach, describe, expect, it, vi } from 'vitest';
import configure from '../vite.config.ts';
import { parseWebDevArgs } from './dev-options.ts';

afterEach(() => vi.unstubAllEnvs());

describe('Web development CLI', () => {
  it.each([['--core-port', '5174'], ['--core-port=5174']])(
    'consumes the core port and preserves Vite options: %j',
    (...coreArgs) => {
      expect(parseWebDevArgs(['--port', '5173', ...coreArgs, '--host', '127.0.0.1'])).toEqual({
        corePort: '5174',
        viteArgs: ['--port', '5173', '--host', '127.0.0.1'],
      });
    },
  );
  it('retains ordinary Vite invocation and arguments after the separator', () => {
    expect(parseWebDevArgs(['--mode=development', '--open'])).toEqual({
      corePort: undefined,
      viteArgs: ['--mode=development', '--open'],
    });
    expect(parseWebDevArgs(['--', '--core-port=5174'])).toEqual({
      corePort: undefined,
      viteArgs: ['--', '--core-port=5174'],
    });
  });
  it('uses the last explicit core port', () => {
    expect(parseWebDevArgs(['--core-port=4000', '--core-port', '5174']).corePort).toBe('5174');
  });
  it.each(['', '0', '65536', '-1', '1.5', 'abc', '--port'])('rejects invalid ports: %s', (port) => {
    expect(() => parseWebDevArgs(['--core-port', port])).toThrow('--core-port');
  });
  it('rejects a missing port', () => {
    expect(() => parseWebDevArgs(['--core-port'])).toThrow('--core-port');
  });
  it('overrides the configured core port for every proxy without changing PORT', () => {
    vi.stubEnv('HOST', 'http://localhost');
    vi.stubEnv('PORT', '4000');
    vi.stubEnv('SCWC_CORE_URL', 'https://127.0.0.1:5000/prefix/');
    vi.stubEnv('SCWC_WEB_CORE_PORT', '5174');
    const config = configure({ command: 'serve', mode: 'development' });
    const proxies = config.server?.proxy ?? {};
    expect(Object.keys(proxies)).toHaveLength(5);
    for (const proxy of Object.values(proxies)) {
      if (typeof proxy === 'string') {
        throw new Error('Expected proxy options');
      }
      expect(proxy.target).toBe('https://127.0.0.1:5174/prefix/');
      expect(proxy.changeOrigin).toBe(false);
    }
    expect(config.define?.['import.meta.env.PORT']).toBe('"5174"');
    expect(process.env.PORT).toBe('4000');
    expect(config.server?.port).toBe(3201);
    expect(config.server?.strictPort).toBe(true);
  });
  it('keeps the existing environment precedence when the CLI port is absent', () => {
    vi.stubEnv('HOST', 'http://localhost');
    vi.stubEnv('PORT', '4000');
    vi.stubEnv('SCWC_WEB_CORE_PORT', undefined);
    vi.stubEnv('SCWC_CORE_URL', 'http://127.0.0.1:5000');
    expect(proxyTarget()).toBe('http://127.0.0.1:5000');
    vi.stubEnv('SCWC_CORE_URL', undefined);
    expect(proxyTarget()).toBe('http://localhost:4000');
  });
});

function proxyTarget() {
  const proxy = configure({ command: 'serve', mode: 'development' }).server?.proxy?.['/web/api'];
  return typeof proxy === 'string' ? proxy : proxy?.target;
}
