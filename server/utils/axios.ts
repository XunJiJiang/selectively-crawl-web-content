import originAxios, { type AxiosRequestConfig, type CancelTokenSource } from 'axios';
import { ProxyAgent } from 'proxy-agent';
import cacheController from './cache.ts';
import tryCatch from './tryCatch.ts';
import type { Readable } from 'node:stream';
import type { TLogger } from './log.ts';

const TIMEOUT = 10000;

const agent = new ProxyAgent({
  maxSockets: 5,
  timeout: TIMEOUT,
});

const axios = originAxios.create();
axios.defaults.timeout = TIMEOUT;

// 拦截请求 (http 代理)
axios.interceptors.request.use(config => {
  config.httpAgent = agent.httpAgent;
  config.httpsAgent = agent.httpsAgent;
  return config;
});

/** 标记: 自定义返回数据未设置 */
const CUSTOM_RES_DATA_UNSET = Symbol('CUSTOM_RES_DATA_UNSET');

/**
 * 带重试的请求
 */
class RetryRequest<RAW, CUSTOM_RES> {
  /** 最大重试次数 */
  private static defaultLimit = 5;
  /** 重试延迟时间 (毫秒) */
  private static defaultRetryDelay = 2000;
  /** 超时时间 (毫秒) */
  private static defaultTimeout = TIMEOUT;

  /**
   * 插件命名空间, 用于区分不同插件的缓存
   */
  private namespace: string | undefined = '';

  private logger: TLogger;

  private url: string;
  /** 当前重试次数 */
  private retryCount: number = 0;
  /** axios config */
  private config: AxiosRequestConfig;

  /** 取消请求 */
  private abort: CancelTokenSource | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;

  /**
   * 自定义的返回数据类型
   */
  protected customResData: CUSTOM_RES | typeof CUSTOM_RES_DATA_UNSET = CUSTOM_RES_DATA_UNSET;

  public getCustomResData(): CUSTOM_RES | typeof CUSTOM_RES_DATA_UNSET {
    return this.customResData;
  }

  public constructor(url: string, config: AxiosRequestConfig, namespace: string | undefined, logger: TLogger) {
    this.url = url;
    this.config = config;
    this.namespace = namespace;
    this.logger = logger;

    // 当连接来源为 hvdb 时, 禁用代理
    if (this.url.indexOf('hvdb') !== -1) {
      this.config.proxy = false;
    }
  }

  /** 重定向链 */
  private redirectedUrls = new Set<string>();

  /** 读取缓存 */
  private async getCache(): Promise<RAW | void> {
    return cacheController.get<RAW>(this.url, this.namespace);
  }

  /** 写入缓存以及重定向链 */
  private async setCache(data: RAW): Promise<RAW> {
    if (this.redirectedUrls.size <= 1) {
      return await cacheController.set<RAW>(this.url, data, this.namespace, false, this.logger);
    } else {
      // 写入重定向链
      // 最后一个 URL 写入实际数据
      const urls = Array.from(this.redirectedUrls).reverse();
      const _data = await cacheController.set<RAW>(urls[0], data, this.namespace, false, this.logger);
      // 其他 URL 写入重定向指向
      for (let i = 1; i < urls.length; i++) {
        await cacheController.setRedirect(urls[i], urls[i - 1], this.namespace, this.logger);
      }
      return _data;
    }
  }

  /** 删除缓存 */
  public async delCache() {
    return await cacheController.mdel(Array.from(this.redirectedUrls), this.namespace);
  }

  /**
   * 初始化新一次的请求配置
   * @param url 请求 URL, 用于更新重定向链
   */
  protected initConfig(url: string) {
    this.abort = originAxios.CancelToken.source();
    this.config.cancelToken = this.abort.token;
    this.customResData = CUSTOM_RES_DATA_UNSET;
    if (!this.redirectedUrls.has(url)) {
      this.redirectedUrls.add(url);
    }
    this.timeoutHandle = setTimeout(() => {
      if (this.abort) {
        this.abort.cancel(`Timeout of ${RetryRequest.defaultTimeout}ms.`);
      }
    }, RetryRequest.defaultTimeout);
  }

