import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { ENV_DIR } from './paths.ts';

/** 文件中提供的键优先，缺省键沿用进程环境；不读取当前工作目录的 .env。 */
export function loadEnvironment(directory: string, env: NodeJS.ProcessEnv = process.env): void {
  const filename = path.join(directory, '.env');
  if (!fs.existsSync(filename)) {
    return;
  }
  Object.assign(env, dotenv.parse(fs.readFileSync(filename)));
}

loadEnvironment(ENV_DIR);
