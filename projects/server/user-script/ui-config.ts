import { getPluginConfig } from '../workbench/plugin-config.ts';
import { getUserScriptConfig } from './config.ts';
import { defaultSiteData, websiteOrigin } from '../../shared/userscript-config.ts';
import { safeKey, uiAssert, type FieldValue } from '../../shared/declarative-ui.ts';

export interface ScriptConfigBaseline {
  value?: FieldValue;
  schemaRevision: number;
}
export interface ScriptConfigStorage {
  read(scope: 'plugin' | 'site', site: string, key: string): Promise<ScriptConfigBaseline>;
  write(
    scope: 'plugin' | 'site',
    site: string,
    key: string,
    value: string,
    baseline: ScriptConfigBaseline,
    boolean: boolean,
  ): Promise<ScriptConfigBaseline>;
}

/** Called in core, with plugin identity supplied by the authenticated process. */
export function scriptConfigStorage(pluginId: string): ScriptConfigStorage {
  const readSite = (site: string, key: string) =>
    getUserScriptConfig()
      .get(site)
      ?.data.controls.find(
        (item) => item.pluginId === pluginId && item.channel === `v2:config:${key}`,
      )?.value;
  return {
    async read(scope, site, key) {
      safeKey(key);
      if (scope === 'plugin') {
        const snapshot = getPluginConfig().snapshot(pluginId);
        return { value: snapshot.effectiveValues[key], schemaRevision: snapshot.schemaRevision };
      }
      const value = readSite(site, key);
      return {
        value: value === null || typeof value === 'number' ? undefined : value,
        schemaRevision: 0,
      };
    },
    async write(scope, site, key, value, baseline, boolean) {
      safeKey(key);
      if (scope === 'plugin') {
        const snapshot = getPluginConfig().snapshot(pluginId);
        uiAssert(
          snapshot.schemaRevision === baseline.schemaRevision &&
            snapshot.effectiveValues[key] === baseline.value,
          'UI_CONFIG_CONFLICT',
          '此配置已被其他调用更新，请刷新后重新编辑',
        );
        const result = await getPluginConfig().update(
          pluginId,
          { [key]: value },
          {
            baseRevision: snapshot.revision,
            schemaRevision: baseline.schemaRevision,
            verifiedDefinitions: true,
          },
        );
        return { value: result.effectiveValues[key], schemaRevision: result.schemaRevision };
      }
      // No await between the field CAS and the existing transactional snapshot sync.
      uiAssert(
        readSite(site, key) === baseline.value,
        'UI_CONFIG_CONFLICT',
        '此站点配置已被其他调用更新，请刷新后重新编辑',
      );
      const db = getUserScriptConfig();
      const previous = db.get(site);
      const data = structuredClone(previous?.data ?? defaultSiteData());
      data.controls = data.controls.filter(
        (item) => item.pluginId !== pluginId || item.channel !== `v2:config:${key}`,
      );
      const stored = boolean ? value === 'true' : value;
      data.controls.push({ pluginId, channel: `v2:config:${key}`, value: stored });
      db.sync({
        version: 1,
        website: websiteOrigin(site),
        updatedAt: new Date(
          Math.max(Date.now(), Date.parse(previous?.updatedAt ?? '') + 1 || 0),
        ).toISOString(),
        data,
      });
      return { value: stored, schemaRevision: 0 };
    },
  };
}
