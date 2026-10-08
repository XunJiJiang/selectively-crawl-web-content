import { vitePluginPackageName } from '../../../vite-plugin/dependencies.js';

// Compatibility entry for core callers; the public Vite package owns the browser list.
export { packageName, sharedBrowserPackages } from '../../../vite-plugin/dependencies.js';
export const sharedBuildPackages = [
  'vite',
  'vite-plugin-monkey',
  'esbuild',
  vitePluginPackageName,
] as const;
