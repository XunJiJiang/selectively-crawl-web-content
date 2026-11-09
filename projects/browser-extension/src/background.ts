import { browser, type BrowserTab, type MessageSender, type Reply } from './browser.ts';
import { ExtensionStore } from './storage.ts';
import { requestCore, pendingVersionNotice, dismissVersionNotice } from './core.ts';
import type { VersionNotice } from '../../shared/client-version.ts';
import type { ScriptUIEvent } from '../../shared/script-ui.ts';
import { draftKey, type Draft, type Settings, type SiteData, type Snapshot } from './model.ts';
import { websiteOrigin } from '../../shared/userscript-config.ts';
import type { PluginConfig } from '../../shared/types/plugin.d.ts';
import { installNotificationBadge } from './notification-badge.ts';

installNotificationBadge();

export interface Init {
  tab?: BrowserTab;
  snapshot?: Snapshot;
  settings: Settings;
  draft?: Draft;
  syncBlocked: boolean;
}
export interface PluginBatch {
  data: PluginConfig[];
  activeIds: string[];
  updatedIds: string[];
}
export interface CrawlData {
  result: SCWC.TDataItem[];
  failed: string[];
}
export type Request =
  | { type: 'version.dismiss'; notice: VersionNotice }
  | {
      type: 'plugin.event';
      tab: number;
      site: string;
      plugin: string;
      requireFullContent: boolean;
      request: ScriptUIEvent;
    }
  | { type: 'init' }
  | { type: 'settings.save'; settings: Settings }
  | { type: 'site.patch'; site: string; patch: Partial<SiteData> }
  | { type: 'core.sync'; site: string }
  | {
      type: 'plugins';
      tab: number;
      site: string;
      previousSite?: string;
      pluginId?: string;
      instanceId?: string;
      dirtyFields?: string[];
    }
  | { type: 'crawl'; tab: number; site: string }
  | {
      type: 'trigger';
      tab: number;
      site: string;
      plugin: string;
      channel: string;
      value: string | number | boolean | null;
      relatedValues: Record<string, unknown>;
      requireFullContent: boolean;
      event: 'click' | 'change';
    }
  | {
      type: 'page';
      tab: number;
      site: string;
      command: 'start' | 'parent' | 'undo' | 'cancel' | 'confirm' | 'highlight';
      selector?: string;
    }
  | { type: 'picker.selection'; draft: Draft | null };

const store = new ExtensionStore(browser.storage.local);
const syncCircuitStorageKey = 'scwc.extension.sync-circuit.v1';
const maxSyncFailures = 3;
const syncBlockedMessage = '核心连接已暂停。请修改设置中的 API Token 后重新尝试。';
interface SyncCircuitState {
  failures: number;
  blocked: boolean;
}
async function getSyncCircuit(): Promise<SyncCircuitState> {
  const saved = (await browser.storage.local.get(syncCircuitStorageKey))[syncCircuitStorageKey] as
    | Partial<SyncCircuitState>
    | undefined;
  return {
    failures:
      typeof saved?.failures === 'number'
        ? Math.max(0, Math.min(maxSyncFailures, Math.floor(saved.failures)))
        : 0,
    blocked: saved?.blocked === true,
  };
}
async function setSyncCircuit(state: SyncCircuitState) {
  await browser.storage.local.set({ [syncCircuitStorageKey]: state });
}
function syncBlockedError() {
  return Object.assign(new Error(syncBlockedMessage), { code: 'CORE_SYNC_BLOCKED' });
}
async function withCoreCircuit<T>(request: () => Promise<T>): Promise<T> {
  if ((await getSyncCircuit()).blocked) {
    throw syncBlockedError();
  }
  return request();
}

// Chromium 可禁止内容脚本直接读取 token 等扩展存储；其他浏览器仍通过消息边界隔离页面。
void browser.storage.local
  .setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => undefined);
