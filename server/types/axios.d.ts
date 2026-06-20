import { type AxiosRequestConfig } from 'axios';
import type { TLogger } from '../types/log.d.ts';

export interface IRetryRequest<RAW, CUSTOM_RES> {
  customResData: CUSTOM_RES | unique symbol;
  getCustomResData (): CUSTOM_RES | unique symbol;
  delCache (): Promise<boolean>;
  initConfig (url: string): void;
  retryGet (): Promise<RAW>;
}

export type TRetryRequestClass<RAW, CUSTOM_RES> = new (
  url: string,
  config: AxiosRequestConfig,
  namespace: string | undefined,
  logger: TLogger,
) => IRetryRequest<RAW, CUSTOM_RES>;

/** retryGet 函数的类型 */
export type TRetryGet<RES, A extends AxiosRequestConfig = AxiosRequestConfig> = (
  url: string,
  config: A,
) => Promise<TRetryGetReturn<RES, A>>;

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

/**
 * 这是为 plugin-env.d.ts 提供的类型声明, 和 createRetryGet 函数相比, 移除了 namespace 参数和    参数
 * 因为 plugin-env.d.ts 中的内容是提供给插件使用的, 而 namespace 在插件中是不可见, 而 logger 由主服务提供
 */
export type TCreateRetryGet<RES, A extends AxiosRequestConfig = AxiosRequestConfig> = (
  createRetryRequestClass?: (
    ClassRetryRequest: TRetryRequestClass<
      A extends { responseType: infer R }
      ? R extends keyof ResponseTypeMap
      ? ResponseTypeMap[R]
      : ResponseTypeMap['text']
      : ResponseTypeMap['text'],
      RES
    >,
  ) => TRetryRequestClass<
    A extends { responseType: infer R }
    ? R extends keyof ResponseTypeMap
    ? ResponseTypeMap[R]
    : ResponseTypeMap['text']
    : ResponseTypeMap['text'],
    RES
  >,
) => TRetryGet<RES, A>;