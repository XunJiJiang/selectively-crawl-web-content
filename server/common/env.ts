import dotenv from 'dotenv';
import { serverLogger } from './logger';
import { v4 } from 'uuid'

dotenv.config();

export const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;
export const HOST = process.env.HOST ?? 'http://localhost';
export const TOKEN = process.env.TOKEN
  ? process.env.TOKEN === 'null'
    ? ''
    : process.env.TOKEN
  : v4();

serverLogger.info(`TOKEN: ${TOKEN ? TOKEN : '[设置为空]'}`);