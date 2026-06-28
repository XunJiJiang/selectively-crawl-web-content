export type TCrawlResult =
  | {
      pluginInfo: {
        name: string;
      };
      info: string;
      type: 'success' | 'error' | 'warn' | 'info';
    }[]
  | string[];

export interface ResponseData<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
}

export type TCrawlResponse = ResponseData<TCrawlResult>;
