import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateNode,
  loadDirectoryEnvironment,
  type NodeBuildInfo,
  type NodeRuntimeInfo,
} from './node-runtime.ts';
import { assertNativeBuild, parseNodeBuildArgs } from './build-node.ts';

const temporary: string[] = [];
const buildInfo: NodeBuildInfo = {
  format: 'scwc-node/v1',
  version: '2.0.0',
  platform: 'linux',
  arch: 'x64',
  libc: 'glibc',
  minimumNodeMajor: 25,
  minimumNapi: 10,
  builtAt: '',
  builtWithNode: '25.8.0',
};
const node: NodeRuntimeInfo = {
  version: '25.8.0',
  napi: '10',
  platform: 'linux',
  arch: 'x64',
  libc: 'glibc',
  release: 'node',
  alternativeRuntime: false,
};
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe('external Node release contract', () => {
  it('accepts later compatible Node versions and rejects old, alternative, wrong-architecture and wrong-libc runtimes', () => {
    expect(() => validateNode(node, buildInfo)).not.toThrow();
    expect(() => validateNode({ ...node, version: '26.0.0' }, buildInfo)).not.toThrow();
    for (const invalid of [
      { version: '24.12.0' },
      { alternativeRuntime: true },
      { platform: 'win32' },
      { arch: 'arm64' },
      { napi: '9' },
      { libc: 'musl' as const },
    ]) {
      expect(() => validateNode({ ...node, ...invalid }, buildInfo)).toThrow();
    }
  });
  it('parses platform and architecture but rejects foreign native build targets', () => {
    expect(parseNodeBuildArgs(['--platform=darwin', '--arch', 'arm64'])).toEqual({
      platform: 'darwin',
      arch: 'arm64',
    });
    expect(() => parseNodeBuildArgs(['--platform=freebsd'])).toThrow('平台');
    expect(() => parseNodeBuildArgs(['--arch'])).toThrow('架构');
    expect(() => parseNodeBuildArgs(['--arbitrary'])).toThrow('不支持');
    expect(() =>
      assertNativeBuild({
        platform: process.platform === 'win32' ? 'linux' : 'win32',
        arch: 'x64',
      }),
    ).toThrow('不跨平台');
  });
  it('gives adjacent .env precedence including an explicit blank Node setting and protects bootstrap variables', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-node-env-'));
    temporary.push(directory);
    await fs.writeFile(
      path.join(directory, '.env'),
      'SCWC_NODE_PATH=\nPORT=4100\nSCWC_APP_DIR=wrong\n',
    );
    const env = { SCWC_NODE_PATH: '/old/node', PORT: '4200', SCWC_APP_DIR: '/release' };
    loadDirectoryEnvironment(directory, env);
    expect(env).toEqual({ SCWC_NODE_PATH: '', PORT: '4100', SCWC_APP_DIR: '/release' });
  });
  it('checks a compiled launcher before loading application resources and rejects an invalid configured Node instead of falling back', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-node-launcher-'));
    temporary.push(directory);
    const filename = path.join(directory, 'start.cjs');
    await build({
      entryPoints: [fileURLToPath(new URL('./node-bootstrap.ts', import.meta.url))],
      outfile: filename,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'cjs',
    });
    const metadata = {
      ...buildInfo,
      platform: process.platform,
      arch: process.arch,
      libc: undefined,
    };
    await fs.writeFile(path.join(directory, 'build-info.json'), JSON.stringify(metadata));
    const env = { ...process.env, NODE_OPTIONS: '', SCWC_NODE_PATH: '' };
    expect(
      execFileSync(process.execPath, [filename, '--check-node'], { env, encoding: 'utf8' }).trim(),
    ).toBe(process.execPath);
    expect(
      execFileSync(process.execPath, [filename, '--help'], { env, encoding: 'utf8' }),
    ).toContain('多窗口终端');
    await fs.writeFile(path.join(directory, '.env'), 'SCWC_NODE_PATH=./missing-node\n');
    expect(() =>
      execFileSync(process.execPath, [filename, '--help'], { env, stdio: 'pipe' }),
    ).toThrow();
    await fs.writeFile(
      path.join(directory, '.env'),
      `SCWC_NODE_PATH="${process.execPath.replaceAll('\\', '/')}"\n`,
    );
    expect(
      execFileSync(process.execPath, [filename, '--help'], { env, encoding: 'utf8' }),
    ).toContain('多窗口终端');
  });
});
