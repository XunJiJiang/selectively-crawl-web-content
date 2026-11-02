import {
  copySiteData,
  defaultSiteData,
  epoch,
  websiteOrigin,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';
import { snapshotSchema } from '../../shared/userscript-config-schema.ts';
import type { TConfig } from '../../shared/types/config.d.ts';

export type Item = UserScriptSnapshot['data']['items'][number];
export type SiteData = Omit<UserScriptSnapshot['data'], 'window'> & { selectionExpanded: boolean };
export interface Snapshot {
  version: 1;
  website: string;
  updatedAt: string;
  data: SiteData;
}
export interface Settings {
  config: TConfig;
  theme: 'dark-2026' | 'light-2026';
}
export interface Draft {
  site: string;
  selector: string;
  depth: number;
}
export const settingsKey = 'scwc.extension.settings.v1';
export const siteKey = (site: string) => `scwc.extension.site.v1:${websiteOrigin(site)}`;
export const draftKey = (tab: number) => `scwc.extension.selection.v1:${tab}`;
export const initialSettings = (): Settings => ({
  config: defaultSiteData().config,
  theme: 'dark-2026',
});
export function fromWire(input: unknown): Snapshot {
  const snapshot = snapshotSchema.parse(input);
  const { window, ...data } = snapshot.data;
  return { ...snapshot, data: { ...data, selectionExpanded: window.selectionExpanded } };
}
export function toWire(snapshot: Snapshot): UserScriptSnapshot {
  const { selectionExpanded, ...data } = copySiteData(snapshot.data);
  return {
    ...snapshot,
    data: { ...data, window: { ...defaultSiteData().window, selectionExpanded } },
  };
}
export function initialSnapshot(site: string, config: TConfig): Snapshot {
  return fromWire({
    version: 1,
    website: websiteOrigin(site),
    updatedAt: epoch,
    data: defaultSiteData(config),
  });
}
export function validateSnapshot(input: Snapshot): Snapshot {
  return fromWire(toWire(input));
}
export function coreAddress(config: TConfig, path = '/') {
  const url = new URL(config.api.host);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !/^\d+$/.test(config.api.port) ||
    +config.api.port < 1 ||
    +config.api.port > 65535
  ) {
    throw new Error('请输入有效的 HTTP(S) 核心地址和端口（1–65535）');
  }
  url.port = config.api.port;
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url;
}
// WebExtensions 的匹配模式不支持端口，授权按协议和主机申请。
export const permissionOrigin = (config: TConfig) => {
  const url = coreAddress(config);
  return `${url.protocol}//${url.hostname}/*`;
};
