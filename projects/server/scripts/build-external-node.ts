import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { BUILD_ROOT, buildRuntime } from './build-runtime.ts';
import { currentNodeInfo, type ExternalNodeBuildInfo } from './external-node-runtime.ts';
import {
  parseReleaseArgs,
  assertNativeBuild,
  releaseName,
  releaseArchive,
  copyReleaseFiles,
  archiveRelease,
  printReleaseHelp,
  type ReleaseOptions,
} from './release-package.ts';

/** Stage and validate the external Node release before replacing its ZIP. */
export async function buildExternalNodeDistribution(
  options: ReleaseOptions,
  parent = path.join(BUILD_ROOT, 'dist/core'),
): Promise<string> {
  assertNativeBuild(options);
  if (Number(process.versions.node.split('.')[0]) < 25) {
    throw new Error('外置 Node 运行时版构建需要 Node.js >=25');
  }
  const host = currentNodeInfo();
  const name = releaseName('external-node');
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-external-node-build-'));
  try {
    const runtime = path.join(staging, 'runtime');
    const assets = await buildRuntime(runtime);
    await build({
      entryPoints: [path.join(BUILD_ROOT, 'projects/server/scripts/external-node-bootstrap.ts')],
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
    const info: ExternalNodeBuildInfo = {
      format: 'scwc-external-node/v1',
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
    await copyReleaseFiles(staging, options);
    await fs.writeFile(
      path.join(staging, 'README.md'),
      `# SCWC 外置 Node 运行时版\n\n目标：${name}，需要匹配此平台/架构的 Node.js >=25、Node-API >=10；Linux libc 也须匹配。\n\n解压后编辑内置默认 .env（保留了注释）；无需 Redis 时设置 REDIS_ENABLED=false。\n\n启动：node start.cjs（默认多窗口终端）；node start.cjs --no-terminal（直接核心）；node start.cjs --build-plugin-web <插件目录>（内置前端构建）。\n\n${options.platform === 'win32' ? 'Windows 可执行 ./start.ps1' : 'Linux/macOS 可执行 ./start.sh 或 sh ./start.sh'}。启动器优先读取相邻 .env 的 SCWC_NODE_PATH，未指定时扫描 PATH 的合规 Node；相对路径按部署目录解析，显式无效路径不回退。支持单双引号、export 和行尾注释，不执行 .env 的内容。所有宿主、Worker 和构建进程沿用同一 Node。\n\n核心插件：${options.corePlugins}；附带终端插件：${options.terminalPlugins}。排除 template/test 示例及插件运行数据，两份 plugin-env.d.ts 始终保留。插件目录为 plugins/ 和 terminal/plugins/；内建 scwc 命令适配已编译进宿主。附带插件携带已安装的私有生产依赖，其外部系统工具仍需在部署机提供。\n\nruntime/ 包含七个 CJS 入口、共享原生包、前端白名单及 Vite/esbuild/@scwc/vite-plugin 和静态资源；保留包许可证、原生文件权限及传递版本层次。纯 JS 后端 SDK 合并进 bundle。没有 Node 本体，无需安装 Bun 或项目依赖。\n\nruntime/manifest.json 是资源清单，build-info.json 是目标平台和 Node 要求。缓存和终端状态写入解压目录。可整体搬移；不要将部署数据放入 dist/core/，重新构建会替换同名 ZIP。\n`,
    );
    // Resolve native dependencies from the staged package rather than the workspace.
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url'; import path from 'node:path';
const require=createRequire(path.join(process.argv[1],'check.cjs'));
const Database=require('better-sqlite3');const db=new Database(':memory:');db.prepare('select 1').get();db.close();
require('esbuild').transformSync('const value=1');await require('esbuild').stop();
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
          terminalPlugins: options.terminalPlugins,
          corePlugins: options.corePlugins,
        },
        null,
        2,
      ) + '\n',
    );
    const output = await archiveRelease(staging, releaseArchive('external-node', parent));
    console.log(`外置 Node 运行时版压缩包：${output}`);
    return output;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void Promise.resolve()
    .then(async () => {
      const args = process.argv.slice(2);
      if (args.includes('--help')) {
        return printReleaseHelp('external-node');
      }
      return buildExternalNodeDistribution(parseReleaseArgs(args));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
