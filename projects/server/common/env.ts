import dotenv from 'dotenv';
import path from 'node:path';
import { serverLogger } from './logger.ts';
import { v4 } from 'uuid';

const __dirname = import.meta.dirname;

/** 所有项目的根目录 */
export const ROOT = path.join(__dirname, '..', '..', '..');

/** 当前程序启动文件所在目录 */
export const SERVER_ROOT = path.join(__dirname, '..');

dotenv.config({
  path: path.join(ROOT, '.env'),
});

export const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;
export const HOST = process.env.HOST ?? 'http://localhost';
export const TOKEN = process.env.TOKEN
  ? process.env.TOKEN === 'null'
    ? ''
    : process.env.TOKEN
  : v4();

serverLogger.info(`TOKEN: ${TOKEN ? TOKEN : '[设置为空]'}`);
