import type { ResponseData } from '../../../shared/types/api.d.ts';

export type TCrawlResult =
  | {
      pluginInfo: {
        name: string;
      };
      info: string;
      type: 'success' | 'error' | 'warn' | 'info';
    }[]
  | string[];

export type TCrawlResponse = ResponseData<TCrawlResult>;
