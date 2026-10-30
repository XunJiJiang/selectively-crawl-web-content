import {
  PERSISTENT_DATA_KEY,
  POS_KEY,
  MINIMIZED_KEY,
  PLUGIN_EXPANDED_KEY,
  CONFIG_KEY,
  SELECTIVE_CRAWL_KEY,
} from './common.ts';
import {
  USER_SCRIPT_CONFIG_KEY,
  defaultSiteData,
  epoch,
  websiteOrigin,
  type UserScriptSnapshot,
} from '../userscript-config.ts';
import type { TConfig } from '../types/config.d.ts';
import { pathSnapshotSchema, snapshotSchema } from '../userscript-config-schema.ts';

/** 更新本地存储的数据格式 */
export default function updateLocalStorage(defaultConfig?: TConfig) {
  const result = updateLocalStorageFormat_0_to_2_0_0_1();
  if (result === 'error') {
    console.error('旧窗口数据无法解析，将保留原始副本并继续迁移可读取的网站配置');
  }
  updateLocalStorageFormat_2026_10_30(defaultConfig);
  return updateLocalStorageFormat_2026_10_31_origin(defaultConfig);
}

/** 为旧网站数据增加修改日期；新站点的默认值不覆盖核心已有配置。迁移幂等且保留旧键。 */
export function updateLocalStorageFormat_2026_10_30(defaultConfig?: TConfig) {
  if (localStorage.getItem(USER_SCRIPT_CONFIG_KEY)) {
    return;
  }
  if (!/^https?:$/.test(window.location.protocol)) {
    return;
  }
  const data = defaultSiteData(defaultConfig);
  const read = (key: string) => {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }
    if (!localStorage.getItem(`${key}.before-2026-10-30`)) {
      localStorage.setItem(`${key}.before-2026-10-30`, raw);
    }
    try {
      return JSON.parse(raw);
    } catch {
      localStorage.setItem(`${key}.before-2026-10-30`, raw);
      return null;
    }
  };
  const config = read(CONFIG_KEY),
    persistent = read(PERSISTENT_DATA_KEY),
    items = read(SELECTIVE_CRAWL_KEY);
  if (config) {
    for (const key of ['host', 'port', 'token'] as const) {
      if (typeof config.api?.[key] === 'string') {
        data.config.api[key] = config.api[key];
      }
    }
    if (typeof config.plugin?.refreshRule === 'string') {
      data.config.plugin.refreshRule = config.plugin.refreshRule;
    }
    if (['tl', 'tr', 'tc', 'bl', 'br', 'bc'].includes(config.notify?.placement)) {
      data.config.notify.placement = config.notify.placement;
    }
  }
  if (Array.isArray(items)) {
    data.items = items
      .filter((item) => item && typeof item.selector === 'string' && typeof item.label === 'string')
      .map((item) => ({
        selector: item.selector,
        label: item.label,
        prefix: typeof item.prefix === 'string' ? item.prefix : '',
      }));
  }
  if (persistent) {
    let pos = persistent.window?.pos;
    if (typeof pos === 'string') {
      try {
        pos = JSON.parse(pos);
      } catch {
        pos = null;
      }
    }
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) {
      data.window.pos = pos;
    }
    if (typeof persistent.window?.minimized === 'boolean') {
      data.window.minimized = persistent.window.minimized;
    }
    if (typeof persistent.window?.selectionExpanded === 'boolean') {
      data.window.selectionExpanded = persistent.window.selectionExpanded;
    }
    if (typeof persistent.plugin?.expanded === 'boolean') {
      data.plugin.expanded = persistent.plugin.expanded;
    }
    if (typeof persistent.plugin?.activeTab === 'string') {
      data.plugin.activeTab = persistent.plugin.activeTab;
    }
  }
  const snapshot = {
    version: 1,
    website: websiteOrigin(window.location.href),
    updatedAt: config || persistent || items ? new Date().toISOString() : epoch,
    data,
  };
  localStorage.setItem(USER_SCRIPT_CONFIG_KEY, JSON.stringify(snapshot));
}

/** 恢复 origin 配置；保留路径副本，按原修改日期选最新数据且不制造新修改。 */
export function updateLocalStorageFormat_2026_10_31_origin(
  defaultConfig?: TConfig,
  website = window.location.href,
  storage: Storage = localStorage,
): UserScriptSnapshot {
  const origin = websiteOrigin(website);
  let latest: UserScriptSnapshot = {
    version: 1,
    website: origin,
    updatedAt: epoch,
    data: defaultSiteData(defaultConfig),
  };
  const keys = [USER_SCRIPT_CONFIG_KEY];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(USER_SCRIPT_CONFIG_KEY + ':')) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    try {
      const raw = JSON.parse(storage.getItem(key) ?? 'null');
      const parsed =
        key === USER_SCRIPT_CONFIG_KEY ? snapshotSchema.parse(raw) : pathSnapshotSchema.parse(raw);
      if (
        websiteOrigin(parsed.website) !== origin ||
        parsed.updatedAt < latest.updatedAt ||
        (parsed.updatedAt === latest.updatedAt && key !== USER_SCRIPT_CONFIG_KEY)
      ) {
        continue;
      }
      latest = { ...parsed, version: 1, website: origin };
    } catch {
      // 损坏的旧副本保留原键，不能阻断其他有效副本的恢复。
    }
  }
  storage.setItem(USER_SCRIPT_CONFIG_KEY, JSON.stringify(latest));
  return latest;
}

type UpdateResult = 'next' | 'error';

/** 0 -> 2.0.0-1 */
function updateLocalStorageFormat_0_to_2_0_0_1(): UpdateResult {
  const persistentData = localStorage.getItem(PERSISTENT_DATA_KEY);
  if (persistentData) {
    try {
      const parsedData = JSON.parse(persistentData);
      if (
        typeof parsedData === 'object' &&
        parsedData !== null &&
        'version' in parsedData &&
        typeof parsedData.version === 'string'
      ) {
        // 如果 PERSISTENT_DATA_KEY 已经存在, 则不需要更新
        return 'next';
      }
    } catch (error) {
      console.error(
        '解析 PERSISTENT_DATA_KEY 时发生错误: ' +
          (error instanceof Error ? error.message : String(error)),
      );
      return 'error';
    }
  }

  // 在 2.0.0 之前的版本中, 悬浮窗位置和最小化状态是直接存储在 localStorage 中的, 而不是存储在 PERSISTENT_DATA_KEY 中
  const pos = localStorage.getItem(POS_KEY) as { x: number; y: number } | null;
  const minimized = localStorage.getItem(MINIMIZED_KEY) as 'true' | 'false' | null;
  const pluginExpanded = localStorage.getItem(PLUGIN_EXPANDED_KEY) as 'true' | 'false' | null;

  if (pos || minimized || pluginExpanded) {
    const persistentData = {
      version: '2.0.0-1',
      window: {
        ...(pos ? { pos } : {}),
        ...(minimized !== null ? { minimized: minimized === 'true' } : { minimized: true }),
      },
      plugin: {
        ...(pluginExpanded !== null
          ? { expanded: pluginExpanded === 'true' }
          : { expanded: false }),
        activeTab: '',
      },
    };
    localStorage.setItem(PERSISTENT_DATA_KEY, JSON.stringify(persistentData));
    localStorage.removeItem(POS_KEY);
    localStorage.removeItem(MINIMIZED_KEY);
    localStorage.removeItem(PLUGIN_EXPANDED_KEY);
  }
  return 'next';
}
