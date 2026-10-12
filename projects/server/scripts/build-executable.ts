import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { BUILD_ROOT, buildRuntime } from './build-runtime.ts';

async function main(): Promise<void> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(
      '独立可执行文件构建需要 Node.js >= 25.5（--build-sea）；源码服务仍支持 Node.js 24。',
    );
  }
  const outputDir = path.join(BUILD_ROOT, 'dist/core');
  await fs.mkdir(outputDir, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-build-'));
  if (path.dirname(temporary) !== path.resolve(os.tmpdir())) {
    throw new Error('构建临时目录边界不正确');
  }
  try {
    const manifest = await buildRuntime(temporary);
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
      manifest.map((asset) => [asset.path, path.join(temporary, asset.path)]),
    );
    assets['manifest.json'] = path.join(temporary, 'manifest.json');
    const output = path.join(outputDir, process.platform === 'win32' ? 'scwc.exe' : 'scwc');
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
    await fs.copyFile(
      path.join(BUILD_ROOT, 'docs/core.env.example'),
      path.join(outputDir, '.env.example'),
    );
    console.log(`独立可执行文件：${output}`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
