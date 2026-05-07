export type PluginItem = Omit<SCWC.TPluginItem, 'trigger'>;

export type PluginConfig = {
  id: string;
  title: string;
  description: string;
  controls: PluginItem[];
};

export type GetCrawlData = () => { result: SCWC.TDataItem[]; failed: string[] };