import type { Readable } from 'node:stream';

/** 插件缓存支持的数据类型。 */
export type TPluginCacheableData = string | number | bigint | boolean | object | Buffer | Readable;

/**
 * 已绑定插件命名空间的缓存控制器。
 *
 * 插件不能访问或覆盖命名空间，所有键都会由主服务自动隔离。
 */
export interface IPluginCache {
  /** 写入缓存并返回原值。 */
  set<T extends TPluginCacheableData>(key: string, data: T): Promise<T>;
  /** 将当前键重定向到同一插件命名空间内已经存在的目标键。 */
  setRedirect(key: string, targetKey: string): Promise<string>;
  /** 读取缓存，不存在时返回 undefined。 */
  get<T extends TPluginCacheableData>(key: string): Promise<T | undefined>;
  /** 删除一个缓存键。 */
  del(key: string): Promise<boolean>;
  /** 批量删除缓存键。 */
  mdel(keys: string[]): Promise<boolean>;
}
