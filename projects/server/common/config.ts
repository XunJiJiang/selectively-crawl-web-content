import path from 'node:path';
import { isIP } from 'node:net';

export function booleanSetting(
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') {
    return true;
  }
  if (normalized === 'false' || normalized === '0') {
    return false;
  }
  throw new Error(`${name} 必须是 true/false 或 1/0`);
}

export function integerSetting(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return result;
}

export function parseStartupArgs(args: string[]): Record<string, string | boolean> {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const separator = arg.indexOf('=');
    if (separator !== -1) {
      result[arg.slice(2, separator)] = arg.slice(separator + 1);
    } else if (args[i + 1] !== undefined && !args[i + 1].startsWith('--')) {
      result[arg.slice(2)] = args[++i];
    } else {
      result[arg.slice(2)] = true;
    }
  }
  return result;
}

export function stringArg(
  args: Record<string, string | boolean>,
  name: string,
): string | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`--${name} 需要提供值`);
  }
  return value;
}

export function portSettings(env: NodeJS.ProcessEnv, args: Record<string, string | boolean> = {}) {
  const port = integerSetting('PORT/--port', stringArg(args, 'port') ?? env.PORT, 3200, 1, 65535);
  const range = integerSetting(
    'PORT_SEARCH_RANGE/--port-range',
    stringArg(args, 'port-range') ?? env.PORT_SEARCH_RANGE,
    Math.min(20, 65535 - port),
    0,
    65535 - port,
  );
  return { port, range };
}

export function pluginDirectorySettings(options: {
  env: NodeJS.ProcessEnv;
  args: Record<string, string | boolean>;
  appDir: string;
  root: string;
  envDir: string;
  cwd: string;
  isDev: boolean;
}) {
  const fromEnv = options.env.SCWC_PLUGIN_DIR?.trim();
  const fromCommand = stringArg(options.args, 'plugin-dir');
  const directory = fromEnv
    ? path.resolve(options.envDir, fromEnv)
    : options.isDev
      ? path.join(options.root, 'projects/server/plugins')
      : path.join(options.appDir, 'plugins');
  return {
    directory,
    commandDirectory: fromCommand ? path.resolve(options.cwd, fromCommand) : undefined,
    needsConfirmation: Boolean(fromEnv && fromCommand),
  };
}

export function redisSettings(env: NodeJS.ProcessEnv) {
  if (!booleanSetting('REDIS_ENABLED', env.REDIS_ENABLED, true)) {
    return { enabled: false as const };
  }
  const host = (env.REDIS_HOST ?? '127.0.0.1').replace(/^\[(.*)\]$/, '$1');
  if (!host || (!isIP(host) && !/^[\w.-]+$/.test(host))) {
    throw new Error('REDIS_HOST 格式无效');
  }
  const port = integerSetting('REDIS_PORT', env.REDIS_PORT, 6379, 1, 65535);
  const timeout = integerSetting('REDIS_TIMEOUT', env.REDIS_TIMEOUT, 5000, 1, 2147483647);
  const namespace = env.REDIS_KEY_PREFIX ?? 'cache-redis';
  // clear() 使用 Redis SCAN 的 MATCH；禁止通配符，确保清理只影响当前前缀。
  if (!namespace || /[\s*?[\]\\]/u.test(namespace)) {
    throw new Error('REDIS_KEY_PREFIX 不能为空或包含空白、Redis 通配符');
  }
  return {
    enabled: true as const,
    connection: {
      socket: { host, port, connectTimeout: timeout },
      ...(env.REDIS_USER ? { username: env.REDIS_USER } : {}),
      ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    },
    timeout,
    namespace,
  };
}
