const originArgs = process.argv.reduce<{ parsing: boolean; args: string[] }>(
  (acc, arg) => {
    // 从第一次解析到 index.ts 之后开始, 解析所有参数
    if (acc.parsing) {
      acc.args.push(arg);
    }
    if (arg.endsWith('index.ts')) {
      acc.parsing = true;
    }
    return acc;
  },
  { parsing: false, args: [] },
).args;

/**
 * 解析参数
 * 规定:
 * - 参数为 --key=value 的形式是, value 只能是字符串
 * - 参数为 --key 的形式时, value 为 true
 * 其他形式的参数将被忽略
 * @returns 解析后的参数对象
 */
function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsedArgs: Record<string, string | boolean> = {};
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      if (value !== undefined) {
        parsedArgs[key] = value;
      } else {
        parsedArgs[key] = true;
      }
    }
  }
  return parsedArgs;
}

export const parsedArgs = parseArgs(originArgs);

/** 是否为生产环境 */
export const isProd =
  parsedArgs['mode'] === 'prod' || parsedArgs['mode'] === 'production' || !parsedArgs['mode'];
/** 是否为开发环境 */
export const isDev = parsedArgs['mode'] === 'dev' || parsedArgs['mode'] === 'development';
