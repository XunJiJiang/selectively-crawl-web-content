import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { syncVersions } from './sync-versions.ts';

const temporaryDirectory = fileURLToPath(new URL('../../node_modules/.tmp/', import.meta.url));

async function fixture(t: TestContext) {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  const root = await fs.mkdtemp(path.join(temporaryDirectory, 'sync-versions-'));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(temporaryDirectory));
    await fs.rm(root, { recursive: true, force: true });
  });
  async function write(relative: string, content: string) {
    const filename = path.join(root, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, content);
    return filename;
  }
  await write('package.json', JSON.stringify({ version: '9.2.1' }));
  await fs.mkdir(path.join(root, 'projects'));
  return { root, write };
}

test('syncs workspaces and the three built-in plugins, preserving business plugins and dependencies', async (t) => {
  const { root, write } = await fixture(t);
  const included = [
    'projects/browser-extension/package.json',
    'projects/shared/package.json',
    'projects/vite-plugin/package.json',
    'projects/server/plugins/template/package.json',
    'projects/terminal/plugins/template/package.json',
    'projects/terminal/plugins/scwc/package.json',
  ];
  for (const relative of included) {
    await write(relative, JSON.stringify({ name: relative, scripts: { build: 'vite build' } }));
  }
  const excluded = [
    'projects/server/plugins/business/package.json',
    'projects/terminal/plugins/business/package.json',
    'projects/web/node_modules/dependency/package.json',
    'projects/web/dist/package.json',
    'projects/web/.cache/package.json',
    'projects/server/plugins/template/node_modules/dependency/package.json',
  ];
  // Invalid JSON also proves that excluded directories are never read.
  for (const relative of excluded) {
    await write(relative, 'independent package');
  }
  const updated = await syncVersions(root);
  assert.deepEqual(updated.sort(), included.map((relative) => path.normalize(relative)).sort());
  for (const relative of included) {
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')), {
      name: relative,
      scripts: { build: 'vite build' },
      version: '9.2.1',
    });
  }
  for (const relative of excluded) {
    assert.equal(await fs.readFile(path.join(root, relative), 'utf8'), 'independent package');
  }
});

test('does not rewrite synchronized manifests or follow directory links', async (t) => {
  const { root, write } = await fixture(t);
  const filename = await write('projects/web/package.json', '{"version":"9.2.1"}\n');
  const linked = await write('outside/package.json', '{"version":"1.0.0"}');
  await fs.symlink(path.dirname(linked), path.join(root, 'projects/linked'), 'junction');
  await fs.utimes(filename, new Date(0), new Date(0));
  const before = await fs.stat(filename);
  assert.deepEqual(await syncVersions(root), []);
  assert.equal((await fs.stat(filename)).mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"9.2.1"}\n');
  assert.equal(await fs.readFile(linked, 'utf8'), '{"version":"1.0.0"}');
});

test('rejects malformed source metadata before changing any package', async (t) => {
  const { root, write } = await fixture(t);
  const filename = await write('projects/a/package.json', '{"version":"1.0.0"}');
  await write('projects/z/package.json', '{invalid');
  await assert.rejects(syncVersions(root), SyntaxError);
  assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
});

test('rejects a missing root version before writing', async (t) => {
  const { root, write } = await fixture(t);
  await write('package.json', '{}');
  const filename = await write('projects/web/package.json', '{"version":"1.0.0"}');
  await assert.rejects(syncVersions(root), /根 package.json/);
  assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
});
