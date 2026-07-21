import type { ResponseData } from '../../../shared/types/api.d.ts';

export type TPluginPagesResult = {
  dir: string;
  pluginId: string;
}[];

export type TPluginPagesResponse = ResponseData<TPluginPagesResult>;
