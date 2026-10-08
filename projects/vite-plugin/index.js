import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageName, sharedBrowserPackages } from './dependencies.js';

export { sharedBrowserPackages } from './dependencies.js';
const pluginName = 'vite-plugin-scwc';
const shared = new Set(sharedBrowserPackages);

/**
 * @param {import('./index.d.ts').ScwcViteOptions} [options]
 * @returns {import('vite').Plugin}
 */
export function scwcVite(options = {}) {
  const anchor = options.dependencyRoot
    ? path.join(path.resolve(options.dependencyRoot), 'scwc-browser-entry.js')
    : fileURLToPath(import.meta.url);
  const browser = fileURLToPath(new URL('./browser.js', import.meta.url));
  let active = true;
  /** @type {import('vite').Plugin} */
  const plugin = {
    name: pluginName,
    enforce: 'pre',
    configResolved(config) {
      // The core also injects this plugin. Only the first instance handles imports.
      active = config.plugins.find((candidate) => candidate.name === pluginName) === plugin;
    },
    async resolveId(source, importer, resolveOptions) {
      if (!active) {
        return null;
      }
      if (source === 'scwc:deps') {
        return this.resolve(browser, importer, { ...resolveOptions, skipSelf: true });
      }
      const name = packageName(source);
      if (!name || !shared.has(name)) {
        return null;
      }
      const local = await this.resolve(source, importer, { ...resolveOptions, skipSelf: true });
      return local ?? this.resolve(source, anchor, { ...resolveOptions, skipSelf: true });
    },
    async transform(code, id) {
      const [filename = '', query = ''] = id.split('?');
      if (
        !active ||
        id.startsWith('\0') ||
        !/\.[cm]?[jt]sx?$/.test(filename) ||
        /(?:^|&)(?:raw|url)(?:[=&]|$)/.test(query) ||
        !code.includes('@')
      ) {
        return null;
      }
      // Vite 8's Oxc preserves standard decorators. Respect the nearest tsconfig
      // while lowering both decorator modes with the existing esbuild toolchain.
      const { transformWithEsbuild } = await import('vite');
      return transformWithEsbuild(code, filename, {
        target: 'es2022',
        jsx: 'preserve',
        sourcemap: true,
      });
    },
  };
  return plugin;
}

export default scwcVite;
