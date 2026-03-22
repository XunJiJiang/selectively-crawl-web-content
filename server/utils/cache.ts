import path from 'node:path';
import fs from 'node:fs';
import { v4 } from 'uuid';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';
import { CacheableMemory } from 'cacheable';
import { createCache } from 'cache-manager';
import stream, { Readable } from 'node:stream';
import z from 'zod';

/**
 * 保存未处理的错误实例
 *
 * 由此处收集错误, 等待外部调用者在合适的时机获取并处理这些错误,
 * 因为有些错误可能会在 log 实例尚未准备好时发生
 * 因此会暂时将这些错误保存在内存中, 等待外部提供错误处理程序来处理它们
 */
const keyvErrorInfo = new Set<{
  channel: string;
  error: Error;
}>();

/** 错误处理程序列表 */
const errorHandlers = new Map<string, Set<(errorInfo: { channel: string; error: Error }) => void>>();

/** redis user */
const REDIS_USER = process.env.REDIS_USER ?? '';
/** redis password */
const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? '';
/** redis host */
let REDIS_HOST = process.env.REDIS_HOST ?? '127.0.0.1';
/** redis port */
let REDIS_PORT = process.env.REDIS_PORT ?? '6379';
/** redis timeout */
let REDIS_TIMEOUT = process.env.REDIS_TIMEOUT ?? '5000';

/** 验证 host */
const simpleHostSchema = z.string().regex(/^[\w.-]+$/, 'Invalid host format');
try {
  REDIS_HOST = simpleHostSchema.parse(REDIS_HOST);
} catch {
  keyvErrorInfo.add({
    channel: 'env',
    error: new Error(`无效的 REDIS_HOST 格式: ${REDIS_HOST}, 将使用默认值`),
  });
  handleKeyvError('env');
  REDIS_HOST = '127.0.0.1';
}

try {
  REDIS_PORT = z.string().regex(/^\d+$/, 'Invalid port format').parse(REDIS_PORT);
} catch {
  keyvErrorInfo.add({
    channel: 'env',
    error: new Error(`无效的 REDIS_PORT 格式: ${REDIS_PORT}, 将使用默认值`),
  });
  handleKeyvError('env');
  REDIS_PORT = '6379';
}

try {
  REDIS_TIMEOUT = z.string().regex(/^\d+$/, 'Invalid timeout format').parse(REDIS_TIMEOUT);
} catch {
  keyvErrorInfo.add({
    channel: 'env',
    error: new Error(`无效的 REDIS_TIMEOUT 格式: ${REDIS_TIMEOUT}, 将使用默认值`),
  });
  handleKeyvError('env');
  REDIS_TIMEOUT = '5000';
}

/** redis 连接字符串 */
const REDIS_CONNECTION_STRING =
  REDIS_USER && REDIS_PASSWORD
    ? `redis://${REDIS_USER}:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}`
    : `redis://${REDIS_HOST}:${REDIS_PORT}`;

const keyvInstances = [
  //  High performance in-memory cache with LRU and TTL
  [
    'memory',
    new Keyv({
      store: new CacheableMemory({ ttl: 60000, lruSize: 5000 }),
      namespace: 'asmr-cache-memory',
    }),
  ],
  //  Redis Store
  [
    'redis',
    new Keyv(
      new KeyvRedis(REDIS_CONNECTION_STRING, {
        namespace: 'asmr-cache',
        useUnlink: true,
        connectionTimeout: parseInt(REDIS_TIMEOUT),
      }),
      {
        namespace: 'asmr-cache',
      },
    ),
  ],
] as const;

/** 提供错误处理程序 */
export function addErrorHandler(store: string, handler: (errorInfo: { channel: string; error: Error }) => void) {
  if (!errorHandlers.has(store)) {
    errorHandlers.set(store, new Set());
  }
  errorHandlers.get(store)!.add(handler);

  // 添加后立即处理之前积累的错误
  handleKeyvError(store);
  return () => {
    errorHandlers.get(store)?.delete(handler);
  };
}

/** 执行错误处理 */
function handleKeyvError(store?: string) {
  if (keyvErrorInfo.size <= 0) {
    return;
  }

  if (store) {
    // 只处理指定 store 的错误
    const handlers = errorHandlers.get(store);
    if (!handlers || handlers.size <= 0) {
      return;
    }
    for (const errorInfo of keyvErrorInfo) {
      if (errorInfo.channel === store) {
        handlers.forEach(handler => handler(errorInfo));
        keyvErrorInfo.delete(errorInfo);
        break;
      }
    }
  } else {
    // 处理所有 store 的错误
    for (const errorInfo of keyvErrorInfo) {
      const handlers = errorHandlers.get(errorInfo.channel);
      if (handlers) {
        handlers.forEach(handler => handler(errorInfo));
      }
      keyvErrorInfo.delete(errorInfo);
    }
  }
}

