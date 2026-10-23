import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { sharedExternalPackages, sharedPackageAssets } from './shared-package-assets.ts';
import { sharedBrowserPackages, sharedBuildPackages } from '../plugin/web/dependencies.ts';

export const BUILD_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const server = path.join(BUILD_ROOT, 'projects/server');
export interface RuntimeAsset {
  path: string;
  mode: number;
  size: number;
  scope: 'core' | 'web-build';
}

/** Produce the same physical runtime for SEA embedding and external Node releases. */
export async function buildRuntime (directory: string): Promise<RuntimeAsset[]> {
  await fs.mkdir(directory, { recursive: true });
  for (const [entry, output] of [
    ['index.ts', 'core.cjs'],
    ['plugin/process/host.ts', 'host.cjs'],
    ['../terminal/index.ts', 'terminal.cjs'],
    ['../terminal/plugin/host.ts', 'terminal-host.cjs'],
    ['plugin/sdk/worker-bootstrap.ts', 'plugin-worker.cjs'],
    ['plugin/web/host.ts', 'web-build-host.cjs'],
    ['plugin/web/cli.ts', 'web-build-cli.cjs'],
  ]) {
    await build({
      entryPoints: [path.join(server, entry)],
      outfile: path.join(directory, output),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      minify: true,
      keepNames: true,
      treeShaking: true,
      external: [...sharedExternalPackages, ...sharedBuildPackages],
      define: { 'import.meta.url': JSON.stringify('file:///scwc/bundle.cjs') },
    });
  }
  const { build: buildVite } = await import('vite');
  for (const [config, output] of [
    ['projects/web/vite.config.ts', 'public/web'],
    ['projects/webutils/vite.config.ts', 'public/lib'],
  ]) {
    await buildVite({
      configFile: path.join(BUILD_ROOT, config),
      mode: 'production',
      build: { outDir: path.join(directory, output), emptyOutDir: true },
    });
  }
  await fs.cp(path.join(server, 'public/resources'), path.join(directory, 'public/resources'), {
    recursive: true,
  });
  await fs.mkdir(path.join(directory, 'router/web/page'), { recursive: true });
  await fs.copyFile(
    path.join(server, 'router/web/page/worry.html'),
    path.join(directory, 'router/web/page/worry.html'),
  );
  await fs.mkdir(path.join(directory, 'plugin-sdk'), { recursive: true });
  await fs.writeFile(path.join(directory, 'plugin-sdk/browser.mjs'), "export { z } from 'zod';\n");
  const corePackages = await sharedPackageAssets(BUILD_ROOT);
  const packages = Object.entries(
    await sharedPackageAssets(BUILD_ROOT, [
      ...sharedExternalPackages,
      ...sharedBrowserPackages,
      ...sharedBuildPackages,
    ]),
  );
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < packages.length) {
        const [relative, source] = packages[next++];
        const destination = path.join(directory, relative);
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.copyFile(source, destination);
        if (process.platform !== 'win32') {
          await fs.chmod(destination, (await fs.stat(source)).mode & 0o777);
        }
      }
    }),
  );
  const assets: RuntimeAsset[] = [];
  async function collect (folder: string): Promise<void> {
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      const filename = path.join(folder, item.name);
      if (item.isDirectory()) {
        await collect(filename);
      } else if (item.isFile()) {
        const stat = await fs.stat(filename);
        const relative = path.relative(directory, filename).split(path.sep).join('/');
        const tool = relative.startsWith('node_modules/')
          ? !(relative in corePackages)
          : ['web-build-host.cjs', 'web-build-cli.cjs', 'plugin-sdk/browser.mjs'].includes(
            relative,
          );
        assets.push({
          path: relative,
          mode: stat.mode & 0o777,
          size: stat.size,
          scope: tool ? 'web-build' : 'core',
        });
      }
    }
  }
  await collect(directory);
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(assets, null, 2) + '\n');
  return assets;
}
