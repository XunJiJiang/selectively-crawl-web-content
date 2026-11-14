import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { syncVersions } from './sync-versions.ts';

const temporaryDirectory = fileURLToPath(new URL('../../node_modules/.tmp/', import.meta.url));
const script = new URL('./sync-versions.ts', import.meta.url);

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
  const rootFilename = path.join(root, 'package.json');
  const rootContent = await fs.readFile(rootFilename, 'utf8');
  const filename = await write('projects/web/package.json', '{"version":"9.2.1"}\n');
  const linked = await write('outside/package.json', '{"version":"1.0.0"}');
  await fs.symlink(path.dirname(linked), path.join(root, 'projects/linked'), 'junction');
  await fs.utimes(filename, new Date(0), new Date(0));
  const before = await fs.stat(filename);
  assert.deepEqual(await syncVersions(root), []);
  assert.equal((await fs.stat(filename)).mtimeMs, before.mtimeMs);
  assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"9.2.1"}\n');
  assert.equal(await fs.readFile(linked, 'utf8'), '{"version":"1.0.0"}');
  assert.equal(await fs.readFile(rootFilename, 'utf8'), rootContent);
});

test('rejects malformed source metadata before changing any package', async (t) => {
  const { root, write } = await fixture(t);
  const filename = await write('projects/a/package.json', '{"version":"1.0.0"}');
  await write('projects/z/package.json', '{invalid');
  for (const bump of [undefined, '1']) {
    await assert.rejects(syncVersions(root, bump), SyntaxError);
    assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
    assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"version":"9.2.1"}');
  }
});

test('rejects a missing root version before writing', async (t) => {
  const { root, write } = await fixture(t);
  await write('package.json', '{}');
  const filename = await write('projects/web/package.json', '{"version":"1.0.0"}');
  await assert.rejects(syncVersions(root), /根 package.json/);
  assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
});

for (const [bump, version] of [
  ['1', '4.0.0'],
  ['2', '3.14.0'],
  ['3', '3.13.5'],
]) {
  test(`bumps version part ${bump} and synchronizes included packages to ${version}`, async (t) => {
    const { root, write } = await fixture(t);
    const metadata = { name: 'root', version: '3.13.4', scripts: { build: 'vite build' } };
    await write('package.json', JSON.stringify(metadata));
    const included = [
      'projects/web/package.json',
      'projects/server/plugins/template/package.json',
      'projects/terminal/plugins/template/package.json',
      'projects/terminal/plugins/scwc/package.json',
    ];
    for (const relative of included) {
      await write(relative, '{"version":"3.13.4"}');
    }
    const excluded = 'projects/server/plugins/business/package.json';
    await write(excluded, '{"version":"1.0.0"}');

    const updated = await syncVersions(root, bump);
    assert.deepEqual(
      updated.sort(),
      ['package.json', ...included].map((relative) => path.normalize(relative)).sort(),
    );
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')), {
      ...metadata,
      version,
    });
    for (const relative of included) {
      assert.equal(
        JSON.parse(await fs.readFile(path.join(root, relative), 'utf8')).version,
        version,
      );
    }
    assert.equal(await fs.readFile(path.join(root, excluded), 'utf8'), '{"version":"1.0.0"}');
    assert.deepEqual(await syncVersions(root), []);
  });
}

test('rejects invalid bump arguments without changing any package', async (t) => {
  const { root, write } = await fixture(t);
  const filename = await write('projects/web/package.json', '{"version":"1.0.0"}');
  for (const bump of ['', '0', '4', 'major', '01', '1.0']) {
    await assert.rejects(syncVersions(root, bump), /参数必须是 1、2 或 3/);
    assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), '{"version":"9.2.1"}');
    assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
  }
});

test('rejects invalid versions and integer overflow before writing a bumped version', async (t) => {
  const { root, write } = await fixture(t);
  const filename = await write('projects/web/package.json', '{"version":"1.0.0"}');
  for (const version of ['3.13', '3.13.04', '3.13.4-beta', '3.13.9007199254740991']) {
    const content = JSON.stringify({ version });
    await write('package.json', content);
    await assert.rejects(syncVersions(root, '3'), /x\.y\.z/);
    assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), content);
    assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
  }
});

test('CLI forwards the optional bump argument and rejects invalid or extra arguments', async (t) => {
  const { root, write } = await fixture(t);
  const scriptFilename = await write(
    'projects/scripts/sync-versions.mjs',
    stripTypeScriptTypes(await fs.readFile(script, 'utf8')),
  );
  for (const [args, expected] of [
    [[], '3.13.4'],
    [['1'], '4.0.0'],
    [['2'], '3.14.0'],
    [['3'], '3.13.5'],
    [['4'], undefined],
    [['1', '2'], undefined],
  ] as const) {
    const rootContent = '{"type":"module","version":"3.13.4"}';
    await write('package.json', rootContent);
    const filename = await write('projects/web/package.json', '{"version":"1.0.0"}');
    const result = spawnSync(process.execPath, [scriptFilename, ...args], {
      cwd: temporaryDirectory,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, expected === undefined ? 1 : 0, result.stderr);
    if (expected === undefined) {
      assert.match(result.stderr, /用法：bun run sync:versions/);
      assert.equal(await fs.readFile(path.join(root, 'package.json'), 'utf8'), rootContent);
      assert.equal(await fs.readFile(filename, 'utf8'), '{"version":"1.0.0"}');
    } else {
      assert.equal(
        JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version,
        expected,
      );
      assert.equal(JSON.parse(await fs.readFile(filename, 'utf8')).version, expected);
      assert.match(result.stdout, /版本同步完成/);
    }
  }
});
