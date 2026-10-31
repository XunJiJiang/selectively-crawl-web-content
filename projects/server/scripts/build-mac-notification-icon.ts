import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const command = promisify(execFile);
const resources = fileURLToPath(new URL('../public/resources/macos/', import.meta.url));

/** Regenerate the committed catalog on macOS with Xcode 26+; releases use this prebuilt asset. */
export async function buildMacNotificationIcon() {
  if (process.platform !== 'darwin') {
    throw new Error('重新生成 macOS 分层图标需要 macOS 和 Xcode 26 或更高版本');
  }
  const directory = await mkdtemp(path.join(tmpdir(), 'scwc-mac-icon-build-'));
  const staged = path.join(resources, `.Assets.car-${process.pid}.tmp`);
  try {
    const output = path.join(directory, 'compiled');
    await mkdir(output);
    await command(
      '/usr/bin/xcrun',
      [
        'actool',
        path.join(resources, 'SCWC.icon'),
        '--compile',
        output,
        '--platform',
        'macosx',
        '--target-device',
        'mac',
        '--minimum-deployment-target',
        '11.0',
        '--app-icon',
        'SCWC',
        '--output-partial-info-plist',
        path.join(directory, 'icon.plist'),
        '--output-format',
        'human-readable-text',
        '--errors',
        '--warnings',
      ],
      { timeout: 120_000 },
    );
    const catalog = path.join(output, 'Assets.car');
    if ((await stat(catalog)).size === 0) throw new Error('actool 未生成有效的分层图标资源');
    const { stdout } = await command('/usr/bin/assetutil', ['--info', catalog], {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const records = JSON.parse(stdout) as {
      AssetType?: string;
      Name?: string;
      LayerCount?: number;
    }[];
    const stacks = records.filter(
      (record) => record.AssetType === 'IconImageStack' && record.Name === 'SCWC',
    );
    if (stacks.length === 0 || stacks.some((stack) => stack.LayerCount !== 3)) {
      throw new Error('编译后的图标必须包含背景、选框和箭头三层');
    }
    await copyFile(catalog, staged);
    await rename(staged, path.join(resources, 'Assets.car'));
  } finally {
    await rm(staged, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildMacNotificationIcon();
}
