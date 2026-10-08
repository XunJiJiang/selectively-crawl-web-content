import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import {
  sharedExternalPackages,
  sharedPackageAssets,
} from '../../scripts/shared-package-assets.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

const pluginSource = `
import { axios, z, Database, trash, fileTypeFromBuffer } from 'scwc:deps';
import { RpcPeer, createPluginWorker } from 'scwc:runtime';
import { createRequire } from 'node:module';
import { local } from './local.mjs';
export default async function run() {
  const database = new Database(':memory:');
  const row = database.prepare('SELECT 42 AS value').get();
  database.close();
  await trash([], { glob: false });
  const worker = createPluginWorker(new URL('./worker.mjs', import.meta.url), {
    workerData: { value: 7 }, execArgv: [], env: { ...process.env, NODE_OPTIONS: '' },
  });
  const workerValue = await new Promise((resolve, reject) => {
    worker.once('message', resolve); worker.once('error', reject);
    worker.once('exit', code => { if (code !== 0) reject(new Error('Worker exited: ' + code)); });
  });
  await worker.terminate();
  const require = createRequire(import.meta.url);
  return {
    parsed: z.string().parse('typed'), sqlite: row.value, worker: workerValue,
    axios: typeof axios.create, rpc: typeof RpcPeer, local,
    type: (await fileTypeFromBuffer(Buffer.from('GIF89a'))).ext,
    requireSharesInstance: require('scwc:deps').z === z,
  };
}
`;
const workerSource = `
import { parentPort, workerData } from 'node:worker_threads';
import { z, Database } from 'scwc:deps';
const database = new Database(':memory:');
const row = database.prepare('SELECT ? AS value').get(z.number().parse(workerData.value));
database.close();
parentPort.postMessage(row.value);
`;

