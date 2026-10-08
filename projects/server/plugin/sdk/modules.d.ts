declare module 'scwc:deps' {
  export { default as axios, AxiosError, AxiosHeaders } from 'axios';
  export type * from 'axios';
  export { default as chalk } from 'chalk';
  export { z } from 'zod';
  export { default as Database } from 'better-sqlite3';
  export { default as trash } from 'trash';
  export * as fileType from 'file-type';
  export { fileTypeFromFile, fileTypeFromBuffer, fileTypeFromStream } from 'file-type';
  export type { FileTypeResult } from 'file-type';
}

declare module 'scwc:runtime' {
  export const RpcPeer: typeof import('./runtime.ts').RpcPeer;
  export type RpcPeer = InstanceType<typeof RpcPeer>;
  export const PluginProcessError: typeof import('./runtime.ts').PluginProcessError;
  export type PluginProcessError = InstanceType<typeof PluginProcessError>;
  export const createPluginWorker: typeof import('./runtime.ts').createPluginWorker;
  export type PluginWorkerOptions = import('./runtime.ts').PluginWorkerOptions;
  export type PluginRequest = import('../../types/plugin-process.d.ts').PluginRequest;
}
