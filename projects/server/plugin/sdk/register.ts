import { registerHooks } from 'node:module';
import * as dependencies from './dependencies.ts';
import * as runtime from './runtime.ts';

const registryKey = Symbol.for('scwc.plugin.sdk.v1');
let registered = false;

/** Install in each host/Worker before dynamically importing external plugins. */
export function registerPluginSdk(): void {
  if (registered) {
    return;
  }
  const modules: Record<string, Readonly<Record<string, unknown>>> = {
    'scwc:deps': Object.freeze({ ...dependencies }),
    'scwc:runtime': Object.freeze({ ...runtime }),
  };
  Object.defineProperty(globalThis, registryKey, { value: Object.freeze(modules) });
  const sources = new Map(
    Object.entries(modules).map(([name, exports]) => [
      name,
      `const exports = globalThis[Symbol.for('scwc.plugin.sdk.v1')][${JSON.stringify(name)}];\n` +
        Object.keys(exports)
          .map((key) => `export const ${key} = exports[${JSON.stringify(key)}];`)
          .join('\n'),
    ]),
  );
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (sources.has(specifier)) {
        return { url: specifier, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const source = sources.get(url);
      if (source !== undefined) {
        return { format: 'module', source, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
  registered = true;
}
