import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  error: vi.fn(async () => undefined),
  warn: vi.fn(async () => undefined),
}));
vi.mock('./default-browser.ts', () => ({
  detectDefaultBrowser: vi.fn(async () => ({
    name: 'Chrome',
    id: 'com.google.chrome',
    kind: 'chrome',
  })),
  defaultBrowserLaunch: vi.fn(async (_browser: unknown, url: string) => ({
    command: 'browser.exe',
    args: [url],
  })),
  extensionManager: (kind: string) =>
    kind === 'firefox' ? 'about:debugging#/runtime/this-firefox' : 'chrome://extensions/',
}));
vi.mock('open', () => ({ default: vi.fn() }));
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({
  default: { readFile: vi.fn(), access: vi.fn(async () => undefined) },
}));
vi.mock('../common/paths.ts', () => ({ ROOT: '/repo', APP_DIR: '/deployment', isPackaged: true }));
vi.mock('../common/env.ts', () => ({ HOST: 'http://localhost', ACTIVE_PORT: 3217 }));
vi.mock('../workbench/notifications.ts', () => ({ createNotificationLogger: () => fixtures }));
import open from 'open';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { detectDefaultBrowser } from './default-browser.ts';
import {
  browserExtensionDirectory,
  openBrowserExtensionInstaller,
  notifyBrowserExtensionUnsupported,
} from './browser-extension.ts';

function child() {
  const child = new ChildProcess();
  vi.spyOn(child, 'unref').mockImplementation(() => undefined);
  return child;
}
describe('browser extension installation handoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(detectDefaultBrowser).mockResolvedValue({
      name: 'Chrome',
      id: 'com.google.chrome',
      kind: 'chrome',
    });
    vi.mocked(fs.readFile).mockImplementation(async (file) =>
      JSON.stringify({
        manifest_version: 3,
        action: { default_popup: 'index.html' },
        background: String(file).includes('firefox')
          ? { scripts: ['background.js'] }
          : { service_worker: 'background.js' },
      }),
    );
    vi.mocked(spawn).mockReturnValue(child() as ReturnType<typeof spawn>);
  });
  afterEach(() => vi.useRealTimers());
  it('does not guess a package or browser when the default association is unknown', async () => {
    vi.mocked(detectDefaultBrowser).mockResolvedValue({
      name: 'Custom Browser',
      id: 'custom.browser',
      kind: 'unknown',
    });
    const result = await openBrowserExtensionInstaller();
    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('未选择或启动其他浏览器');
    expect(spawn).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('uses persistent sidecar assets and only opens the installation guide', async () => {
    const pending = openBrowserExtensionInstaller();
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;
    expect(browserExtensionDirectory).toBe(path.join('/deployment', 'browser-extension'));
    expect(result).toMatchObject({
      status: 'opened',
      variant: 'chromium',
      managerUrl: 'chrome://extensions/',
    });
    expect(result.url).toMatch(/^http:\/\/localhost:3217\/web\/browser-extension\/install\//);
    expect(result.message).toContain('安装向导');
    expect(result.directory).toBe(path.join(browserExtensionDirectory, 'chromium'));
    expect(open).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      'browser.exe',
      [result.url],
      expect.objectContaining({ windowsHide: true }),
    );
  });
  it('selects Firefox assets and clearly describes temporary installation of the unsigned package', async () => {
    vi.mocked(detectDefaultBrowser).mockResolvedValue({
      name: 'Firefox',
      id: 'org.mozilla.firefox',
      kind: 'firefox',
    });
    const pending = openBrowserExtensionInstaller();
    await vi.advanceTimersByTimeAsync(2100);
    const result = await pending;
    expect(result.variant).toBe('firefox');
    expect(result.message).toContain('Mozilla 签名');
    expect(result.message).toContain('manifest.json');
    expect(result.directory).toContain('firefox');
  });
  it('does not launch another browser or offer the Chromium ZIP when Safari is the default', async () => {
    vi.mocked(detectDefaultBrowser).mockResolvedValue({
      name: 'Safari',
      id: 'com.apple.Safari',
      kind: 'safari',
    });
    const result = await openBrowserExtensionInstaller();
    expect(result.status).toBe('unsupported');
    expect(result.message).toContain('缺少经过签名的容器应用');
    expect(spawn).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    await notifyBrowserExtensionUnsupported(result.message);
    expect(fixtures.warn).toHaveBeenCalledWith(
      '浏览器扩展暂时无法安装',
      expect.objectContaining({ message: result.message, systemNotification: true }),
    );
  });
  it('reports missing artifacts and detection errors without opening any application', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'));
    await expect(openBrowserExtensionInstaller()).rejects.toThrow('完整解压');
    vi.mocked(detectDefaultBrowser).mockRejectedValueOnce(new Error('registry denied'));
    await expect(openBrowserExtensionInstaller()).rejects.toThrow('无法识别');
    expect(spawn).not.toHaveBeenCalled();
  });
  it('notifies a confirmed late launcher failure after the initial handoff', async () => {
    const launcher = child();
    vi.mocked(spawn).mockReturnValueOnce(launcher as ReturnType<typeof spawn>);
    const pending = openBrowserExtensionInstaller();
    await vi.advanceTimersByTimeAsync(2100);
    await pending;
    launcher.emit('close', 4, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(fixtures.error).toHaveBeenCalledWith(
      '浏览器扩展安装唤起失败',
      expect.objectContaining({ message: '系统启动器退出：4' }),
    );
  });
});
