import { config as defaultConfig } from './migrate.ts';
import { ConfigController } from '../../shared/store/config.ts';
import { CONFIG_KEY, PERSISTENT_DATA_KEY, SELECTIVE_CRAWL_KEY } from '../../shared/utils/common.ts';
import {
  CONFIG_CHANGED_EVENT,
  USER_SCRIPT_CONFIG_KEY,
  copySiteData,
  type UserScriptSiteData,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';
import { snapshotSchema } from '../../shared/userscript-config-schema.ts';
import { updateLocalStorageFormat_2026_10_31_origin } from '../../shared/utils/updateLocalStorage.ts';

export class SiteStore extends EventTarget {
  snapshot: UserScriptSnapshot;
  private storage: Storage;
  constructor(storage: Storage, website: string) {
    super();
    this.storage = storage;
    this.snapshot = updateLocalStorageFormat_2026_10_31_origin(defaultConfig, website, storage);
  }
  storageChanged(key: string | null, value: string | null) {
    if (key === USER_SCRIPT_CONFIG_KEY && value) {
      this.accept(JSON.parse(value));
    }
  }
  update(change: (data: UserScriptSiteData) => void) {
    const data = copySiteData(this.snapshot.data);
    change(data);
    if (JSON.stringify(data) === JSON.stringify(this.snapshot.data)) {
      return;
    }
    this.commit(
      {
        ...this.snapshot,
        data,
        updatedAt: new Date(
          Math.max(Date.now(), Date.parse(this.snapshot.updatedAt) + 1),
        ).toISOString(),
      },
      'local',
    );
  }
  accept(input: unknown, settleEqual = false) {
    const next = snapshotSchema.parse(input);
    if (next.website !== this.snapshot.website) {
      throw new Error('同步的网站配置归属不匹配');
    }
    if (
      next.updatedAt < this.snapshot.updatedAt ||
      (!settleEqual && next.updatedAt === this.snapshot.updatedAt)
    ) {
      return;
    }
    if (JSON.stringify(next) !== JSON.stringify(this.snapshot)) {
      this.commit(next, 'remote');
    }
  }
  private commit(snapshot: UserScriptSnapshot, source: 'local' | 'remote') {
    // 先写规范副本；保存失败时保留内存旧版本并将错误交给调用方。
    this.storage.setItem(USER_SCRIPT_CONFIG_KEY, JSON.stringify(snapshot));
    this.snapshot = copySiteData(snapshot);
    this.storage.setItem(CONFIG_KEY, JSON.stringify(snapshot.data.config));
    this.storage.setItem(SELECTIVE_CRAWL_KEY, JSON.stringify(snapshot.data.items));
    this.storage.setItem(
      PERSISTENT_DATA_KEY,
      JSON.stringify({
        version: '2.0.0-1',
        window: snapshot.data.window,
        plugin: snapshot.data.plugin,
      }),
    );
    this.dispatchEvent(new CustomEvent('change', { detail: { source } }));
  }
}

export const siteStore = new SiteStore(localStorage, window.location.origin);
ConfigController.applyConfig(siteStore.snapshot.data.config);
siteStore.addEventListener('change', () => {
  ConfigController.applyConfig(siteStore.snapshot.data.config);
});
window.addEventListener(CONFIG_CHANGED_EVENT, () =>
  siteStore.update((data) => {
    data.config = ConfigController.config;
  }),
);
window.addEventListener('storage', (event) => {
  try {
    siteStore.storageChanged(event.key, event.newValue);
  } catch (error) {
    console.warn('网站配置跨窗口同步失败', error);
  }
});
