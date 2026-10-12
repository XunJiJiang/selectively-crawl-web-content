import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseEnv } from 'dotenv';
import { BUILD_ROOT } from './build-runtime.ts';
import {
  archiveRelease,
  copyReleaseFiles,
  parseReleaseArgs,
  releaseName,
} from './release-package.ts';
import { extractRelease } from './release-test-utils.ts';

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-release-test-'));
  temporary.push(root);
  await fs.mkdir(path.join(root, 'docs'));
  await fs.copyFile(
    path.join(BUILD_ROOT, 'docs/core.env.example'),
    path.join(root, 'docs/core.env.example'),
  );
  await fs.writeFile(path.join(root, 'LICENSE'), 'license');
  for (const [folder, examples] of [
    ['projects/server/plugins', ['template', 'test']],
    ['projects/terminal/plugins', ['template']],
  ] as const) {
    await fs.mkdir(path.join(root, folder), { recursive: true });
    await fs.writeFile(path.join(root, folder, 'plugin-env.d.ts'), folder);
    for (const name of ['enabled', 'disabled', 'implicit', ...examples]) {
      const plugin = path.join(root, folder, name);
      await fs.mkdir(path.join(plugin, 'data'), { recursive: true });
      await fs.mkdir(path.join(plugin, '.aoci'));
      await fs.mkdir(path.join(plugin, 'node_modules/private-dependency'), { recursive: true });
      await fs.mkdir(path.join(plugin, 'node_modules/dev-only'), { recursive: true });
      await fs.writeFile(
        path.join(plugin, 'package.json'),
        JSON.stringify({
          name,
          main: 'index.ts',
          ...(name === 'implicit' ? {} : { enabled: name === 'enabled' }),
          dependencies: { 'private-dependency': '1.0.0' },
          devDependencies: { 'dev-only': '1.0.0' },
        }),
      );
      await fs.writeFile(path.join(plugin, 'index.ts'), 'export default {};');
      await fs.writeFile(path.join(plugin, '.env'), 'secret');
      await fs.writeFile(path.join(plugin, 'data/state.json'), 'user data');
      await fs.writeFile(path.join(plugin, '.aoci/ledger'), 'ledger');
      await fs.writeFile(
        path.join(plugin, 'node_modules/private-dependency/package.json'),
        JSON.stringify({ name: 'private-dependency', main: 'index.cjs' }),
      );
      await fs.writeFile(
        path.join(plugin, 'node_modules/private-dependency/index.cjs'),
        'module.exports = 42;',
      );
      await fs.writeFile(path.join(plugin, 'node_modules/dev-only/package.json'), '{}');
    }
  }
  return root;
}

describe('release ZIP contract', () => {
  it('defaults to the current system without plugins and validates every option', () => {
    expect(parseReleaseArgs([])).toEqual({
      platform: process.platform,
      arch: process.arch,
      terminalPlugins: false,
      corePlugins: 'none',
    });
    expect(
      parseReleaseArgs(['--terminal-plugins', 'true', '--core-plugins=enabled']),
    ).toMatchObject({ terminalPlugins: true, corePlugins: 'enabled' });
    for (const args of [
      ['--terminal-plugins=yes'],
      ['--core-plugins=active'],
      ['--core-plugins'],
      ['--platform', '--arch=x64'],
      ['--arch=x64=extra'],
    ]) {
      expect(() => parseReleaseArgs(args)).toThrow();
    }
    expect(
      releaseName('external-node', {
        platform: 'linux',
        arch: 'arm64',
        libc: 'musl',
        version: '25',
        napi: '10',
        release: 'node',
        alternativeRuntime: false,
      }),
    ).toBe('scwc-external-node-linux-arm64-musl');
    expect(releaseName('bundled-node')).toContain('scwc-bundled-node-');
  });
  it.each(['none', 'all', 'enabled'] as const)(
    'ships selected plugins and both declarations with core mode %s',
    async (corePlugins) => {
      const root = await fixture();
      const output = path.join(root, 'output');
      await fs.mkdir(output);
      await copyReleaseFiles(
        output,
        { ...parseReleaseArgs([]), terminalPlugins: true, corePlugins },
        root,
      );
      expect(await fs.readdir(path.join(output, 'plugins'))).toEqual(
        corePlugins === 'none'
          ? ['plugin-env.d.ts']
          : corePlugins === 'all'
            ? ['disabled', 'enabled', 'implicit', 'plugin-env.d.ts']
            : ['enabled', 'implicit', 'plugin-env.d.ts'],
      );
      expect(await fs.readdir(path.join(output, 'terminal/plugins'))).toEqual([
        'disabled',
        'enabled',
        'implicit',
        'plugin-env.d.ts',
      ]);
      for (const prefix of ['plugins', 'terminal/plugins']) {
        expect(existsSync(path.join(output, prefix, 'plugin-env.d.ts'))).toBe(true);
        if (prefix === 'plugins' && corePlugins === 'none') {
          continue;
        }
        const plugin = path.join(output, prefix, 'enabled');
        expect(existsSync(path.join(plugin, 'node_modules/private-dependency/index.cjs'))).toBe(
          true,
        );
        for (const item of ['.env', 'data', '.aoci', 'node_modules/dev-only']) {
          expect(existsSync(path.join(plugin, item))).toBe(false);
        }
      }
      const env = await fs.readFile(path.join(output, '.env'), 'utf8');
      expect(env).toBe(await fs.readFile(path.join(root, 'docs/core.env.example'), 'utf8'));
      expect(parseEnv(env)).toMatchObject({
        PORT: '3200',
        REDIS_KEY_PREFIX: 'cache-redis',
        TOKEN: '',
        REDIS_PASSWORD: '',
        SCWC_NODE_PATH: '',
        SCWC_TERMINAL_PERSIST: 'true',
      });
      expect(env).toContain('#');
      expect(existsSync(path.join(output, '.env.example'))).toBe(false);
    },
  );
  it('keeps both declarations when neither plugin group is shipped, and ZIP round-trips executable modes and dotfiles', async () => {
    const root = await fixture();
    const source = path.join(root, 'source');
    await fs.mkdir(source);
    await copyReleaseFiles(source, parseReleaseArgs([]), root);
    expect(await fs.readdir(path.join(source, 'terminal/plugins'))).toEqual(['plugin-env.d.ts']);
    await fs.writeFile(path.join(source, 'start.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const archive = path.join(root, 'dist/core/release.zip');
    await archiveRelease(source, archive);
    const extracted = path.join(root, 'extracted');
    await extractRelease(archive, extracted);
    expect(await fs.readFile(path.join(extracted, '.env'), 'utf8')).toContain('TOKEN=');
    expect(existsSync(path.join(extracted, 'plugins/plugin-env.d.ts'))).toBe(true);
    expect(existsSync(path.join(extracted, 'terminal/plugins/plugin-env.d.ts'))).toBe(true);
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(extracted, 'start.sh'))).mode & 0o777).toBe(0o755);
    }
    expect(await fs.readdir(path.dirname(archive))).toEqual(['release.zip']);
    const previous = await fs.readFile(archive);
    await fs.symlink(path.join(source, 'start.sh'), path.join(source, 'invalid-link'));
    await expect(archiveRelease(source, archive)).rejects.toThrow('归档不接受链接');
    expect(await fs.readFile(archive)).toEqual(previous);
    expect(await fs.readdir(path.dirname(archive))).toEqual(['release.zip']);
  });
});
