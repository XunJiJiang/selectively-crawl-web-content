import fs from 'node:fs/promises';
import { createReadStream, openSync, closeSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { BUILD_ROOT } from './build-runtime.ts';
import {
  currentNodeInfo,
  type ReleasePlatform,
  type ReleaseArch,
} from './external-node-runtime.ts';
import { sharedPackageAssets } from './shared-package-assets.ts';

export interface ReleaseOptions {
  platform: ReleasePlatform;
  arch: ReleaseArch;
  terminalPlugins: boolean;
  corePlugins: 'none' | 'all' | 'enabled';
}
export type ReleaseKind = 'bundled-node' | 'external-node';

export function parseReleaseArgs(args: string[]): ReleaseOptions {
  const options: ReleaseOptions = {
    platform: process.platform as ReleasePlatform,
    arch: process.arch as ReleaseArch,
    terminalPlugins: false,
    corePlugins: 'none',
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const separator = arg.indexOf('=');
    const name = separator < 0 ? arg : arg.slice(0, separator);
    if (!['--platform', '--arch', '--terminal-plugins', '--core-plugins'].includes(name)) {
      throw new Error(`不支持的打包参数：${arg}`);
    }
    const value = separator < 0 ? args[++index] : arg.slice(separator + 1);
    if (!value || value.startsWith('--')) {
      throw new Error(`${name} 需要提供值`);
    }
    if (name === '--platform') {
      options.platform = value as ReleasePlatform;
    }
    if (name === '--arch') {
      options.arch = value as ReleaseArch;
    }
    if (name === '--terminal-plugins') {
      if (!['true', 'false'].includes(value)) {
        throw new Error('--terminal-plugins 只支持 true/false');
      }
      options.terminalPlugins = value === 'true';
    }
    if (name === '--core-plugins') {
      if (!['none', 'all', 'enabled'].includes(value)) {
        throw new Error('--core-plugins 只支持 none/all/enabled');
      }
      options.corePlugins = value as ReleaseOptions['corePlugins'];
    }
  }
  if (!['win32', 'linux', 'darwin'].includes(options.platform)) {
    throw new Error('平台只支持 win32/linux/darwin');
  }
  if (!['x64', 'arm64'].includes(options.arch)) {
    throw new Error('架构只支持 x64/arm64');
  }
  return options;
}

export function assertNativeBuild(options: Pick<ReleaseOptions, 'platform' | 'arch'>): void {
  if (options.platform !== process.platform || options.arch !== process.arch) {
    throw new Error(
      `请在 ${options.platform}-${options.arch} 的 Node 环境执行对应打包命令；不跨平台复用本机原生依赖。`,
    );
  }
}

export function releaseName(kind: ReleaseKind, info = currentNodeInfo()): string {
  const label =
    info.platform === 'win32' ? 'windows' : info.platform === 'darwin' ? 'macos' : 'linux';
  return `scwc-${kind}-${label}-${info.arch}${info.libc === 'musl' ? '-musl' : ''}`;
}

export function bundledExecutableName(): string {
  return releaseName('bundled-node') + (process.platform === 'win32' ? '.exe' : '');
}

export function releaseArchive(
  kind: ReleaseKind,
  parent = path.join(BUILD_ROOT, 'dist/core'),
): string {
  return path.join(parent, releaseName(kind) + '.zip');
}

export function printReleaseHelp(kind: ReleaseKind): void {
  console.log(
    `SCWC ${kind === 'bundled-node' ? '内置' : '外置'} Node 运行时版\n` +
      '--platform=win32|linux|darwin  默认当前系统，仅原生构建\n' +
      '--arch=x64|arm64              默认当前 Node 架构\n' +
      '--terminal-plugins=true|false 默认 false，排除 template\n' +
      '--core-plugins=none|all|enabled 默认 none，排除 template/test；enabled 按 package.json 的 enabled !== false 筛选\n' +
      '两份 plugin-env.d.ts 始终保留；ZIP 输出到 dist/core/，内含默认 .env。',
  );
}

/** Ship plugin code/resources and installed private production dependencies, never live data. */
async function copyPlugins(
  source: string,
  destination: string,
  enabledOnly: boolean,
  examples: string[],
) {
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (!entry.isDirectory() || examples.includes(entry.name)) {
      continue;
    }
    const directory = path.join(source, entry.name);
    const manifest = path.join(directory, 'package.json');
    const pkg = JSON.parse(await fs.readFile(manifest, 'utf8')) as {
      enabled?: boolean;
      dependencies?: Record<string, string>;
    };
    if (enabledOnly && pkg.enabled === false) {
      continue;
    }
    const target = path.join(destination, entry.name);
    await fs.cp(directory, target, {
      recursive: true,
      dereference: true,
      filter: (filename) => {
        const relative = path.relative(directory, filename);
        const parts = relative.split(path.sep);
        return (
          !parts.some((part) =>
            ['.git', '.aoci', 'node_modules', '.vscode', '.idea'].includes(part),
          ) &&
          !['data', 'cache', 'logs'].includes(parts[0]) &&
          !parts.some(
            (part) =>
              (part.startsWith('.env') && part !== '.env.example') ||
              part === 'AGENTS.md' ||
              part.startsWith('aoci.') ||
              part.endsWith('.tsbuildinfo'),
          )
        );
      },
    });
    for (const [relative, filename] of Object.entries(
      await sharedPackageAssets(directory, Object.keys(pkg.dependencies ?? {})),
    )) {
      const output = path.join(target, relative);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.copyFile(filename, output);
      if (process.platform !== 'win32') {
        await fs.chmod(output, (await fs.stat(filename)).mode & 0o777);
      }
    }
  }
}

