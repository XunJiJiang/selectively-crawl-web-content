import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginCatalog } from './catalog.ts';
import { plugins, currentPluginDirectory, pluginLifecycleEvents } from '../plugin/load.ts';

vi.mock('../plugin/load.ts', async () => ({
  plugins: [], inactivePlugins: [], currentPluginDirectory: vi.fn(),
  pluginLifecycleEvents: new (await import('node:events')).EventEmitter(),
}));

const temporaryDirectory = path.resolve('node_modules/.tmp');
let root: string;
beforeEach(async () => {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  root = await fs.mkdtemp(path.join(temporaryDirectory, 'catalog-title-'));
  vi.mocked(currentPluginDirectory).mockResolvedValue(root);
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'folder/index.ts'), 'export default {};');
});
afterEach(async () => {
  plugins.length = 0;
  pluginLifecycleEvents.removeAllListeners('change');
  const relative = path.relative(temporaryDirectory, root);
  if (!relative.startsWith('catalog-title-') || relative.includes(path.sep)) {
    throw new Error('unexpected test directory');
  }
  await fs.rm(root, { recursive: true, force: true });
});

it.each([
  { packageTitle: '包标题', exportedName: '导出名称', packageName: '包名', expected: '包标题', source: 'package-ui' },
  { packageTitle: undefined, exportedName: '导出名称', packageName: '包名', expected: '导出名称', source: 'exported-name' },
  { packageTitle: undefined, exportedName: undefined, packageName: '包名', expected: '包名', source: 'package-name' },
  { packageTitle: undefined, exportedName: undefined, packageName: undefined, expected: 'folder', source: 'directory' },
  { packageTitle: '  ', exportedName: '  导出名称  ', packageName: '包名', expected: '导出名称', source: 'exported-name' },
])('resolves the plugin title as $source without using exported title', async ({ packageTitle, exportedName, packageName, expected, source }) => {
  await fs.writeFile(path.join(root, 'folder/package.json'), JSON.stringify({
    main: 'index.ts', name: packageName, scwc: { ui: { title: packageTitle } },
  }));
  plugins.push({ pluginId: 'folder', handler: { name: exportedName, title: '旧导出标题' } } as (typeof plugins)[number]);
  const items = await new PluginCatalog().list();
  expect(items[0]).toMatchObject({ title: expected, presentation: { titleSource: source } });
});