const syncing = new Map<string, Promise<Snapshot>>();
async function sync(site: string) {
  const running = syncing.get(site);
  if (running) {
    await running;
    return sync(site);
  }
  const work = (async () => {
    if ((await getSyncCircuit()).blocked) {
      throw syncBlockedError();
    }
    try {
      const snapshot = await store.load(site);
      const response = await requestCore<{ data: { snapshot: unknown } }>(
        snapshot.data.config,
        site,
        '/api/userscript/config/sync',
        { snapshot: store.wire(snapshot), watch: false },
      );
      const accepted = await store.accept(site, response.data.snapshot, snapshot.updatedAt);
      await setSyncCircuit({ failures: 0, blocked: false });
      return accepted;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'CORE_SYNC_BLOCKED') {
        throw error;
      }
      const circuit = await getSyncCircuit();
      const failures = Math.min(maxSyncFailures, circuit.failures + 1);
      const blocked = failures >= maxSyncFailures;
      await setSyncCircuit({ failures, blocked });
      if (blocked) {
        throw syncBlockedError();
      }
      throw error;
    }
  })();
  syncing.set(site, work);
  try {
    return await work;
  } finally {
    if (syncing.get(site) === work) {
      syncing.delete(site);
    }
  }
}
async function tabAt(tab: number, site: string) {
  const current = await browser.tabs.get(tab);
  if (current.url !== site) {
    throw new Error('网页地址已变化，请重新打开插件');
  }
  websiteOrigin(site);
  return current;
}
async function page<T>(tab: number, site: string, command: unknown): Promise<T> {
  await tabAt(tab, site);
  try {
    await browser.tabs.sendMessage(tab, { type: 'scwc.page', command: 'ping' });
  } catch {
    await browser.scripting.executeScript({ target: { tabId: tab }, files: ['content.js'] });
  }
  const reply = await browser.tabs.sendMessage<Reply<T>>(tab, {
    type: 'scwc.page',
    site,
    ...(command as object),
  });
  if (!reply?.ok) {
    throw new Error(reply?.error ?? '无法读取当前网页');
  }
  return reply.data as T;
}
async function extract(tab: number, site: string, full = true) {
  const snapshot = await store.load(site);
  const data = await page<CrawlData>(tab, site, { command: 'extract', items: snapshot.data.items });
  await tabAt(tab, site);
  if (full && data.failed.length) {
    throw new Error(`以下抓取项在当前页面不存在：${data.failed.join('、')}`);
  }
  return { snapshot, data };
}
async function handle(message: Request, sender: MessageSender): Promise<unknown> {
  if (message.type === 'picker.selection') {
    const tab = sender.tab;
    if (sender.id !== browser.runtime.id || tab?.id === undefined || !sender.url) {
      throw new Error('选择结果来源无效');
    }
    const current = await browser.tabs.get(tab.id);
    if (
      sender.url !== current.url ||
      (message.draft &&
        (message.draft.site !== sender.url ||
          typeof message.draft.selector !== 'string' ||
          message.draft.selector.length > 16384))
    ) {
      throw new Error('页面已经切换');
    }
    if (message.draft) {
      await browser.storage.local.set({ [draftKey(tab.id)]: message.draft });
    } else {
      await browser.storage.local.remove(draftKey(tab.id));
    }
    return;
  }
  // 仅扩展自己的弹窗可操作核心与凭据；网页内容脚本不能借消息代理任意请求。
  if (
    sender.id !== browser.runtime.id ||
    sender.tab ||
    sender.url !== browser.runtime.getURL('index.html')
  ) {
    throw new Error('请求来源不是扩展弹窗');
  }
  switch (message.type) {
    case 'version.dismiss':
      return dismissVersionNotice(message.notice);
    case 'plugin.event': {
      await tabAt(message.tab, message.site);
      const { snapshot, data } = message.request.readOnly
        ? { snapshot: await store.load(message.site), data: { result: [] } }
        : await extract(message.tab, message.site, message.requireFullContent);
      return withCoreCircuit(() =>
        requestCore(snapshot.data.config, message.site, '/api/plugin/event', {
          ...message.request,
          version: 'v2',
          id: message.plugin,
          data: data.result,
        }),
      );
    }
    case 'init': {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const settings = await store.settings();
      if (!tab?.url || tab.id === undefined || !/^https?:/.test(tab.url)) {
        return { tab, settings, syncBlocked: (await getSyncCircuit()).blocked };
      }
      const draft = (await browser.storage.local.get(draftKey(tab.id)))[draftKey(tab.id)] as
        | Draft
        | undefined;
      return {
        tab,
        settings,
        syncBlocked: (await getSyncCircuit()).blocked,
        snapshot: await store.load(tab.url),
        draft: draft?.site === tab.url ? draft : undefined,
      };
    }
    case 'settings.save': {
      const previous = await store.settings();
      const saved = await store.saveSettings(message.settings);
      if (previous.config.api.token !== message.settings.config.api.token) {
        await setSyncCircuit({ failures: 0, blocked: false });
      }
      return saved;
    }
    case 'site.patch': {
      const previous = await store.load(message.site);
      const next = await store.patch(message.site, message.patch);
      if (
        message.patch.config &&
        previous.data.config.api.token !== message.patch.config.api.token
      ) {
        await setSyncCircuit({ failures: 0, blocked: false });
      }
      return next;
    }
    case 'core.sync':
      return sync(message.site);
    case 'plugins': {
      await tabAt(message.tab, message.site);
      const snapshot = await store.load(message.site);
      return withCoreCircuit(() =>
        requestCore(
          snapshot.data.config,
          message.site,
          '/api/plugin/config',
          {},
          message.previousSite,
          message.pluginId,
          message.instanceId
            ? { instanceId: message.instanceId, dirtyFields: message.dirtyFields ?? [] }
            : undefined,
        ),
      );
    }
    case 'page': {
      const result = await page(message.tab, message.site, {
        command: message.command,
        selector: message.selector,
      });
      if (
        message.command === 'confirm' ||
        message.command === 'cancel' ||
        message.command === 'start'
      ) {
        await browser.storage.local.remove(draftKey(message.tab));
      }
      if (message.command === 'parent' || message.command === 'undo') {
        await browser.storage.local.set({ [draftKey(message.tab)]: result });
      }
      return result;
    }
    case 'crawl': {
      const { snapshot, data } = await extract(message.tab, message.site);
      return withCoreCircuit(() =>
        requestCore(snapshot.data.config, message.site, '/api/metadata/scrape', {
          site: message.site,
          data: data.result,
        }),
      );
    }
    case 'trigger': {
      const { snapshot, data } = await extract(
        message.tab,
        message.site,
        message.requireFullContent,
      );
      return withCoreCircuit(() =>
        requestCore(snapshot.data.config, message.site, '/api/plugin/toggle', {
          version: 'v1',
          type: message.event,
          channel: message.channel,
          id: message.plugin,
          context: {
            data: data.result,
            site: message.site,
            relatedValues: message.relatedValues,
            value: message.value,
          },
        }),
      );
    }
  }
}
browser.runtime.onMessage.addListener((input, sender, respond) => {
  void handle(input as Request, sender).then(
    (data) => respond({ ok: true, data, versionNotice: pendingVersionNotice }),
    (error: unknown) =>
      respond({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof Error && 'code' in error ? error.code : undefined,
      }),
  );
  return true;
});
browser.tabs.onRemoved.addListener((tab) => {
  void browser.storage.local.remove(draftKey(tab));
});
browser.tabs.onUpdated.addListener((tab, change) => {
  if (change.status === 'loading') {
    void browser.storage.local.remove(draftKey(tab));
  }
});
