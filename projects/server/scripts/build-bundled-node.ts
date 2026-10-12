import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { BUILD_ROOT, buildRuntime } from './build-runtime.ts';
import {
  parseReleaseArgs,
  assertNativeBuild,
  bundledExecutableName,
  releaseArchive,
  copyReleaseFiles,
  archiveRelease,
  printReleaseHelp,
  type ReleaseOptions,
} from './release-package.ts';

export async function buildBundledNodeDistribution(options: ReleaseOptions): Promise<string> {
  assertNativeBuild(options);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(
      '内置 Node 运行时版构建需要 Node.js >=25.5（--build-sea）；源码服务仍支持 Node.js 24。',
    );
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-bundled-node-build-'));
  try {
    const runtime = path.join(temporary, 'runtime');
    const distribution = path.join(temporary, 'distribution');
    await fs.mkdir(distribution);
    const manifest = await buildRuntime(runtime);
    const bootstrap = path.join(temporary, 'bootstrap.cjs');
    await build({
      entryPoints: [path.join(BUILD_ROOT, 'projects/server/scripts/sea-bootstrap.ts')],
      outfile: bootstrap,
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      minify: true,
    });
    const assets: Record<string, string> = Object.fromEntries(
      manifest.map((asset) => [asset.path, path.join(runtime, asset.path)]),
    );
    assets['manifest.json'] = path.join(runtime, 'manifest.json');
    const executable = bundledExecutableName();
    const output = path.join(distribution, executable);
    const config = path.join(temporary, 'sea-config.json');
    await fs.writeFile(
      config,
      JSON.stringify({
        main: bootstrap,
        output,
        disableExperimentalSEAWarning: true,
        useCodeCache: false,
        useSnapshot: false,
        assets,
      }),
    );
    execFileSync(process.execPath, ['--build-sea', config], { stdio: 'inherit' });
    if (process.platform === 'darwin') {
      execFileSync('codesign', ['--sign', '-', output], { stdio: 'inherit' });
    }
    if (process.platform !== 'win32') {
      await fs.chmod(output, 0o755);
    }
    await copyReleaseFiles(distribution, options);
    await fs.writeFile(
      path.join(distribution, 'README.md'),
      `# SCWC 内置 Node 运行时版\n\n已内置 Node，无需安装 Node 或 Bun。产物仅适用于 ${options.platform}-${options.arch}${process.platform === 'linux' ? ' 及构建机同类 libc' : ''}。\n\n解压后编辑默认 .env；无需 Redis 时设置 REDIS_ENABLED=false。运行 ${process.platform === 'win32' ? '.\\' : './'}${executable} 默认打开多窗口终端，加 --no-terminal 直接运行核心；--build-plugin-web <插件目录> 使用内置 Vite 构建页面。\n\n核心插件：${options.corePlugins}；附带终端插件：${options.terminalPlugins}。排除 template/test 示例及运行数据；两份 plugin-env.d.ts 始终保留。默认插件目录 plugins/ 和 terminal/plugins/；内建 scwc 命令适配已编译进宿主。附带插件携带已安装私有生产依赖，外部系统工具仍需在部署机提供。\n\n读取可执行文件相邻 .env，不读取启动工作目录的配置。运行资源释放到私有系统临时目录，正常退出时删除；缓存和终端状态保存在部署目录。\n`,
    );
    const archive = await archiveRelease(distribution, releaseArchive('bundled-node'));
    console.log(`内置 Node 运行时版压缩包：${archive}`);
    return archive;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  void Promise.resolve()
    .then(async () => {
      const args = process.argv.slice(2);
      if (args.includes('--help')) {
        return printReleaseHelp('bundled-node');
      }
      return buildBundledNodeDistribution(parseReleaseArgs(args));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