keyvInstances.forEach(keyv => {
  keyv[1].on('error', err => {
    const storeName = keyv[0];
    keyvErrorInfo.add({
      channel: storeName,
      error: err,
    });
    handleKeyvError(storeName);
  });
});

/** 缓存实例 */
// Multiple stores
export const cache = createCache({
  ttl: 60 * 60 * 1000, // 1 hour
  refreshThreshold: 30 * 60 * 1000, // 30 minutes
  stores: keyvInstances.map(i => i[1]),
});

/** 缓存支持的数据类型 */
export type TCacheableData = string | number | BigInt | boolean | object | Buffer | Readable;

/** 流式缓存的标志字面量 */
export type TFileCacheType = 'stream';
/** 其他类型缓存的标志字面量 */
export type TOtherCacheType = 'string' | 'number' | 'bigint' | 'boolean' | 'object' | 'Buffer';

/** 最大单个值的内存写入尺寸 */
export const MAX_MEMORY_CACHE_SIZE = 5 * 1024 * 1024; // 5 MB

/** 文件缓存目录 */
export const FILE_CACHE_DIR = path.join(process.cwd(), 'cache', 'files');

/**
 * 检查数据是否是支持的类型
 */
function isCacheableData(data: any): data is TCacheableData {
  return (
    typeof data === 'string' ||
    typeof data === 'number' ||
    typeof data === 'bigint' ||
    typeof data === 'boolean' ||
    typeof data === 'object' ||
    data instanceof Buffer ||
    data instanceof Readable
  );
}

/**
 * 创建写入缓存
 * @param key 缓存键
 * @param data 要缓存的数据
 * @param isRedirect 是否为重定向
 * @param log 日志记录器
 * @returns data
 */
export async function setCache<T>(key: string, data: T, isRedirect: boolean, log: SCWC.Log): Promise<T> {
  if (!isCacheableData(data)) {
    log.warn(`尝试缓存不支持的类型，键: ${key}，类型: ${typeof data}`);
    return data;
  }

  if (isRedirect) {
    // 检查重定向循环
    // 检查重定向最终目标是否为有效值

    if (typeof data !== 'string') {
      throw new Error('设置重定向缓存的值的类型必须为字符串');
    }

    /** 已经出现过的 key */
    const visitedKeys = new Set<string>([key]);
    let currentKey = data as string;
    while (true) {
      if (visitedKeys.has(currentKey)) {
        // 出现循环，停止写入
        throw new Error(`检测到重定向循环，停止写入缓存，循环链: ${Array.from(visitedKeys).join(' -> ')}`);
      }
      visitedKeys.add(currentKey);

      const cachedData = await cache.get<{ type: 'redirect' | 'value' | 'filecache'; dataType: string; data: any }>(
        currentKey,
      );
      if (!cachedData) {
        throw new Error(`重定向目标 ${currentKey} 不存在，无法设置重定向缓存`);
      } else if (cachedData.type === 'redirect') {
        currentKey = cachedData.data as string;
      } else {
        break;
      }
    }

    await cache.set<{
      type: 'redirect';
      dataType: string;
      data: string;
    }>(key, {
      type: 'redirect',
      dataType: 'string',
      data: data as string,
    });

    return data;
  } else if (data instanceof Readable) {
    // 处理流式数据
    // 写入文件系统缓存

    if (!fs.existsSync(FILE_CACHE_DIR)) {
      fs.mkdirSync(FILE_CACHE_DIR, { recursive: true });
    }

    const filename = v4();
    const filepath = path.join(FILE_CACHE_DIR, filename);

    const writeStream = fs.createWriteStream(filepath);

    try {
      await new Promise<void>((resolve, reject) => {
        data.pipe(writeStream);
        data.on('error', err => {
          reject(err);
        });
        writeStream.on('finish', () => {
          resolve();
        });
        writeStream.on('error', err => {
          reject(err);
        });
      });
    } catch (error) {
      throw new Error(`写入流式数据缓存失败: ${(error as Error).message}`, { cause: error });
    }

    /** 原始数据类型 */
    const fileType: TFileCacheType = 'stream';

    await cache.set<{
      type: `filecache:${TFileCacheType}`;
      dataType: string;
      data: string;
    }>(key, {
      type: `filecache:${fileType}`,
      dataType: 'string',
      data: filepath,
    });

    // 返回一个新的 Readable 读取流
    return stream.Readable.from(fs.createReadStream(filepath)) as unknown as T;
  } else {
    // 计算值大小
    const size = Buffer.byteLength(
      (() => {
        if (typeof data === 'string') {
          return data;
        } else if (data instanceof Buffer) {
          return data;
        } else if (data instanceof BigInt) {
          return data.toString();
        } else if (data instanceof Readable) {
          // 这个分支实际应该无法到达
          throw new Error('流式数据应在前面处理');
        } else {
          return JSON.stringify(data);
        }
      })(),
    );

    if (size > MAX_MEMORY_CACHE_SIZE) {
      // 写入文件系统缓存

      if (!fs.existsSync(FILE_CACHE_DIR)) {
        fs.mkdirSync(FILE_CACHE_DIR, { recursive: true });
      }

      const filename = v4();
      const filepath = path.join(FILE_CACHE_DIR, filename);

      /** 原始数据类型 */
      const fileType: TOtherCacheType = data instanceof Buffer ? 'Buffer' : (typeof data as TOtherCacheType);

      await fs.promises.writeFile(
        filepath,
        (() => {
          if (typeof data === 'string') {
            return data;
          } else if (data instanceof Buffer) {
            return data;
          } else if (data instanceof BigInt) {
            return data.toString();
          } else {
            return JSON.stringify(data);
          }
        })(),
        {
          encoding: data instanceof Buffer ? void 0 : 'utf-8',
        },
      );

      await cache.set<{
        type: `filecache:${TOtherCacheType}`;
        dataType: string;
        data: string;
      }>(key, {
        type: `filecache:${fileType}`,
        dataType: 'string',
        data: filepath,
      });

      return data;
    } else {
      await cache.set<{
        type: 'value';
        dataType: string;
        data: string | T;
      }>(key, {
        type: 'value',
        dataType: data instanceof Buffer ? 'Buffer' : typeof data,
        data: data instanceof BigInt ? data.toString() : data,
      });

      return data;
    }
  }
}

