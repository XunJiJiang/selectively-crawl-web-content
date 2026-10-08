import { parseStartupArgs, stringArg } from '../../common/config.ts';
import { buildPluginWeb } from './build.ts';

const args = parseStartupArgs(process.argv.slice(2));
const directory = stringArg(args, 'build-plugin-web') ?? stringArg(args, 'directory');
if (!directory) {
  throw new Error(
    '用法：--build-plugin-web <插件目录>，或 bun run build:plugin-web --directory <插件目录>',
  );
}
const logger = {
  info: console.log,
  pathInfo: console.log,
  warn: console.warn,
  error: console.error,
};
void buildPluginWeb(directory, logger).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
