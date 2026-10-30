import type { TConfig } from './types/config.d.ts';

export interface UserScriptSiteData {
  config: TConfig;
  items: { selector: string; label: string; prefix: string }[];
  window: { pos: { x: number; y: number }; minimized: boolean; selectionExpanded: boolean };
  plugin: { expanded: boolean; activeTab: string };
  controls: { pluginId: string; channel: string; value: string | number | boolean | null }[];
}
export interface UserScriptSnapshot {
  version: 1;
  website: string;
  updatedAt: string;
  data: UserScriptSiteData;
}
export const USER_SCRIPT_CONFIG_KEY = '__scwc_website_config__';
export const CONFIG_CHANGED_EVENT = 'scwc-config-changed';
export const epoch = '1970-01-01T00:00:00.000Z';
export const copySiteData = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export function websiteOrigin(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('网站地址必须使用 HTTP 或 HTTPS');
  }
  return url.origin;
}
export function defaultSiteData(config?: TConfig): UserScriptSiteData {
  return {
    config: config
      ? copySiteData(config)
      : {
          api: { host: 'http://localhost', port: '3200', token: '' },
          plugin: { refreshRule: '//' },
          notify: { placement: 'tr' },
        },
    items: [],
    window: { pos: { x: 40, y: 120 }, minimized: true, selectionExpanded: false },
    plugin: { expanded: false, activeTab: '' },
    controls: [],
  };
}
