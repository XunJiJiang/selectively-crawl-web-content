import type { TWebUtils } from './lib/index.ts';

declare global {
  interface Window {
    webUtils: TWebUtils;
  }
}
