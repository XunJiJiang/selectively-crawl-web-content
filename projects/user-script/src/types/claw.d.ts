export type Item = {
  selector: string;
  label: string;
  prefix: string;
};

export interface TCrawlData {
  result: SCWC.TDataItem[];
  failed: string[];
}
