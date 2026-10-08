import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getAsset } from 'node:sea';

function main(): void {
  if (process.argv.includes('--help')) {
    console.log(
      'SCWC\n默认启动多窗口终端\n--no-terminal 不启动终端，直接运行核心\n--terminal 显式启动终端（兼容旧用法）\n--mode=dev|prod\n--port=<起始端口>\n--port-range=<最大偏移>\n--plugin-dir=<插件目录>\n--build-plugin-web=<插件目录> 使用内置 Vite 构建页面\n配置：优先读取可执行文件同目录的 .env，缺省键读取环境变量。',
    );
    return;
  }
  const isHost = process.argv.includes('--scwc-plugin-host');
  const isTerminalHost = process.argv.includes('--scwc-terminal-plugin-host');
  const terminal = !process.argv.includes('--no-terminal');
  const isWebBuildHost = process.argv.includes('--scwc-web-build-host');
  const isWebBuildCli = process.argv.some(
    (arg) => arg === '--build-plugin-web' || arg.startsWith('--build-plugin-web='),
  );
  let runtime =
    isHost || isTerminalHost || isWebBuildHost ? process.env.SCWC_RUNTIME_ROOT : undefined;
  const created = !runtime;
  if (!runtime) {
    runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-runtime-'));
    const directory = runtime;
    process.once('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
    process.env.SCWC_RUNTIME_ROOT = runtime;
  }
  const buildReady = path.join(runtime, '.web-build-ready');
  const prepareBuild = (isWebBuildHost || isWebBuildCli) && !fs.existsSync(buildReady);
  if (created || prepareBuild) {
    const assets = JSON.parse(getAsset('manifest.json', 'utf8')) as {
      path: string;
      mode: number;
      size: number;
      scope: 'core' | 'web-build';
    }[];
    for (const asset of assets) {
      if ((asset.scope === 'core' && !created) || (asset.scope === 'web-build' && !prepareBuild)) {
        continue;
      }
      const filename = path.join(runtime, asset.path);
      if (fs.existsSync(filename) && fs.statSync(filename).size === asset.size) {
        continue;
      }
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, Buffer.from(getAsset(asset.path)));
      if (process.platform !== 'win32') {
        fs.chmodSync(filename, asset.mode);
      }
    }
    if (prepareBuild) {
      fs.writeFileSync(buildReady, 'ready');
    }
  }
  const load = createRequire(path.join(runtime, 'bootstrap.cjs'));
  load(
    path.join(
      runtime,
      isWebBuildHost
        ? 'web-build-host.cjs'
        : isWebBuildCli
          ? 'web-build-cli.cjs'
          : isHost
            ? 'host.cjs'
            : isTerminalHost
              ? 'terminal-host.cjs'
              : terminal
                ? 'terminal.cjs'
                : 'core.cjs',
    ),
  );
}

try {
  main();
} catch (error) {
  console.error('SCWC 启动失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
