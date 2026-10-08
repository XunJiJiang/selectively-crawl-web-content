import path from 'node:path';
import { splitCommand } from '../../utils/command.ts';

export interface WebBuildOptions {
  configFile?: string;
  root?: string;
  mode: string;
  outDir?: string;
  target?: string;
  sourcemap?: boolean | 'inline' | 'hidden';
}

/** Interpret a Vite build declaration; never invoke the script in a shell. */
export function parseWebBuildScript(script: unknown, directory: string): WebBuildOptions {
  if (typeof script !== 'string') {
    throw new Error('未提供构建后的页面；package.json 需要 scripts.build:web（vite build ...）');
  }
  const tokens = splitCommand(script);
  if (tokens[0] !== 'vite' || tokens[1] !== 'build') {
    throw new Error('build:web 只支持 vite build，不执行其他命令或 shell 脚本');
  }
  const options: WebBuildOptions = { mode: 'production' };
  for (let index = 2; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === '--emptyOutDir') {
      continue;
    }
    if (token === '--sourcemap') {
      options.sourcemap = true;
      continue;
    }
    const equals = token.indexOf('=');
    const key = equals === -1 ? token : token.slice(0, equals);
    if (['--config', '-c', '--mode', '-m', '--outDir', '--target', '--sourcemap'].includes(key)) {
      const value = equals === -1 ? tokens[++index] : token.slice(equals + 1);
      if (!value || value.startsWith('--')) {
        throw new Error(`build:web 的 ${key} 缺少值`);
      }
      if (key === '--config' || key === '-c') {
        options.configFile = path.resolve(directory, value);
      } else if (key === '--mode' || key === '-m') {
        options.mode = value;
      } else if (key === '--outDir') {
        options.outDir = value;
      } else if (key === '--target') {
        options.target = value;
      } else if (value === 'inline' || value === 'hidden') {
        options.sourcemap = value;
      } else {
        throw new Error('build:web 的 --sourcemap 值只支持 inline/hidden');
      }
    } else if (!token.startsWith('-') && !options.root && !/[;&|]/.test(token)) {
      options.root = path.resolve(directory, token);
    } else {
      throw new Error(`build:web 不支持参数 ${token}；其他构建选项请写入 Vite 配置`);
    }
  }
  return options;
}

export interface WebBuildRequest {
  directory: string;
  options: WebBuildOptions;
  expectedEntry?: string;
}