/**
 * 读取缓存
 * @param key 缓存键
 * @returns 缓存的数据，若不存在则返回 undefined
 */
export async function getCache<T>(key: string): Promise<T | undefined> {
  const cachedData = await cache.get<{
    type: 'redirect' | 'value' | `filecache:${TFileCacheType | TOtherCacheType}`;
    dataType: string;
    data: any;
  }>(key);
  if (!cachedData) {
    return void 0;
  }

  if (cachedData.type === 'redirect') {
    // 处理重定向
    const visitedKeys = new Set<string>([key]);
    let currentKey = cachedData.data as string;
    while (true) {
      if (visitedKeys.has(currentKey)) {
        // 出现循环，停止读取
        throw new Error(`检测到重定向循环，停止读取缓存，循环链: ${Array.from(visitedKeys).join(' -> ')}`);
      }
      visitedKeys.add(currentKey);

      const nextCachedData = await cache.get<{
        type: 'redirect' | 'value' | `filecache:${TFileCacheType | TOtherCacheType}`;
        dataType: string;
        data: any;
      }>(currentKey);
      if (!nextCachedData) {
        return void 0;
      } else if (nextCachedData.type === 'redirect') {
        // 继续重定向
        currentKey = nextCachedData.data as string;
      } else {
        // 找到最终值
        return getCache<T>(currentKey);
      }
    }
  } else if (cachedData.type.startsWith('filecache:')) {
    const filepath = cachedData.data as string;
    if (!fs.existsSync(filepath)) {
      return void 0;
    }
    const fileType = cachedData.type.split(':')[1] as TFileCacheType | TOtherCacheType;

    if (fileType === 'stream') {
      return stream.Readable.from(fs.createReadStream(filepath)) as unknown as T;
    }

    const fileContent = await fs.promises.readFile(filepath, {
      encoding: fileType === 'Buffer' ? void 0 : 'utf-8',
    });
    switch (fileType) {
      case 'Buffer':
        return fileContent as unknown as T;
      case 'string':
        return fileContent as unknown as T;
      case 'bigint':
        return BigInt(fileContent as string) as unknown as T;
      default:
        return JSON.parse(fileContent as string) as T;
    }
  } else {
    switch (cachedData.dataType) {
      case 'bigint':
        return BigInt(cachedData.data as string) as unknown as T;
      default:
        return cachedData.data as T;
    }
  }
}

const cacheController = {
  set: setCache,
  setRedirect: (key: string, targetKey: string, log: SCWC.Log) => setCache<string>(key, targetKey, true, log),
  get: getCache,
  clearAll: async () => {
    // 删除文件缓存目录
    if (fs.existsSync(FILE_CACHE_DIR)) {
      const files = await fs.promises.readdir(FILE_CACHE_DIR);
      for (const file of files) {
        const filepath = path.join(FILE_CACHE_DIR, file);
        await fs.promises.unlink(filepath);
      }
    }
    await cache.clear();
  },
};

export default cacheController;
