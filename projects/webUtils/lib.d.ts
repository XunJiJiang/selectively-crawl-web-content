type TSCWCUtils = import('./lib/index.ts').TSCWCUtils;

declare global {
  interface Window {
    scwcutils: TSCWCUtils;
  }
}
