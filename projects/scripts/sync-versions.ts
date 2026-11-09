import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
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

/** Synchronize source packages and built-in examples, preserving other plugins' versions. */
export async function syncVersions(root = repositoryRoot): Promise<string[]> {
  const metadata = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof metadata.version !== 'string' || !metadata.version.trim()) {
    throw new Error('根 package.json 必须提供非空的 version');
  }
  const version = metadata.version;
  const pluginDirectories = new Map([
    [path.join(root, 'projects/server/plugins'), new Set(['template'])],
    [path.join(root, 'projects/terminal/plugins'), new Set(['template', 'scwc'])],
  ]);
  const updates: { filename: string; content: string }[] = [];
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
  const updated = await syncVersions();
  console.log(`版本同步完成，更新 ${updated.length} 个 package.json`);
}
