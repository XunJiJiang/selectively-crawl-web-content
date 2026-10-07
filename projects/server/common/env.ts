import './environment.ts';
import { serverLogger } from './logger.ts';
import { v4 } from 'uuid';
import { portSettings } from './config.ts';
import { parsedArgs } from './setupParam.ts';
export { ROOT, SERVER_ROOT } from './paths.ts';

const ports = portSettings(process.env, parsedArgs);
export const PORT = ports.port;
export const PORT_SEARCH_RANGE = ports.range;
export let ACTIVE_PORT = PORT;
export function setListeningPort(port: number) {
  ACTIVE_PORT = port;
}
export const HOST = process.env.HOST ?? 'http://localhost';
export const TOKEN = process.env.TOKEN
  ? process.env.TOKEN === 'null'
    ? ''
    : process.env.TOKEN
  : v4();

serverLogger.info(`TOKEN: ${TOKEN ? TOKEN : '[设置为空]'}`);
