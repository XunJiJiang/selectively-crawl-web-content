import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const usage = '用法：bun run sync:versions [1|2|3]（1：主版本，2：次版本，3：修订版本）';
const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'build',
  'release',
  'coverage',
  'out',
  'data',
  'cache',
]);

/** Optionally bump the root version, then synchronize source packages and built-in examples. */
export async function syncVersions(root = repositoryRoot, bump?: string): Promise<string[]> {
  if (bump !== undefined && !['1', '2', '3'].includes(bump)) {
    throw new Error(`版本递增参数必须是 1、2 或 3。${usage}`);
  }
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
    throw new Error('根 package.json 必须提供非空的 version');
  }
  let version = metadata.version;
  if (bump !== undefined) {
    const parts = version.split('.').map(Number);
    const index = Number(bump) - 1;
    if (
      !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) ||
      !parts.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(parts[index] + 1)
    ) {
      throw new Error('递增版本时，根 package.json 的 version 必须为三个安全非负整数构成的 x.y.z');
    }
    parts[index] += 1;
    parts.fill(0, index + 1);
    version = parts.join('.');
  }
  const pluginDirectories = new Map([
    [path.join(root, 'projects/server/plugins'), new Set(['template'])],
    [path.join(root, 'projects/terminal/plugins'), new Set(['template', 'scwc'])],
  ]);
  const updates: { filename: string; content: string }[] = [];
  if (version !== metadata.version) {
    updates.push({
      filename: path.join(root, 'package.json'),
      content: JSON.stringify({ ...metadata, version }, null, 2) + '\n',
    });
  }
  async function collect(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !entry.name.startsWith('.') &&
          !excludedDirectories.has(entry.name) &&
          (!pluginDirectories.has(directory) || pluginDirectories.get(directory)?.has(entry.name))
        ) {
          await collect(filename);
        }
      } else if (entry.isFile() && entry.name === 'package.json') {
        const pkg = JSON.parse(await fs.readFile(filename, 'utf8')) as Record<string, unknown>;
        if (pkg.version !== version) {
          updates.push({ filename, content: JSON.stringify({ ...pkg, version }, null, 2) + '\n' });
        }
      }
    }
  }
  // Read every manifest first: malformed source metadata must stop the build before any write.
  await collect(path.join(root, 'projects'));
  for (const { filename, content } of updates) {
    await fs.writeFile(filename, content);
  }
  return updates.map(({ filename }) => path.relative(root, filename));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) {
      throw new Error(`最多只能提供一个版本递增参数。${usage}`);
    }
    const updated = await syncVersions(repositoryRoot, args[0]);
    console.log(`版本同步完成，更新 ${updated.length} 个 package.json`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
