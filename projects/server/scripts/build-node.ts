import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { BUILD_ROOT, buildRuntime } from './build-runtime.ts';
import {
  currentNodeInfo,
  type NodeBuildInfo,
  type ReleasePlatform,
  type ReleaseArch,
} from './node-runtime.ts';

export interface NodeBuildOptions {
  platform: ReleasePlatform;
  arch: ReleaseArch;
}
export function parseNodeBuildArgs(args: string[]): NodeBuildOptions {
  let platform = process.platform as ReleasePlatform;
  let arch = process.arch as ReleaseArch;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const [name, inline] = arg.split('=', 2);
    if (!['--platform', '--arch'].includes(name)) {
      throw new Error(`不支持的打包参数：${arg}`);
    }
    const value = inline ?? args[++index];
    if (name === '--platform') {
      platform = value as ReleasePlatform;
    } else {
      arch = value as ReleaseArch;
    }
  }
  if (!['win32', 'linux', 'darwin'].includes(platform) || !['x64', 'arm64'].includes(arch)) {
    throw new Error('平台只支持 win32/linux/darwin，架构只支持 x64/arm64');
  }
  return { platform, arch };
}

export function assertNativeBuild(options: NodeBuildOptions): void {
  if (options.platform !== process.platform || options.arch !== process.arch) {
    throw new Error(
      `请在 ${options.platform}-${options.arch} 的 Node 环境执行对应打包命令；不跨平台复用本机原生依赖。`,
    );
  }
  if (Number(process.versions.node.split('.')[0]) < 25) {
    throw new Error('Node 目录版构建需要 Node.js >=25');
  }
}

function assertChild(parent: string, target: string): void {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('构建目录超出输出边界');
  }
}

async function renameDirectory(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      const transient =
        process.platform === 'win32' &&
        error instanceof Error &&
        'code' in error &&
        ['EPERM', 'EBUSY', 'EACCES'].includes(String(error.code));
      if (!transient || attempt >= 5) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
  }
}

