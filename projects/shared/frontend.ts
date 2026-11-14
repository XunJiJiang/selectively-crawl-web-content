/// <reference types="vite/client" />

/** Importing this entry registers the shared custom elements for the current page. */
export * from './backend.ts';
export * from './components/index.ts';
export { notify, Notify, SCWCNotify, NotifyController } from './components/notify.ts';
export * from './components/notification.ts';
export * from './components/scroll-container/index.ts';
export { JSONTree } from './components/tree/tree.ts';
export type { TreeBridge } from './components/tree/tree.ts';
export * from './utils/common.ts';
export * from './utils/console.ts';
export { customElement } from './utils/customElement.ts';
export * from './utils/storage.ts';
export * from './utils/refreshRuleParser.ts';
export { default as updateLocalStorage } from './utils/updateLocalStorage.ts';
export * from './store/config.ts';
export * from './request-lifecycle.ts';
export { ManagedResources } from './managed-resources.ts';
export type * from './types/config.d.ts';
export type * from './types/notify.d.ts';
export type * from './types/plugin.d.ts';
