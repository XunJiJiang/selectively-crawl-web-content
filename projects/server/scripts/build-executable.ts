import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { ROOT, SERVER_ROOT } from '../common/paths.ts';
import { buildWeb } from './build.ts';
import { sharedExternalPackages, sharedPackageAssets } from './shared-package-assets.ts';
import { sharedBrowserPackages, sharedBuildPackages } from '../plugin/web/dependencies.ts';

async function main(): Promise<void> {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 25 || (major === 25 && minor < 5)) {
    throw new Error(
      '独立可执行文件构建需要 Node.js >= 25.5（--build-sea）；源码服务仍支持 Node.js 24。',
    );
  }
  const outputDir = path.join(ROOT, 'dist/core');
  await fs.mkdir(outputDir, { recursive: true });
  await buildWeb();
  const { build: buildVite } = await import('vite');
  await buildVite({
    configFile: path.join(ROOT, 'projects/webutils/vite.config.ts'),
    mode: 'production',
  });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-build-'));
  try {
    for (const [entry, output] of [
      ['index.ts', 'core.cjs'],
      ['plugin/process/host.ts', 'host.cjs'],
      ['../terminal/index.ts', 'terminal.cjs'],
      ['../terminal/plugin/host.ts', 'terminal-host.cjs'],
      ['plugin/sdk/worker-bootstrap.ts', 'plugin-worker.cjs'],
      ['plugin/web/host.ts', 'web-build-host.cjs'],
      ['plugin/web/cli.ts', 'web-build-cli.cjs'],
      ['scripts/sea-bootstrap.ts', 'bootstrap.cjs'],
    ]) {
      await build({
        entryPoints: [path.join(SERVER_ROOT, entry)],
        outfile: path.join(temporary, output),
        bundle: true,
        platform: 'node',
        target: 'node24',
        format: 'cjs',
        minify: true,
        keepNames: true,
        treeShaking: true,
        external: [...sharedExternalPackages, ...sharedBuildPackages],
        // 所有源码相对路径在 SEA 模式下由 common/paths.ts 显式处理。
        define: { 'import.meta.url': JSON.stringify('file:///scwc/bundle.cjs') },
      });
    }
    const assets: Record<string, string> = {
      'core.cjs': path.join(temporary, 'core.cjs'),
      'host.cjs': path.join(temporary, 'host.cjs'),
      'terminal.cjs': path.join(temporary, 'terminal.cjs'),
      'terminal-host.cjs': path.join(temporary, 'terminal-host.cjs'),
      'plugin-worker.cjs': path.join(temporary, 'plugin-worker.cjs'),
      'web-build-host.cjs': path.join(temporary, 'web-build-host.cjs'),
      'web-build-cli.cjs': path.join(temporary, 'web-build-cli.cjs'),
      'router/web/page/worry.html': path.join(SERVER_ROOT, 'router/web/page/worry.html'),
    };
    const collect = async (directory: string): Promise<void> => {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, item.name);
        if (item.isDirectory()) {
          await collect(filename);
        } else if (item.isFile()) {
          assets[path.relative(SERVER_ROOT, filename).split(path.sep).join('/')] = filename;
        }
      }
    };
    await collect(path.join(SERVER_ROOT, 'public'));
    const corePackages = await sharedPackageAssets(ROOT);
    const coreAssets = new Set([...Object.keys(assets), ...Object.keys(corePackages)]);
    coreAssets.delete('web-build-host.cjs');
    coreAssets.delete('web-build-cli.cjs');
    Object.assign(
      assets,
      await sharedPackageAssets(ROOT, [
        ...sharedExternalPackages,
        ...sharedBrowserPackages,
        ...sharedBuildPackages,
      ]),
    );
    const browser = path.join(temporary, 'browser.mjs');
    await fs.writeFile(browser, "export { z } from 'zod';\n");
    assets['plugin-sdk/browser.mjs'] = browser;
    const manifest = path.join(temporary, 'manifest.json');
    await fs.writeFile(
      manifest,
      JSON.stringify(
        await Promise.all(
          Object.entries(assets).map(async ([key, filename]) => {
            const stat = await fs.stat(filename);
            return {
              path: key,
              mode: stat.mode & 0o777,
              size: stat.size,
              scope: coreAssets.has(key) ? 'core' : 'web-build',
            };
          }),
        ),
      ),
    );
    assets['manifest.json'] = manifest;
    const output = path.join(outputDir, process.platform === 'win32' ? 'scwc.exe' : 'scwc');
    const config = path.join(temporary, 'sea-config.json');
    await fs.writeFile(
      config,
      JSON.stringify({
        main: path.join(temporary, 'bootstrap.cjs'),
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
      path.join(ROOT, 'docs/core.env.example'),
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
