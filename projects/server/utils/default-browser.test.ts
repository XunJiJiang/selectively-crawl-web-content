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
  it('reads the exact macOS HTTP handler despite nested preferred versions and plist field order', () => {
    expect(
      macDefaultBrowserId(
        JSON.stringify({
          LSHandlers: [
            { LSHandlerURLScheme: 'https', LSHandlerRoleAll: 'org.mozilla.firefox' },
            {
              LSHandlerPreferredVersions: { LSHandlerRoleAll: '-' },
              LSHandlerRoleAll: 'com.google.Chrome',
              LSHandlerModificationDate: 0,
              LSHandlerURLScheme: 'http',
            },
          ],
        }),
      ),
    ).toBe('com.google.Chrome');
    expect(
      macDefaultBrowserId(
        JSON.stringify({
          LSHandlers: [{ LSHandlerURLScheme: 'http', LSHandlerRoleAll: 'com.apple.Safari' }],
        }),
      ),
    ).toBe('com.apple.Safari');
    expect(macDefaultBrowserId('{"LSHandlers":[]}')).toBe('com.apple.Safari');
  });
  it.each([undefined, '-', '', 123, 'invalid bundle id'])(
    'rejects an invalid explicit HTTP handler %s instead of reporting Safari',
    (id) => {
      expect(() =>
        macDefaultBrowserId(
          JSON.stringify({
            LSHandlers: [{ LSHandlerURLScheme: 'http', LSHandlerRoleAll: id }],
          }),
        ),
      ).toThrow('无效');
    },
  );
  it.each(['not a plist', '{}', '{"LSHandlers":{}}'])(
    'rejects unreadable registration data %s instead of reporting Safari',
    (text) => {
      expect(() => macDefaultBrowserId(text)).toThrow();
    },
  );
  it('does not treat a nested preferred version as the registered browser', () => {
    expect(() =>
      macDefaultBrowserId(
        JSON.stringify({
          LSHandlers: [
            {
              LSHandlerURLScheme: 'http',
              LSHandlerPreferredVersions: { LSHandlerRoleAll: 'com.google.Chrome' },
            },
          ],
        }),
      ),
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