export async function copyReleaseFiles(
  directory: string,
  options: ReleaseOptions,
  root = BUILD_ROOT,
): Promise<void> {
  for (const [source, destination, include, enabledOnly, examples] of [
    [
      'projects/server/plugins',
      'plugins',
      options.corePlugins !== 'none',
      options.corePlugins === 'enabled',
      ['template', 'test'],
    ],
    ['projects/terminal/plugins', 'terminal/plugins', options.terminalPlugins, false, ['template']],
  ] as const) {
    const target = path.join(directory, destination);
    await fs.mkdir(target, { recursive: true });
    await fs.copyFile(
      path.join(root, source, 'plugin-env.d.ts'),
      path.join(target, 'plugin-env.d.ts'),
    );
    if (include) {
      await copyPlugins(path.join(root, source), target, enabledOnly, [...examples]);
    }
  }
  await fs.copyFile(path.join(root, 'docs/core.env.example'), path.join(directory, '.env'));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(directory, 'LICENSE'));
}

/** Stream files into ZIP with Unix modes, then atomically replace only the final archive. */
export async function archiveRelease(directory: string, output: string): Promise<string> {
  await fs.mkdir(path.dirname(output), { recursive: true });
  const existing = await fs.lstat(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  });
  if (existing && !existing.isFile()) {
    throw new Error('压缩包输出必须是普通文件');
  }
  const temporary = path.join(path.dirname(output), `.scwc-archive-${randomUUID()}.zip`);
  const fd = openSync(temporary, 'wx');
  let bytes = 0;
  let entries = 0;
  let completed = false;
  const zip = new Zip((error, data, final) => {
    if (error) {
      throw error;
    }
    bytes += data.byteLength;
    if (bytes >= 0xffffffff) {
      throw new Error('ZIP 超过 4 GiB；fflate 不支持 ZIP64');
    }
    for (let offset = 0; offset < data.byteLength;) {
      offset += writeSync(fd, data, offset);
    }
    if (final) {
      completed = true;
    }
  });
  try {
    async function add(folder: string): Promise<void> {
      for (const item of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        const filename = path.join(folder, item.name);
        const stat = await fs.lstat(filename);
        if (!stat.isDirectory() && !stat.isFile()) {
          throw new Error(`归档不接受链接或特殊文件：${filename}`);
        }
        if (++entries > 65535 || stat.size >= 0xffffffff) {
          throw new Error('ZIP 超过 fflate 的 ZIP32 限制');
        }
        const name =
          path.relative(directory, filename).split(path.sep).join('/') +
          (stat.isDirectory() ? '/' : '');
        const file = stat.isDirectory()
          ? new ZipPassThrough(name)
          : new ZipDeflate(name, { level: 6 });
        file.os = 3;
        file.attrs = ((stat.mode & 0xffff) << 16) | (stat.isDirectory() ? 0x10 : 0);
        file.mtime = stat.mtime;
        zip.add(file);
        if (stat.isDirectory()) {
          file.push(new Uint8Array(), true);
          await add(filename);
        } else {
          for await (const chunk of createReadStream(filename)) {
            file.push(chunk as Buffer, false);
          }
          file.push(new Uint8Array(), true);
        }
      }
    }
    await add(directory);
    zip.end();
    if (!completed) {
      throw new Error('ZIP 未完整写入');
    }
  } finally {
    zip.terminate();
    closeSync(fd);
    if (!completed) {
      await fs.rm(temporary, { force: true });
    }
  }
  try {
    await fs.rename(temporary, output);
  } finally {
    await fs.rm(temporary, { force: true });
  }
  return output;
}
