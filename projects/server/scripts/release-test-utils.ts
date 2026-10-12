import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { bundledExecutableName, releaseArchive } from './release-package.ts';

/** Tests consume the actual ZIP and its recorded permissions rather than old loose outputs. */
export async function extractRelease(
  archive: string,
  directory: string,
  only?: string,
): Promise<void> {
  const data = await fs.readFile(archive);
  const files = unzipSync(data, { filter: (entry) => !only || entry.name === only });
  const modes = new Map<string, number>();
  let end = data.length - 22;
  while (end >= Math.max(0, data.length - 65557) && data.readUInt32LE(end) !== 0x06054b50) {
    end--;
  }
  if (end < Math.max(0, data.length - 65557)) {
    throw new Error('ZIP 缺少中央目录');
  }
  let offset = data.readUInt32LE(end + 16);
  for (let count = data.readUInt16LE(end + 10); count > 0; count--) {
    if (data.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('ZIP 中央目录损坏');
    }
    const length = data.readUInt16LE(offset + 28);
    const name = data.subarray(offset + 46, offset + 46 + length).toString('utf8');
    modes.set(name, data.readUInt32LE(offset + 38) >>> 16);
    offset += 46 + length + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32);
  }
  for (const [name, bytes] of Object.entries(files)) {
    const target = path.resolve(directory, name);
    const relative = path.relative(directory, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('ZIP 路径越界');
    }
    if (name.endsWith('/')) {
      await fs.mkdir(target, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, bytes);
    }
    const mode = modes.get(name);
    if (process.platform !== 'win32' && mode) {
      await fs.chmod(target, mode & 0o777);
    }
  }
}

export async function bundledNodeFixture(includePlugins = false) {
  const archive = releaseArchive('bundled-node');
  if (!existsSync(archive)) {
    return;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-bundled-node-fixture-'));
  const cleanup = () => fs.rm(directory, { recursive: true, force: true });
  try {
    const name = bundledExecutableName();
    await extractRelease(archive, directory, includePlugins ? undefined : name);
    return { directory, executable: path.join(directory, name), cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
