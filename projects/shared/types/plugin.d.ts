export type PluginItem = Omit<SCWC.TPluginItem, 'trigger'>;

export type TRequiredOptions = Required<Required<PluginItem>['options']>;

export interface PluginConfig {
  id: string;
  title: string;
  description: string;
  /** 核心按当前网站解析出的插件声明规则，只读展示/传输。 */
  refreshRule?: string;
  controls: PluginItem[];
}

export type GetCrawlData = () => { result: SCWC.TDataItem[]; failed: string[] };
