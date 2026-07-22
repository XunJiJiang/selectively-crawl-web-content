type TWebUtils = import('./lib/index.ts').TWebUtils;

declare global {
  interface Window {
    webutils: TWebUtils;
  }
}
