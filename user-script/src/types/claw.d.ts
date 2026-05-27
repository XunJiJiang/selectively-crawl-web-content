export type Item = {
  selector: string,
  label: string,
  prefix: string,
}

export type TCrawlData = {
  result: SCWC.TDataItem[],
  failed: string[],
}