/** Build into a sibling staging directory; failed builds retain the previous release. */
export async function buildNodeDistribution(
  options: NodeBuildOptions,
  parent = path.join(BUILD_ROOT, 'dist/core-node'),
): Promise<string> {
  assertNativeBuild(options);
  const host = currentNodeInfo();
  const label =
    options.platform === 'win32' ? 'windows' : options.platform === 'darwin' ? 'macos' : 'linux';
  const name = `scwc-node-${label}-${options.arch}${host.libc === 'musl' ? '-musl' : ''}`;
  parent = path.resolve(parent);
  await fs.mkdir(parent, { recursive: true });
  const output = path.join(parent, name);
  const staging = await fs.mkdtemp(path.join(parent, '.scwc-node-build-'));
  const backup = path.join(parent, `.scwc-node-backup-${randomUUID()}`);
  for (const target of [output, staging, backup]) {
    assertChild(parent, target);
  }
  let saved = false;
  let published = false;
  try {
    const runtime = path.join(staging, 'runtime');
    const assets = await buildRuntime(runtime);
    await build({
      entryPoints: [path.join(BUILD_ROOT, 'projects/server/scripts/node-bootstrap.ts')],
      outfile: path.join(staging, 'start.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
      minify: true,
      keepNames: true,
    });
    const pkg = JSON.parse(await fs.readFile(path.join(BUILD_ROOT, 'package.json'), 'utf8')) as {
      version: string;
    };
    const info: NodeBuildInfo = {
      format: 'scwc-node/v1',
      version: pkg.version,
      platform: options.platform,
      arch: options.arch,
      ...(host.libc ? { libc: host.libc } : {}),
      minimumNodeMajor: 25,
      minimumNapi: 10,
      builtAt: new Date().toISOString(),
      builtWithNode: process.version,
    };
    await fs.writeFile(path.join(staging, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');
    await fs.writeFile(
      path.join(staging, 'package.json'),
      JSON.stringify(
        {
          name,
          version: pkg.version,
          private: true,
          type: 'commonjs',
          engines: { node: '>=25' },
          scripts: { start: 'node start.cjs' },
        },
        null,
        2,
      ) + '\n',
    );
    const launcher = options.platform === 'win32' ? 'start.ps1' : 'start.sh';
    const text = await fs.readFile(
      path.join(BUILD_ROOT, 'projects/server/scripts/launchers', launcher),
      'utf8',
    );
    await fs.writeFile(
      path.join(staging, launcher),
      (options.platform === 'win32' ? '\ufeff' : '') + text,
    );
    if (options.platform !== 'win32') {
      await fs.chmod(path.join(staging, launcher), 0o755);
    }
    await fs.mkdir(path.join(staging, 'plugins'), { recursive: true });
    await fs.mkdir(path.join(staging, 'terminal/plugins'), { recursive: true });
    await fs.copyFile(
      path.join(BUILD_ROOT, 'docs/core.env.example'),
      path.join(staging, '.env.example'),
    );
    await fs.copyFile(path.join(BUILD_ROOT, 'LICENSE'), path.join(staging, 'LICENSE'));
    await fs.writeFile(
      path.join(staging, 'README.md'),
      `# SCWC Node 目录版\n\n目标：${name}，需要匹配此平台/架构的 Node.js >=25；不内置 Node。\n\n复制 .env.example 为 .env 后按需配置；无需 Redis 时设置 REDIS_ENABLED=false。不复制开发环境的 .env、密码、业务插件或用户数据。\n\n启动：node start.cjs（默认终端）；node start.cjs --no-terminal（直接核心）；node start.cjs --build-plugin-web <插件目录>（内置前端构建）。\n\n${options.platform === 'win32' ? 'Windows 可执行 ./start.ps1' : 'Linux/macOS 可执行 ./start.sh 或 sh ./start.sh'}，启动器先读取本目录 .env 的 SCWC_NODE_PATH，再读取进程环境，未指定时从 PATH 查找合规 Node。路径相对本目录；显式无效路径不回退。PATH 第一项是旧 Node 时仍继续寻找。该配置键为单行路径，支持单双引号、export 与行尾注释，不执行 .env 中的内容。\n\n所有插件宿主、Worker、构建进程沿用同一 Node。默认业务插件目录 plugins/、终端插件目录 terminal/plugins/；内建 scwc 适配已合并进宿主。\n\nruntime/ 包含核心和宿主 CJS、共享原生依赖、前端白名单、Vite/esbuild/@scwc/vite-plugin、Web/scwcutils/静态资源；纯 JS 后端 SDK 导出合并在 bundle。业务私有依赖由插件提供。完整包文件与传递版本关系予以保留；Native 工具自身可能是可执行文件，不包含 Node 本体。\n\nruntime/manifest.json 是运行资源清单，build-info.json 是平台及 Node 要求。运行数据写入此部署目录的 data/cache 等目录。本目录可整体搬移；请将运行部署目录与 dist 构建输出分开，重新构建会替换旧输出。\n`,
    );
    // Validate the packaged resources rather than accidentally loading workspace copies.
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url'; import path from 'node:path';
const require=createRequire(path.join(process.argv[1],'check.cjs'));
const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close();
require('esbuild').transformSync('const value=1');
await require('esbuild').stop();
require('lightningcss').transform({filename:'check.css',code:Buffer.from('body { color: red }')});
await import(pathToFileURL(require.resolve('rolldown')).href);
`,
        runtime,
      ],
      { stdio: 'pipe', env: { ...process.env, NODE_OPTIONS: '' } },
    );
    await fs.writeFile(
      path.join(staging, 'contents.json'),
      JSON.stringify(
        {
          fileCount: assets.length,
          runtimeBytes: assets.reduce((sum, asset) => sum + asset.size, 0),
          browserPackages: (await import('../plugin/web/dependencies.ts')).sharedBrowserPackages,
          buildPackages: (await import('../plugin/web/dependencies.ts')).sharedBuildPackages,
        },
        null,
        2,
      ) + '\n',
    );
    const existing = await fs.lstat(output).catch(() => undefined);
    if (existing?.isSymbolicLink()) {
      throw new Error('输出目录不能是符号链接');
    }
    if (existing) {
      await renameDirectory(output, backup);
      saved = true;
    }
    try {
      await renameDirectory(staging, output);
      published = true;
    } catch (error) {
      if (saved) {
        try {
          await renameDirectory(backup, output);
          saved = false;
        } catch (rollback) {
          throw new Error(`发布失败（${String(error)}），旧发行目录保留于 ${backup}`, {
            cause: rollback,
          });
        }
      }
      throw error;
    }
    console.log(`Node 目录版：${output}`);
    return output;
  } finally {
    for (const target of [staging, backup]) {
      assertChild(parent, target);
    }
    await fs.rm(staging, { recursive: true, force: true });
    if (saved && published) {
      await fs.rm(backup, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void Promise.resolve()
    .then(() => buildNodeDistribution(parseNodeBuildArgs(process.argv.slice(2))))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
