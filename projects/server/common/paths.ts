import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isSea } from 'node:sea';

export const isPackaged = isSea();
const sourceServerRoot = isPackaged ? '' : fileURLToPath(new URL('../', import.meta.url));
/** 可写部署目录；源码运行时保持以仓库根目录保存缓存。 */
export const APP_DIR = isPackaged ? path.dirname(process.execPath) : sourceServerRoot;
export const ROOT = isPackaged ? APP_DIR : path.resolve(sourceServerRoot, '../..');
/** SEA 的只读资源在启动时释放到私有临时目录。 */
export const SERVER_ROOT = isPackaged
  ? (process.env.SCWC_RUNTIME_ROOT ?? APP_DIR)
  : sourceServerRoot;
export const ENV_DIR = ROOT;
export const PLUGIN_HOST = isPackaged
  ? path.join(SERVER_ROOT, 'host.cjs')
  : path.join(sourceServerRoot, 'plugin/process/host.ts');
