import type { browser as Browser } from './browser.ts';
import { copySiteData } from '../../shared/userscript-config.ts';
import {
  fromWire,
  toWire,
  validateSnapshot,
  initialSettings,
  initialSnapshot,
  settingsKey,
  siteKey,
  type Settings,
  type SiteData,
  type Snapshot,
} from './model.ts';

type StorageArea = typeof Browser.storage.local;
/** 后台串行处理落盘，避免弹窗关闭、并发输入或同步响应覆盖尚未保存的编辑。 */
export class ExtensionStore {
  private tail: Promise<unknown> = Promise.resolve();
  private area: StorageArea;
  constructor(area: StorageArea) {
    this.area = area;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => undefined);
    return next;
  }
  async settings(): Promise<Settings> {
    return (
      ((await this.area.get(settingsKey))[settingsKey] as Settings | undefined) ?? initialSettings()
    );
  }
  async load(site: string): Promise<Snapshot> {
    const saved = (await this.area.get(siteKey(site)))[siteKey(site)] as Snapshot | undefined;
    return saved ? validateSnapshot(saved) : initialSnapshot(site, (await this.settings()).config);
  }
  saveSettings(settings: Settings) {
    return this.serial(() => this.area.set({ [settingsKey]: settings }));
  }
  patch(site: string, patch: Partial<SiteData>) {
    return this.serial(async () => {
      const current = await this.load(site);
      const next = validateSnapshot({
        ...current,
        updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
        data: { ...current.data, ...copySiteData(patch) },
      });
      await this.area.set({ [siteKey(site)]: next });
      return next;
    });
  }
  accept(site: string, input: unknown, uploadedAt: string) {
    return this.serial(async () => {
      const next = fromWire(input),
        current = await this.load(site);
      if (next.website !== current.website) {
        throw new Error('核心返回的网站归属不匹配');
      }
      if (
        next.updatedAt > current.updatedAt ||
        (current.updatedAt === uploadedAt && next.updatedAt === current.updatedAt)
      ) {
        // fromWire 丢弃悬浮位置和最小化状态，永不写入扩展存储。
        await this.area.set({ [siteKey(site)]: next });
        return next;
      }
      return current;
    });
  }
  wire(snapshot: Snapshot) {
    return toWire(snapshot);
  }
}
