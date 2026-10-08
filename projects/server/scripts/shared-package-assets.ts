import fs from 'node:fs/promises';
import path from 'node:path';
import { findPackageJSON } from 'node:module';
import { pathToFileURL } from 'node:url';

/** These packages need their native binary or original resource-relative paths. */
export const sharedExternalPackages = ['better-sqlite3', 'trash'];

/** Preserve Node's package lookup and conflicting transitive versions in SEA. */
export async function sharedPackageAssets(
  root: string,
  packages: readonly string[] = sharedExternalPackages,
): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  const placements = new Map<string, string>();

  async function collect(source: string, destination: string): Promise<void> {
    for (const item of await fs.readdir(source, { withFileTypes: true })) {
      if (item.name === 'node_modules' || item.name === '.git') {
        continue;
      }
      const filename = path.join(source, item.name);
      const key = path.posix.join(destination, item.name);
      const stat = await fs.stat(filename);
      if (stat.isDirectory()) {
        await collect(filename, key);
      } else if (stat.isFile()) {
        assets[key] = filename;
      }
    }
  }

  async function add(
    name: string,
    sourceParent: string,
    destinationParent: string,
    optional = false,
  ): Promise<void> {
    let manifest: string | undefined;
    try {
      manifest = findPackageJSON(name, pathToFileURL(path.join(sourceParent, 'package.json')));
    } catch (error) {
      if (
        optional &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_MODULE_NOT_FOUND'
      ) {
        return;
      }
      throw error;
    }
    if (!manifest) {
      if (optional) {
        return;
      }
      throw new Error(`无法定位共享依赖 ${name}（${sourceParent}）`);
    }
    const source = await fs.realpath(path.dirname(manifest));
    let found: string | undefined;
    let parent = destinationParent;
    while (true) {
      const candidate = path.posix.join(parent, 'node_modules', name);
      if (placements.has(candidate)) {
        found = candidate;
        break;
      }
      if (!parent || parent === '.') {
        break;
      }
      parent = path.posix.dirname(parent);
    }
    if (found && placements.get(found) === source) {
      return;
    }
    const destination = found
      ? path.posix.join(destinationParent, 'node_modules', name)
      : path.posix.join('node_modules', name);
    placements.set(destination, source);
    await collect(source, destination);
    const metadata = JSON.parse(await fs.readFile(manifest, 'utf8')) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(metadata.dependencies ?? {})) {
      if (!(dependency in (metadata.optionalDependencies ?? {}))) {
        await add(dependency, source, destination);
      }
    }
    for (const dependency of Object.keys(metadata.optionalDependencies ?? {})) {
      await add(dependency, source, destination, true);
    }
  }

  for (const name of packages) {
    await add(name, root, '');
  }
  return assets;
}
