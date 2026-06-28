export const SCWC_TAG = 'SCWC';

export const SELECTIVE_CRAWL_KEY = '__selective_crawl_items__';
export const CONFIG_KEY = '__selective_crawl_config__';

/** 初始位置 */
export const INIT_POS = { x: 40, y: 120 } as const;
/** 本地存储的key, 一些持久化数据 */
export const PERSISTENT_DATA_KEY = 'scw-persistent-data';

// #region 版本 0 的本地存储的key, 仅用于更新本地存储数据格式
/** 本地存储的key, 记录悬浮窗位置 */
export const POS_KEY = 'scw-floating-pos';
/** 本地存储的key, 是否展开元素选择区. 未启用, 每次刷新时重置 */
// const EXPANDED_KEY = 'scw-floating-expanded';
/** 本地存储的key, 是否最小化 */
export const MINIMIZED_KEY = 'scw-floating-minimized';
/** 本地存储的key, 是否展开插件 */
export const PLUGIN_EXPANDED_KEY = 'scw-floating-plugin-expanded';
// #endregion
