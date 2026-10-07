import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getAsset } from 'node:sea';

function main(): void {
  if (process.argv.includes('--help')) {
    console.log(
      'SCWC\n--terminal 启动多窗口终端\n--mode=dev|prod\n--port=<起始端口>\n--port-range=<最大偏移>\n--plugin-dir=<插件目录>\n配置：优先读取可执行文件同目录的 .env，缺省键读取环境变量。',
    );
    return;
  }
  const isHost = process.argv.includes('--scwc-plugin-host');
  const isTerminalHost = process.argv.includes('--scwc-terminal-plugin-host');
  const terminal = process.argv.includes('--terminal');
  let runtime = isHost || isTerminalHost ? process.env.SCWC_RUNTIME_ROOT : undefined;
  if (!runtime) {
    runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'scwc-runtime-'));
    const directory = runtime;
    process.once('exit', () => fs.rmSync(directory, { recursive: true, force: true }));
    const keys = JSON.parse(getAsset('manifest.json', 'utf8')) as string[];
    for (const key of keys) {
      const filename = path.join(runtime, key);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, Buffer.from(getAsset(key)));
    }
    process.env.SCWC_RUNTIME_ROOT = runtime;
  }
  const load = createRequire(path.join(runtime, 'bootstrap.cjs'));
  load(
    path.join(
      runtime,
      isHost
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
