import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('node:fs/promises', () => ({ access: vi.fn() }));
vi.mock('../common/env.ts', () => ({ HOST: 'http://localhost', ACTIVE_PORT: 3217 }));
vi.mock('../common/paths.ts', () => ({ ROOT: '/repo', SERVER_ROOT: '/core', isPackaged: false }));
vi.mock('../workbench/notifications.ts', () => ({
  createNotificationLogger: vi.fn(() => ({ error: vi.fn(async () => undefined) })),
}));
import open from 'open';
import { access } from 'node:fs/promises';
import { createNotificationLogger } from '../workbench/notifications.ts';
import { openUserScriptInstaller, userScriptPath, userScriptUrl } from './user-script.ts';

describe('userscript installation handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(access).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('uses the actual core port, normalizes bind addresses and never puts credentials in the URL', () => {
    expect(userScriptUrl('http://name:secret@0.0.0.0:3200/path?token=secret#hash', 3217)).toBe(
      'http://localhost:3217/web/userscript/scwc.user.js',
    );
    expect(userScriptUrl('http://[::]', 3218)).toContain('localhost:3218');
    expect(userScriptPath).toBe('/repo/dist/user-script/scwc.user.js');
    expect(() => userScriptUrl('file:///tmp/script', 3217)).toThrow('HTTP');
  });
  it('opens the default browser and distinguishes handoff from completed installation', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null });
    vi.mocked(open).mockResolvedValue(child as Awaited<ReturnType<typeof open>>);
    const pending = openUserScriptInstaller();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(open).toHaveBeenCalledWith('http://localhost:3217/web/userscript/scwc.user.js', {
      wait: false,
    });
    expect(result.message).toContain('无法确认扩展是否接管');
  });
  it('rejects missing artifacts without opening a browser', async () => {
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(openUserScriptInstaller()).rejects.toThrow('产物不存在');
    expect(open).not.toHaveBeenCalled();
  });
  it('publishes a notification if the system launcher fails after handoff returned', async () => {
    const child = Object.assign(new EventEmitter(), { exitCode: null });
    vi.mocked(open).mockResolvedValueOnce(child as Awaited<ReturnType<typeof open>>);
    const pending = openUserScriptInstaller();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    child.emit('close', 4, null);
    await vi.waitFor(() =>
      expect(createNotificationLogger).toHaveBeenCalledWith({ source: 'core', pluginId: null }),
    );
  });
  it('reports both spawn errors and a failed system launcher', async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(openUserScriptInstaller()).rejects.toThrow('无法在默认浏览器');
    const child = Object.assign(new EventEmitter(), { exitCode: null });
    vi.mocked(open).mockResolvedValueOnce(child as Awaited<ReturnType<typeof open>>);
    const pending = openUserScriptInstaller();
    const assertion = expect(pending).rejects.toThrow('系统启动器退出：3');
    await vi.advanceTimersByTimeAsync(0);
    child.emit('close', 3, null);
    await assertion;
  });
});
