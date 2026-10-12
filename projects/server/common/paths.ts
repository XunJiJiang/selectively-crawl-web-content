import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

/** Both distributions use bundled hosts; only SEA embeds the Node executable. */
const sea = isSea();
export const isExternalNodeDistribution =
  !sea && process.env.SCWC_DISTRIBUTION_MODE === 'external-node';
export const isPackaged = sea || isExternalNodeDistribution;
const sourceServerRoot = isPackaged ? '' : fileURLToPath(new URL('../', import.meta.url));
function distributionDirectory(name: string): string {
  const directory = process.env[name];
  if (!directory || !path.isAbsolute(directory)) {
    throw new Error(`外置 Node 运行时版缺少 ${name}，请通过 start.cjs 启动`);
  }
  return path.resolve(directory);
}
/** 可写部署目录；源码运行时保持以仓库根目录保存缓存。 */
export const APP_DIR = isExternalNodeDistribution
  ? distributionDirectory('SCWC_APP_DIR')
  : isPackaged
    ? path.dirname(process.execPath)
    : sourceServerRoot;
export const ROOT = isPackaged ? APP_DIR : path.resolve(sourceServerRoot, '../..');
/** SEA extracts resources; the Node distribution keeps them beside start.cjs. */
export const SERVER_ROOT = isExternalNodeDistribution
  ? distributionDirectory('SCWC_RUNTIME_ROOT')
  : isPackaged
    ? (process.env.SCWC_RUNTIME_ROOT ?? APP_DIR)
    : sourceServerRoot;
export const ENV_DIR = ROOT;
export const PLUGIN_HOST = isPackaged
  ? path.join(SERVER_ROOT, 'host.cjs')
  : path.join(sourceServerRoot, 'plugin/process/host.ts');
