import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export type ReleasePlatform = 'win32' | 'linux' | 'darwin';
export type ReleaseArch = 'x64' | 'arm64';
export interface ExternalNodeBuildInfo {
  format: 'scwc-external-node/v1';
  version: string;
  platform: ReleasePlatform;
  arch: ReleaseArch;
  libc?: 'glibc' | 'musl';
  minimumNodeMajor: number;
  minimumNapi: number;
  builtAt: string;
  builtWithNode: string;
}
export interface NodeRuntimeInfo {
  version: string;
  napi: string | undefined;
  platform: string;
  arch: string;
  libc?: 'glibc' | 'musl';
  release: string;
  alternativeRuntime: boolean;
}

export function currentNodeInfo(): NodeRuntimeInfo {
  const header =
    process.platform === 'linux'
      ? (process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header
      : undefined;
  return {
    version: process.versions.node,
    napi: process.versions.napi,
    platform: process.platform,
    arch: process.arch,
    libc: header ? (header.glibcVersionRuntime ? 'glibc' : 'musl') : undefined,
    release: process.release.name,
    alternativeRuntime: Boolean(process.versions.bun || process.versions.electron),
  };
}

export function validateNode(info: NodeRuntimeInfo, build: ExternalNodeBuildInfo): void {
  if (
    info.release !== 'node' ||
    info.alternativeRuntime ||
    Number(info.version.split('.')[0]) < build.minimumNodeMajor
  ) {
    throw new Error(
      `外置 Node 运行时版需要 Node.js ${build.minimumNodeMajor} 或以上，当前为 ${info.version}`,
    );
  }
  if (
    info.platform !== build.platform ||
    info.arch !== build.arch ||
    (build.libc && build.libc !== info.libc)
  ) {
    throw new Error(
      `Node 的平台/架构与发行包不匹配：需要 ${build.platform}-${build.arch}${build.libc ? `-${build.libc}` : ''}`,
    );
  }
  if (!info.napi || Number(info.napi) < build.minimumNapi) {
    throw new Error(`共享原生依赖需要 Node-API ${build.minimumNapi}`);
  }
}

export function readBuildInfo(directory: string): ExternalNodeBuildInfo {
  const info = JSON.parse(
    fs.readFileSync(path.join(directory, 'build-info.json'), 'utf8'),
  ) as ExternalNodeBuildInfo;
  if (
    info.format !== 'scwc-external-node/v1' ||
    !['win32', 'linux', 'darwin'].includes(info.platform) ||
    !['x64', 'arm64'].includes(info.arch) ||
    info.minimumNodeMajor !== 25 ||
    info.minimumNapi !== 10
  ) {
    throw new Error('外置 Node 运行时版 build-info.json 无效或版本不受支持');
  }
  return info;
}

export function loadExternalNodeEnvironment(directory: string, env: NodeJS.ProcessEnv): void {
  const filename = path.join(directory, '.env');
  if (!fs.existsSync(filename)) {
    return;
  }
  const parsed = dotenv.parse(fs.readFileSync(filename));
  for (const [key, value] of Object.entries(parsed)) {
    if (!['SCWC_APP_DIR', 'SCWC_RUNTIME_ROOT', 'SCWC_DISTRIBUTION_MODE'].includes(key)) {
      env[key] = value;
    }
  }
}
