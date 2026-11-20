import type { browser as Browser } from './browser.ts';
import { copySiteData } from '../../shared/userscript-config.ts';
import { snapshotSchema } from '../../shared/userscript-config-schema.ts';
import {
  fromWire,
  changedConnection,
  toWire,
  validateSnapshot,
  initialSettings,
  initialSnapshot,
  settingsKey,
  siteKey,
  navigationKey,
  popupPanels,
  type PopupNavigation,
  type Settings,
  type SiteData,
  type Snapshot,
} from './model.ts';

type StorageArea = typeof Browser.storage.local;
const configFields = snapshotSchema.shape.data.shape.config.shape;

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
    await this.tail;
    return this.readSettings();
  }
  private async readSettings(): Promise<Settings> {
    const saved = (await this.area.get(settingsKey))[settingsKey] as
      | { config?: Partial<Record<keyof Settings['config'], unknown>>; theme?: unknown }
      | undefined;
    const defaults = initialSettings();
    return {
      config: {
        api: configFields.api.safeParse(saved?.config?.api).data ?? defaults.config.api,
        plugin: configFields.plugin.safeParse(saved?.config?.plugin).data ?? defaults.config.plugin,
        notify: configFields.notify.safeParse(saved?.config?.notify).data ?? defaults.config.notify,
      },
      theme: saved?.theme === 'light-2026' ? saved.theme : defaults.theme,
    };
  }
  async load(site: string): Promise<Snapshot> {
    await this.tail;
    return this.readSnapshot(site);
  }
  private async readSnapshot(site: string): Promise<Snapshot> {
    const saved = (await this.area.get(siteKey(site)))[siteKey(site)] as Snapshot | undefined;
    return saved
      ? validateSnapshot(saved)
      : initialSnapshot(site, (await this.readSettings()).config);
  }
  async navigation(site: string): Promise<PopupNavigation> {
    await this.tail;
    const saved = (await this.area.get(navigationKey(site)))[navigationKey(site)] as
      | Partial<PopupNavigation>
      | undefined;
    return {
      panel: popupPanels.find((panel) => panel === saved?.panel) ?? 'capture',
      activePlugin:
        typeof saved?.activePlugin === 'string'
          ? saved.activePlugin
          : (await this.load(site)).data.plugin.activeTab,
    };
  }
  saveNavigation(site: string, navigation: PopupNavigation) {
    return this.serial(() => this.area.set({ [navigationKey(site)]: navigation }));
  }
  saveSettings(patch: Partial<Settings>, site?: string) {
    return this.serial(async () => {
      const previous = await this.readSettings();
      const settings = { ...previous, ...patch };
      if (site && patch.config) {
        settings.config = { ...previous.config, api: patch.config.api };
      }
      const values: Record<string, Settings | Snapshot> = { [settingsKey]: settings };
      let snapshot: Snapshot | undefined;
      let siteConnectionChanged = false;
      if (site && patch.config) {
        const current = await this.readSnapshot(site);
        const config = { ...current.data.config, api: settings.config.api };
        siteConnectionChanged = changedConnection(current.data.config, config);
        snapshot = siteConnectionChanged ? this.applyPatch(current, { config }) : current;
        if (siteConnectionChanged) {
          values[siteKey(site)] = snapshot;
        }
      }
      await this.area.set(values);
      return {
        settings,
        snapshot,
        connectionChanged: changedConnection(previous.config, settings.config),
        siteConnectionChanged,
      };
    });
  }
  private applyPatch(current: Snapshot, patch: Partial<SiteData>) {
    return validateSnapshot({
      ...current,
      updatedAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt) + 1)).toISOString(),
      data: { ...current.data, ...copySiteData(patch) },
    });
  }
  patch(site: string, patch: Partial<SiteData>) {
    return this.serial(async () => {
      const next = this.applyPatch(await this.readSnapshot(site), patch);
      await this.area.set({ [siteKey(site)]: next });
      return next;
    });
  }
  accept(site: string, input: unknown, uploadedAt: string, uploadedConfig?: Settings['config']) {
    return this.serial(async () => {
      const next = fromWire(input),
        current = await this.readSnapshot(site);
      if (next.website !== current.website) {
        throw new Error('核心返回的网站归属不匹配');
      }
      if (uploadedConfig && changedConnection(uploadedConfig, current.data.config)) {
        return current;
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
