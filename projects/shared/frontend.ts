/// <reference types="vite/client" />

/** Importing this entry registers the shared custom elements for the current page. */
export * from './backend.ts';
export * from './components/index.ts';
export { notify } from './components/notify.ts';
export * from './components/scroll-container/index.ts';
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
