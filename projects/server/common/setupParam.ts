import { integerSetting, parseStartupArgs, stringArg } from './config.ts';

export const parsedArgs = parseStartupArgs(process.argv.slice(2));

/** 是否为生产环境 */
export const isProd =
  parsedArgs['mode'] === 'prod' || parsedArgs['mode'] === 'production' || !parsedArgs['mode'];
/** 是否为开发环境 */
export const isDev = parsedArgs['mode'] === 'dev' || parsedArgs['mode'] === 'development';

export const WEB_PORT = integerSetting(
  '--web-port',
  stringArg(parsedArgs, 'web-port'),
  3201,
  1,
  65535,
);
const webHost = stringArg(parsedArgs, 'web-host') ?? 'http://localhost';
const webUrl = new URL(webHost.includes('://') ? webHost : `http://${webHost}`);
webUrl.port = String(WEB_PORT);
export const WEB_ORIGIN = webUrl.origin;
