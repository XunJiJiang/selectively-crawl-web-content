export type PluginItem = Omit<SCWC.TPluginItem, 'trigger'>;

export type TRequiredOptions = Required<Required<PluginItem>['options']>;

export type PluginConfig = {
  id: string;
  title: string;
  description: string;
  controls: PluginItem[];
};

export type GetCrawlData = () => { result: SCWC.TDataItem[]; failed: string[] };