describe('shared plugin SDK in external directories', () => {
  it('preserves conflicting transitive versions and omits missing optional packages in extracted assets', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-sdk-packages-'));
    temporary.push(directory);
    const source = path.join(directory, 'source');
    const extracted = path.join(directory, 'extracted');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'package.json'), '{}');
    for (const [name, version] of [
      ['consumer-a', '1'],
      ['consumer-b', '2'],
    ]) {
      const consumer = path.join(source, 'node_modules', name);
      const dependency = path.join(consumer, 'node_modules/shared-version');
      await fs.mkdir(dependency, { recursive: true });
      await fs.writeFile(
        path.join(consumer, 'package.json'),
        JSON.stringify({
          name,
          main: 'index.cjs',
          dependencies: { 'shared-version': '*', 'optional-missing': '*' },
          optionalDependencies: { 'optional-missing': '*' },
        }),
      );
      await fs.writeFile(
        path.join(consumer, 'index.cjs'),
        "module.exports = require('shared-version');",
      );
      await fs.writeFile(
        path.join(dependency, 'package.json'),
        JSON.stringify({
          name: 'shared-version',
          main: 'index.cjs',
          version: `${version}.0.0`,
        }),
      );
      await fs.writeFile(
        path.join(dependency, 'index.cjs'),
        `module.exports = ${JSON.stringify(version)};`,
      );
    }
    const assets = await sharedPackageAssets(source, ['consumer-a', 'consumer-b']);
    expect(Object.keys(assets).some((key) => key.includes('optional-missing'))).toBe(false);
    for (const [key, filename] of Object.entries(assets)) {
      const destination = path.join(extracted, key);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(filename, destination);
    }
    const output = execFileSync(
      process.execPath,
      ['--eval', "console.log(JSON.stringify([require('consumer-a'), require('consumer-b')]));"],
      { cwd: extracted, encoding: 'utf8' },
    );
    expect(JSON.parse(output)).toEqual(['1', '2']);
  });
  it('preserves package namespaces, generic types and invalid-argument checking outside the workspace', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-sdk-types-'));
    temporary.push(directory);
    const filename = path.join(directory, 'plugin.ts');
    await fs.writeFile(
      filename,
      `
import { axios, z, Database } from 'scwc:deps';
import type { AxiosRequestConfig, FileTypeResult } from 'scwc:deps';
import { RpcPeer, createPluginWorker } from 'scwc:runtime';
const schema = z.object({ count: z.number() });
const parsed: z.infer<typeof schema> = { count: 1 };
// @ts-expect-error: the original Zod type namespace must reject a string count.
const invalid: z.infer<typeof schema> = { count: 'invalid' };
const config: AxiosRequestConfig = { timeout: 1000 };
// @ts-expect-error: Axios config must retain its numeric timeout type.
const invalidConfig: AxiosRequestConfig = { timeout: 'invalid' };
const database: Database.Database = new Database(':memory:');
const statement: Database.Statement<[], { value: number }> = database.prepare('SELECT 1 AS value');
const peer: RpcPeer = new RpcPeer((message, callback) => callback(null));
const response: Promise<number> = peer.call<number>('sum', {}, 1000);
const file: FileTypeResult = { ext: 'gif', mime: 'image/gif' };
void axios.get<{ count: number }>('/example', config);
void createPluginWorker(new URL('file:///worker.mjs'), { workerData: parsed });
`,
    );
    const config = path.join(directory, 'tsconfig.json');
    await fs.writeFile(
      config,
      JSON.stringify({
        compilerOptions: {
          target: 'ESNext',
          lib: ['ESNext', 'DOM'],
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          types: ['node'],
          typeRoots: [path.join(root, 'node_modules/@types')],
        },
        files: [
          filename,
          fileURLToPath(new URL('./modules.d.ts', import.meta.url)),
          path.join(root, 'projects/server/plugins/plugin-env.d.ts'),
        ],
      }),
    );
    const compiler = path.join(
      root,
      'node_modules/.bin',
      process.platform === 'win32' ? 'tsc.exe' : 'tsc',
    );
    expect(
      execFileSync(compiler, ['-p', config, '--pretty', 'false'], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30_000,
      }),
    ).toBe('');
  }, 30_000);
  it.each(['source', 'bundle'] as const)(
    'loads typed packages, CommonJS imports and Workers in %s mode without plugin node_modules',
    async (mode) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-sdk-'));
      temporary.push(directory);
      const pluginDirectory = path.join(directory, 'external plugin');
      await fs.mkdir(pluginDirectory);
      await fs.writeFile(path.join(pluginDirectory, 'plugin.mjs'), pluginSource);
      await fs.writeFile(path.join(pluginDirectory, 'worker.mjs'), workerSource);
      await fs.writeFile(path.join(pluginDirectory, 'local.mjs'), 'export const local = true;');
      let command: string[];
      if (mode === 'source') {
        command = [
          '--input-type=module',
          '--eval',
          'const { registerPluginSdk } = await import(process.argv[1]); registerPluginSdk(); registerPluginSdk(); const plugin = await import(process.argv[2]); console.log(JSON.stringify(await plugin.default()));',
          new URL('./register.ts', import.meta.url).href,
          pathToFileURL(path.join(pluginDirectory, 'plugin.mjs')).href,
        ];
      } else {
        const runtime = path.join(directory, 'runtime');
        await fs.mkdir(runtime);
        for (const [key, filename] of Object.entries(await sharedPackageAssets(root))) {
          const destination = path.join(runtime, key);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.copyFile(filename, destination);
          if (process.platform !== 'win32') {
            await fs.chmod(destination, (await fs.stat(filename)).mode & 0o777);
          }
        }
        const options = {
          bundle: true,
          platform: 'node' as const,
          target: 'node24',
          format: 'cjs' as const,
          minify: true,
          keepNames: true,
          treeShaking: true,
          external: sharedExternalPackages,
          define: { 'import.meta.url': JSON.stringify('file:///scwc/bundle.cjs') },
        };
        await build({
          ...options,
          entryPoints: [fileURLToPath(new URL('./worker-bootstrap.ts', import.meta.url))],
          outfile: path.join(runtime, 'plugin-worker.cjs'),
        });
        await build({
          ...options,
          stdin: {
            contents:
              "import { registerPluginSdk } from './projects/server/plugin/sdk/register.ts'; registerPluginSdk(); import(process.argv[2]).then(async plugin => console.log(JSON.stringify(await plugin.default()))).catch(error => { console.error(error); process.exitCode = 1; });",
            resolveDir: root,
          },
          outfile: path.join(runtime, 'runner.cjs'),
        });
        command = [
          path.join(runtime, 'runner.cjs'),
          pathToFileURL(path.join(pluginDirectory, 'plugin.mjs')).href,
        ];
      }
      const output = execFileSync(process.execPath, command, {
        cwd: pluginDirectory,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          SCWC_RUNTIME_ROOT: mode === 'bundle' ? path.join(directory, 'runtime') : undefined,
        },
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(JSON.parse(output)).toEqual({
        parsed: 'typed',
        sqlite: 42,
        worker: 7,
        axios: 'function',
        rpc: 'function',
        local: true,
        type: 'gif',
        requireSharesInstance: true,
      });
      expect(
        await fs.stat(path.join(pluginDirectory, 'node_modules')).catch(() => undefined),
      ).toBeUndefined();
    },
    30_000,
  );
});