  /**
   * 发起静态页面请求
   */
  private async get(): Promise<RAW> {
    return new Promise<RAW>(async (resolve, reject) => {
      const [err] = tryCatch(() => this.initConfig(this.url));

      if (err) {
        this.logger.error(
          `初始化请求时发生错误, 这可能是自定义初始化内容中存在未捕获的错误导致的. 这不会对请求产生影响, 但可能导致自定义数据出错: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
      }

      // 先读取缓存
      const [cacheErr, cachedData] = await tryCatch(async () => await this.getCache());
      if (!cacheErr && cachedData) {
        clearTimeout(this.timeoutHandle!);
        this.logger.info(`从缓存中读取数据: ${this.url}`);
        resolve(cachedData);
        return;
      }

      try {
        this.logger.info(`尝试请求: ${this.url}`);
        const response = await axios.get(this.url, this.config);
        clearTimeout(this.timeoutHandle!);

        let data: RAW = response.data;

        resolve(await this.setCache(data));
        return;
      } catch (error) {
        if (originAxios.isCancel(error)) {
          reject(
            new originAxios.AxiosError(
              `Request cancelled: ${error.message}`,
              error.code,
              error.config,
              error.request,
              error.response,
            ),
          );
          return;
        } else {
          clearTimeout(this.timeoutHandle!);
          reject(error);
          return;
        }
      }
    });
  }

  /** 发起重试请求 */
  public async retryGet(): Promise<RAW> {
    try {
      this.logger.info(`${this.url} 第 ${this.retryCount + 1} 次尝试`);
      const data = await this.get();
      return data;
    } catch (error) {
      if (
        this.retryCount + 1 < RetryRequest.defaultLimit &&
        error instanceof originAxios.AxiosError &&
        (!error.response || (error.response && error.response.status >= 500))
      ) {
        this.retryCount += 1;

        // 检查是否经过转发
        const redirectedUrl =
          error.request && error.request._currentRequest && error.request._currentRequest.path
            ? error.request._currentRequest.path
            : null;
        if (redirectedUrl) {
          this.url = redirectedUrl;
          this.logger.info(`请求被重定向到 ${this.url}`);
        }

        await new Promise(resolve => setTimeout(resolve, RetryRequest.defaultRetryDelay));
        return this.retryGet();
      } else {
        throw error;
      }
    }
  }
}

/** responseType 和 返回数据类型的映射关系 */
type ResponseTypeMap = {
  arraybuffer: ArrayBuffer;
  blob: Blob;
  document: Document;
  json: any;
  text: string;
  stream: Readable;
};

/** retryGet 函数的返回类型 */
type TRetryGetReturn<RES, A extends AxiosRequestConfig> = {
  raw: A extends { responseType: infer R }
    ? R extends keyof ResponseTypeMap
      ? ResponseTypeMap[R]
      : ResponseTypeMap['text']
    : ResponseTypeMap['text'];
  data: RES | undefined;
  delCache: () => Promise<boolean>;
};

/** retryGet 函数的类型 */
export type TRetryGet<RES, A extends AxiosRequestConfig = AxiosRequestConfig> = (
  url: string,
  config: A,
) => Promise<TRetryGetReturn<RES, A>>;

/**
 * 这是为 plugin-env.d.ts 提供的类型声明, 和 createRetryGet 函数相比, 移除了 namespace 参数和    参数
 * 因为 plugin-env.d.ts 中的内容是提供给插件使用的, 而 namespace 在插件中是不可见, 而 logger 由主服务提供
 */
export type TCreateRetryGet<RES, A extends AxiosRequestConfig = AxiosRequestConfig> = (
  createRetryRequestClass?: (
    ClassRetryRequest: typeof RetryRequest<
      A extends { responseType: infer R }
        ? R extends keyof ResponseTypeMap
          ? ResponseTypeMap[R]
          : ResponseTypeMap['text']
        : ResponseTypeMap['text'],
      RES
    >,
  ) => typeof RetryRequest<
    A extends { responseType: infer R }
      ? R extends keyof ResponseTypeMap
        ? ResponseTypeMap[R]
        : ResponseTypeMap['text']
      : ResponseTypeMap['text'],
    RES
  >,
) => TRetryGet<RES, A>;

/**
 * 自定义重试请求函数
 * @param namespace 插件命名空间, 用于区分不同插件的缓存
 * @param logger 日志实例
 * @param createRetryRequestClass 自定义请求类
 * @returns
 */
export function createRetryGet<RES, A extends AxiosRequestConfig = AxiosRequestConfig>(
  namespace: string | undefined,
  logger: TLogger,
  createRetryRequestClass?: (
    ClassRetryRequest: typeof RetryRequest<
      A extends { responseType: infer R }
        ? R extends keyof ResponseTypeMap
          ? ResponseTypeMap[R]
          : ResponseTypeMap['text']
        : ResponseTypeMap['text'],
      RES
    >,
  ) => typeof RetryRequest<
    A extends { responseType: infer R }
      ? R extends keyof ResponseTypeMap
        ? ResponseTypeMap[R]
        : ResponseTypeMap['text']
      : ResponseTypeMap['text'],
    RES
  >,
): TRetryGet<RES, A> {
  const RequestClass = createRetryRequestClass ? createRetryRequestClass(RetryRequest) : RetryRequest;
  return async function retryGet<A extends AxiosRequestConfig>(
    url: string,
    config: A,
  ): Promise<TRetryGetReturn<RES, A>> {
    const request = new RequestClass(url, config, namespace, logger);
    const raw = (await request.retryGet()) as A extends {
      responseType: infer R;
    }
      ? R extends keyof ResponseTypeMap
        ? ResponseTypeMap[R]
        : string
      : string;
    const customResData = request.getCustomResData();
    const data = customResData === CUSTOM_RES_DATA_UNSET ? undefined : customResData;
    return {
      raw,
      data,
      delCache: async () => await request.delCache(),
    };
  };
}

// export async function retryGet<A extends AxiosRequestConfig>(
//   url: string,
//   config: A,
//   logger: TLogger,
// ): Promise<{
//   data: A extends { responseType: infer R }
//     ? R extends keyof ResponseTypeMap
//       ? ResponseTypeMap[R]
//       : ResponseTypeMap['text']
//     : ResponseTypeMap['text'];
//   rjcodes: NumberCode[];
// }> {
//   const rc = createRetryGet<null>('test', logger, ClassRetryRequest => {
//     return class extends ClassRetryRequest {
//       protected initConfig(url: string) {
//         super.initConfig(url);
//         this.customResData = null;
//       }
//     };
//   });

//   const res = await rc(url, {
//     responseType: 'text',
//   });

//   const request = new RetryRequest<
//     A extends { responseType: infer R }
//       ? R extends keyof ResponseTypeMap
//         ? ResponseTypeMap[R]
//         : ResponseTypeMap['text']
//       : ResponseTypeMap['text']
//   >(url, config, logger);
//   const data = await request.retryGet();
//   const rjcodes = request.getRjcodes()!;
//   return {
//     data,
//     rjcodes,
//   };
// }

// export default axios;

/**
 * 并发限制
 */
export class LimitPromise {
  private concurrency: number;
  private runningCount: number = 0;
  private taskQueue: (() => Promise<any>)[] = [];

  public constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  public addTask<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const runTask = async () => {
        this.runningCount++;
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.runningCount--;
          this.next();
        }
      };

      if (this.runningCount < this.concurrency) {
        runTask();
      } else {
        this.taskQueue.push(runTask);
      }
    });
  }

  private next() {
    if (this.taskQueue.length > 0 && this.runningCount < this.concurrency) {
      const task = this.taskQueue.shift();
      task?.();
    } else if (this.runningCount === 0 && this.taskQueue.length === 0) {
      this.allTasksDonePromise?.resolve();
      this.allTasksDonePromise = null;
    }
  }

  private allTasksDonePromise: {
    resolve: () => void;
    promise: Promise<void>;
  } | null = null;

  /**
   * 等待所有任务完成, 包括之后添加的任务
   */
  public async waitAll(): Promise<void> {
    if (!this.allTasksDonePromise) {
      this.allTasksDonePromise = {} as {
        resolve: () => void;
        promise: Promise<void>;
      };
      const promise = new Promise<void>(resolve => {
        this.allTasksDonePromise!.resolve = resolve;
      });
      this.allTasksDonePromise.promise = promise;
    }
    return this.allTasksDonePromise.promise;
  }
}
