import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const startup = vi.hoisted(() => ({
  args: { mode: 'dev' } as Record<string, string | boolean>,
  info: vi.fn(),
}));
vi.mock('./environment.ts', () => ({}));
vi.mock('./logger.ts', () => ({ serverLogger: { info: startup.info } }));
vi.mock('./setupParam.ts', () => ({
  get parsedArgs() {
    return startup.args;
  },
}));

beforeEach(() => {
  vi.resetModules();
  startup.info.mockClear();
  startup.args = { mode: 'dev' };
  vi.stubEnv('PORT', '4321');
  vi.stubEnv('PORT_SEARCH_RANGE', '20');
  vi.stubEnv('TOKEN', 'test-token');
});
afterEach(() => vi.unstubAllEnvs());

it('exports a fixed development port and explains the ignored range through the server logger', async () => {
  const env = await import('./env.ts');
  expect(env.PORT).toBe(4321);
  expect(env.PORT_SEARCH_RANGE).toBe(0);
  expect(startup.info).toHaveBeenCalledWith(
    '开发环境下核心端口自增配置 PORT_SEARCH_RANGE=20 将被忽略，固定使用端口 4321',
  );
});

it('preserves the production range without reporting it as ignored', async () => {
  startup.args = { mode: 'prod' };
  const env = await import('./env.ts');
  expect(env.PORT_SEARCH_RANGE).toBe(20);
  expect(startup.info.mock.calls.some(([message]) => String(message).includes('将被忽略'))).toBe(
    false,
  );
});
