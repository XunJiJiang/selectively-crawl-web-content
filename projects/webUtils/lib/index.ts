import { createWorkbenchSDK } from './workbench.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';
import type { TFetch, TResource, TWebSocket } from './utils/fetch.ts';
let installed: TFetch | undefined;
const resource: TResource = (url) => installed?.resource(url) ?? '';
const websocket: TWebSocket = (url, protocols) => {
  if (!installed) {
    throw new Error('请先 await scwcutils.ready 再创建 WebSocket');
  }
  return installed.websocket(url, protocols);
};
const fetchProxy = Object.assign(
  (async (url: string, options?: RequestInit) => {
    await extended.ready;
    return requireValue(installed)(url, options);
  }) as TFetch,
  { resource, websocket },
);
const base = { fetch: fetchProxy, resource, websocket };
const extended = createWorkbenchSDK((fetch) => {
  installed = fetch;
});
export type TSCWCUtils = typeof base & typeof extended;
const scwcutils: TSCWCUtils = Object.assign(base, extended);
export default scwcutils;
