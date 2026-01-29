import path from 'node:path';
import { createLogger } from '../utils/log.ts';

const __dirname = process.cwd();

/** 插件日志实例 */
export const pluginLogger = createLogger('plugin', __dirname);
