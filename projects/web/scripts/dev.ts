import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseWebDevArgs } from './dev-options.ts';

try {
  const { viteArgs, corePort } = parseWebDevArgs(process.argv.slice(2));
  if (corePort !== undefined) {
    process.env.SCWC_WEB_CORE_PORT = corePort;
  }
  if (viteArgs.includes('--help') || viteArgs.includes('-h')) {
    console.log('项目参数：--core-port <port>  指定核心代理端口，仅影响本次 Web 启动。\n');
  }
  const require = createRequire(import.meta.url);
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  process.argv = [process.execPath, viteBin, ...viteArgs];
  await import(pathToFileURL(viteBin).href);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
