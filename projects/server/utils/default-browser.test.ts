import { describe, expect, it } from 'vitest';
import {
  browserKind,
  defaultBrowserLaunch,
  desktopCommand,
  extensionManager,
  macDefaultBrowserId,
  windowsExecutable,
} from './default-browser.ts';

describe('default browser selection and launch commands', () => {
  it('reads the exact macOS HTTP handler without depending on plist field order or Finder access', () => {
    expect(
      macDefaultBrowserId(
        '( { LSHandlerURLScheme = https; LSHandlerRoleAll = "org.mozilla.firefox"; }, { LSHandlerRoleAll = "com.google.Chrome"; LSHandlerURLScheme = http; } )',
      ),
    ).toBe('com.google.Chrome');
    expect(
      macDefaultBrowserId(
        '( { LSHandlerURLScheme = http; LSHandlerRoleAll = "com.apple.Safari"; } )',
      ),
    ).toBe('com.apple.Safari');
    expect(macDefaultBrowserId('()')).toBe('com.apple.Safari');
    expect(() =>
      macDefaultBrowserId('({ LSHandlerURLScheme = http; LSHandlerRoleAll = "-"; })'),
    ).toThrow('无效');
  });
  it.each([
    ['com.apple.Safari', 'safari'],
    ['com.apple.SafariTechnologyPreview', 'safari'],
    ['com.google.chrome.beta', 'chrome'],
    ['google-chrome.desktop', 'chrome'],
    ['MSEdgeHTM', 'edge'],
    ['com.microsoft.edgemac', 'edge'],
    ['org.chromium.Chromium', 'chromium'],
    ['brave-browser.desktop', 'brave'],
    ['FirefoxURL-0123', 'firefox'],
    ['firefox-esr.desktop', 'firefox'],
    ['com.operasoftware.Opera', 'opera'],
    ['vivaldi-stable.desktop', 'vivaldi'],
    ['unknown-browser', 'unknown'],
  ])('maps %s to %s', (id, expected) => {
    expect(browserKind(id)).toBe(expected);
  });
  it('extracts only the registered Windows executable without interpreting flags or placeholders', () => {
    expect(
      windowsExecutable(
        '"C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe" --single-argument "%1"',
      ),
    ).toBe('C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe');
    expect(windowsExecutable('C:\\Browser\\browser.exe -url "%1"')).toBe(
      'C:\\Browser\\browser.exe',
    );
    expect(() => windowsExecutable('cmd.exe /c start chrome')).toThrow('无效');
    expect(() => windowsExecutable('"C:\\Browser\\browser.exe')).toThrow('无效');
  });
  it('honors Linux desktop quoting and profile flags while removing URL field codes', () => {
    const launch = desktopCommand(
      '[Desktop Entry]\nName=Browser\nExec="/opt/Browser Beta/browser" --profile-directory="Profile 2" %U\n[Desktop Action Private]\nExec=wrong\n',
    );
    expect(launch).toEqual({
      command: '/opt/Browser Beta/browser',
      args: ['--profile-directory=Profile 2'],
    });
    expect(() => desktopCommand('[Desktop Entry]\nExec="unterminated')).toThrow('引号');
  });
  it('launches the detected macOS bundle and uses family-specific internal pages', async () => {
    expect(
      await defaultBrowserLaunch(
        { name: 'Chrome Beta', id: 'com.google.Chrome.beta', kind: 'chrome' },
        'chrome://extensions/',
        'darwin',
      ),
    ).toEqual({
      command: '/usr/bin/open',
      args: ['-b', 'com.google.Chrome.beta', 'chrome://extensions/'],
    });
    expect(extensionManager('edge')).toBe('edge://extensions/');
    expect(extensionManager('firefox')).toContain('about:debugging');
    expect(() => extensionManager('safari')).toThrow('没有可用');
  });
});
