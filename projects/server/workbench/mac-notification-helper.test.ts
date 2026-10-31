import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { prepareMacNotificationHelper } from './mac-notification-helper.ts';
import { notificationIconFile } from './notification-icon.ts';

vi.mock('../common/environment.ts', () => ({}));
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => {
    const callback = args.at(-1) as (error: null) => void;
    callback(null);
  },
}));

afterEach(() => vi.unstubAllEnvs());

it('installs the layered catalog, preserves the legacy icon and refreshes changed assets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-mac-icon-'));
  try {
    vi.stubEnv('SCWC_DATA_DIR', path.join(directory, 'data'));
    const source = path.join(directory, 'source.app');
    await fs.mkdir(path.join(source, 'Contents/MacOS'), { recursive: true });
    await fs.mkdir(path.join(source, 'Contents/Resources'));
    await fs.writeFile(path.join(source, 'Contents/MacOS/terminal-notifier'), 'fixture');
    await fs.writeFile(
      path.join(source, 'Contents/Info.plist'),
      '<plist><dict><key>CFBundleIconFile</key>\n<string>Terminal.icns</string><key>CFBundleIconName</key>\n<string>OldIcon</string></dict></plist>',
    );
    const executable = await prepareMacNotificationHelper(source, notificationIconFile());
    const app = path.resolve(executable, '../../..');
    const icns = await fs.readFile(path.join(app, 'Contents/Resources/SCWC.icns'));
    expect(icns.toString('ascii', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    expect(icns.toString('ascii', 8, 12)).toBe('ic08');
    expect(icns.readUInt32BE(12)).toBe(icns.length - 8);
    expect(icns.subarray(16)).toEqual(await fs.readFile(notificationIconFile()));
    const sourceCatalog = await fs.readFile(
      new URL('../public/resources/macos/Assets.car', import.meta.url),
    );
    const installedCatalog = path.join(app, 'Contents/Resources/Assets.car');
    expect(await fs.readFile(installedCatalog)).toEqual(sourceCatalog);
    const plist = await fs.readFile(path.join(app, 'Contents/Info.plist'), 'utf8');
    expect(plist).toMatch(/<key>CFBundleIconFile<\/key>\s*<string>SCWC.icns<\/string>/);
    expect(plist).toMatch(/<key>CFBundleIconName<\/key>\s*<string>SCWC<\/string>/);
    expect(plist.match(/<key>CFBundleIconName<\/key>/g)).toHaveLength(1);
    expect(plist.match(/<key>CFBundleIconFile<\/key>/g)).toHaveLength(1);

    const marker = path.join(app, 'Contents/Resources/SCWC-NotificationHelper.json');
    const originalMarker = await fs.readFile(marker, 'utf8');
    await prepareMacNotificationHelper(source, notificationIconFile());
    expect(await fs.readFile(marker, 'utf8')).toBe(originalMarker);

    const updatedCatalog = path.join(directory, 'updated.car');
    const updatedBytes = Buffer.concat([sourceCatalog, Buffer.alloc(1)]);
    await fs.writeFile(updatedCatalog, updatedBytes);
    await prepareMacNotificationHelper(source, notificationIconFile(), updatedCatalog);
    expect(await fs.readFile(installedCatalog)).toEqual(updatedBytes);
    expect(await fs.readFile(marker, 'utf8')).not.toBe(originalMarker);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
