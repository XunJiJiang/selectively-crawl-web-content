import type { Plugin } from 'vite';

export interface ScwcViteOptions {
  /** Optional core workspace/runtime directory used for missing browser packages. */
  dependencyRoot?: string;
}

export { sharedBrowserPackages } from './dependencies.js';
export function scwcVite(options?: ScwcViteOptions): Plugin;
export default scwcVite;
