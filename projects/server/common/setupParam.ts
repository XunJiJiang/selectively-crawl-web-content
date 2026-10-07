import { parseStartupArgs } from './config.ts';

export const parsedArgs = parseStartupArgs(process.argv.slice(2));

/** 是否为生产环境 */
export const isProd =
  parsedArgs['mode'] === 'prod' || parsedArgs['mode'] === 'production' || !parsedArgs['mode'];
/** 是否为开发环境 */
export const isDev = parsedArgs['mode'] === 'dev' || parsedArgs['mode'] === 'development';
