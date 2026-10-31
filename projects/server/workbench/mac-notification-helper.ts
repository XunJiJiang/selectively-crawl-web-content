import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, writeFile, rename, rm, open, lstat } from 'node:fs/promises';
import path from 'node:path';
import '../common/environment.ts';
import { ENV_DIR, SERVER_ROOT } from '../common/paths.ts';

const command = promisify(execFile);
const registrationTool =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const bundleID = 'com.scwc.notifications';
const owner = 'selectively-crawl-web-content';
const markerName = 'SCWC-NotificationHelper.json';
const markerPath = (app: string) => path.join(app, 'Contents/Resources', markerName);
const executable = (app: string) => path.join(app, 'Contents/MacOS/terminal-notifier');

async function marker(app: string): Promise<{ owner: string; fingerprint: string } | undefined> {
  try {
    return JSON.parse(await readFile(markerPath(app), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
async function lockFile(filename: string) {
  const deadline = Date.now() + 20000;
  while (true) {
    try {
      const file = await open(filename, 'wx', 0o600);
      await file.writeFile(String(process.pid));
      return async () => {
        await file.close();
        await rm(filename, { force: true });
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Only retire a lock when its owner is provably no longer running.
      try {
        const pid = Number(await readFile(filename, 'utf8'));
        if (Number.isSafeInteger(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (reason) {
            if ((reason as NodeJS.ErrnoException).code === 'ESRCH') {
              await rm(filename, { force: true });
              continue;
            }
          }
        }
      } catch (reason) {
        if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
      }
      if (Date.now() >= deadline) throw new Error('SCWC 通知辅助应用正在更新，请稍后重试');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

/** Keep one registered app identity across core restarts so macOS can retain consent. */
export async function prepareMacNotificationHelper(
  source: string,
  icon: string,
  catalog = path.join(SERVER_ROOT, 'public/resources/macos/Assets.car'),
) {
  const directory = path.join(path.resolve(ENV_DIR, process.env.SCWC_DATA_DIR || 'data'), 'scwc');
  const app = path.join(directory, 'SCWC Notifications.app');
  await mkdir(directory, { recursive: true });
  const release = await lockFile(path.join(directory, '.scwc-notification-helper.lock'));
  try {
    try {
      const destination = await lstat(app);
      if (!destination.isDirectory() || destination.isSymbolicLink()) {
        throw new Error(`通知应用路径不是独立应用目录：${app}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const png = await readFile(icon);
    const catalogData = await readFile(catalog);
    const fingerprint = createHash('sha256')
      .update('SCWC-notification-helper-v4')
      .update(png)
      .update(catalogData)
      .update(await readFile(executable(source)))
      .update(await readFile(path.join(source, 'Contents/Info.plist')))
      .digest('hex');
    const existing = await marker(app);
    if (existing && existing.owner !== owner) throw new Error(`通知应用路径被其他应用占用：${app}`);
    let reusable = existing?.fingerprint === fingerprint;
    if (reusable) {
      try {
        await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], {
          timeout: 15000,
        });
      } catch {
        reusable = false;
      }
    }
    if (!reusable) {
      // Never replace an unrelated application merely because its name matches ours.
      try {
        const destination = await lstat(app);
        if (!existing || !destination.isDirectory() || destination.isSymbolicLink())
          throw new Error(`通知应用路径已有非 SCWC 托管的应用：${app}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      const stage = await mkdtemp(path.join(directory, '.scwc-notification-stage-'));
      const candidate = path.join(stage, 'SCWC Notifications.app');
      const backup = path.join(stage, 'previous.app');
      let backedUp = false;
      let installed = false;
      try {
        await cp(source, candidate, { recursive: true });
        const plistPath = path.join(candidate, 'Contents/Info.plist');
        let plist = await readFile(plistPath, 'utf8');
        for (const [key, value] of Object.entries({
          CFBundleIdentifier: bundleID,
          CFBundleName: 'SCWC',
          CFBundleDisplayName: 'SCWC',
          CFBundleIconFile: 'SCWC.icns',
          CFBundleIconName: 'SCWC',
        })) {
          const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
          plist = pattern.test(plist)
            ? plist.replace(pattern, `$1${value}$2`)
            : plist.replace('</dict>', `<key>${key}</key><string>${value}</string></dict>`);
        }
        await writeFile(plistPath, plist);
        await writeFile(path.join(candidate, 'Contents/Resources/Assets.car'), catalogData);
        const header = Buffer.alloc(16);
        header.write('icns');
        header.writeUInt32BE(png.length + 16, 4);
        header.write('ic08', 8); // 256×256 PNG exported from the SVG source.
        header.writeUInt32BE(png.length + 8, 12);
        await writeFile(
          path.join(candidate, 'Contents/Resources/SCWC.icns'),
          Buffer.concat([header, png]),
        );
        await writeFile(markerPath(candidate), JSON.stringify({ owner, fingerprint }));
        await command('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', candidate], {
          timeout: 15000,
        });
        await command('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], {
          timeout: 15000,
        });
        if (existing) {
          await rename(app, backup);
          backedUp = true;
        }
        try {
          await rename(candidate, app);
          installed = true;
        } catch (error) {
          if (backedUp) {
            await rename(backup, app);
            backedUp = false;
          }
          throw error;
        }
      } finally {
        // Preserve the previous app if a concurrent filesystem change prevents rollback.
        if (!backedUp || installed) await rm(stage, { recursive: true, force: true });
      }
    }
    // A valid signature alone does not make a copied app known to notification services.
    await command(registrationTool, ['-f', app], { timeout: 15000 });
    return executable(app);
  } finally {
    await release();
  }
}
