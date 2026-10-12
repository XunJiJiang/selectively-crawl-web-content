import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../../common/paths.ts';
import { packageName, sharedBrowserPackages, sharedBuildPackages } from './dependencies.ts';
import type { WebBuildRequest } from './options.ts';

const dependencyRoot = process.env.SCWC_RUNTIME_ROOT ?? ROOT;
const anchor = pathToFileURL(path.join(dependencyRoot, 'scwc-web-build.cjs')).href;
const shared = new Set<string>([...sharedBrowserPackages, ...sharedBuildPackages]);
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const name = packageName(specifier);
      if (
        !name ||
        !shared.has(name) ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ERR_MODULE_NOT_FOUND'
      ) {
        throw error;
      }
      return nextResolve(specifier, { ...context, parentURL: anchor });
    }
  },
});

function inside(directory: string, filename: string): boolean {
  const relative = path.relative(directory, filename);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}

/** Resolve aliases even when the final build directory or entry does not exist yet. */
async function physicalPath(filename: string): Promise<string> {
  try {
    return await fs.realpath(filename);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    return path.join(await physicalPath(path.dirname(filename)), path.basename(filename));
  }
}

export async function runWebBuild(request: WebBuildRequest): Promise<void> {
  const { build, loadConfigFromFile } = await import('vite');
  const { default: scwcVite } = await import('@scwc/vite-plugin');
  const environment = {
    command: 'build' as const,
    mode: request.options.mode,
    isSsrBuild: false,
    isPreview: false,
  };
  const loaded = await loadConfigFromFile(
    environment,
    request.options.configFile,
    request.directory,
    'info',
    undefined,
    'native',
  );
  const config = loaded?.config ?? {};
  const directory = await fs.realpath(request.directory);
  const root = await physicalPath(
    path.resolve(directory, request.options.root ?? config.root ?? '.'),
  );
  const destination = await physicalPath(
    path.resolve(root, request.options.outDir ?? config.build?.outDir ?? 'dist'),
  );
  const expectedEntry = request.expectedEntry
    ? await physicalPath(path.resolve(request.expectedEntry))
    : undefined;
  if (!inside(directory, destination) || destination === root) {
    throw new Error('Vite outDir 必须是插件目录内的独立构建目录，不能覆盖插件根目录或源码根目录');
  }
  if (expectedEntry && !inside(destination, expectedEntry)) {
    throw new Error('插件 ui.entry 不在 Vite outDir 中，请修正入口或构建配置');
  }
  const parent = path.dirname(destination);
  await fs.mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.scwc-web-build-${randomUUID()}`);
  const backup = path.join(parent, `.scwc-web-backup-${randomUUID()}`);
  const sharedPlugin = () => scwcVite({ dependencyRoot });
  let saved = false;
  try {
    await build({
      ...config,
      configFile: false,
      root,
      mode: request.options.mode,
      base: `/web/page/plugin/${encodeURIComponent(path.basename(request.directory))}/`,
      plugins: [sharedPlugin(), ...(config.plugins ?? [])],
      worker: {
        ...config.worker,
        plugins: () => [sharedPlugin(), ...(config.worker?.plugins?.() ?? [])],
      },
      build: {
        ...config.build,
        ...(request.options.target ? { target: request.options.target } : {}),
        ...(request.options.sourcemap !== undefined
          ? { sourcemap: request.options.sourcemap }
          : {}),
        outDir: staging,
        emptyOutDir: true,
      },
    });
    if (expectedEntry) {
      await fs.access(path.join(staging, path.relative(destination, expectedEntry)));
    }
    if (
      await fs.stat(destination).then(
        () => true,
        () => false,
      )
    ) {
      await fs.rename(destination, backup);
      saved = true;
    }
    try {
      await fs.rename(staging, destination);
    } catch (error) {
      if (saved) {
        await fs.rename(backup, destination);
      }
      saved = false;
      throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
    if (saved) {
      await fs.rm(backup, { recursive: true, force: true });
    }
  }
}

process.once('message', (request: WebBuildRequest) => {
  void runWebBuild(request).then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(error);
      process.exit(1);
    },
  );
});
process.once('disconnect', () => process.exit(1));
