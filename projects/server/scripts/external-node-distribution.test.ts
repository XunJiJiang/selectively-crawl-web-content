import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type AddressInfo } from 'node:net';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { releaseArchive } from './release-package.ts';
import { extractRelease } from './release-test-utils.ts';

const release = releaseArchive('external-node');
const available = existsSync(release);
let temporary: string;
let app: string;
let unrelated: string;
let port: number;
const children = new Set<ChildProcess>();
beforeAll(async () => {
  if (!available) {
    return;
  }
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-external-node-release-'));
  app = path.join(await fs.realpath(temporary), 'relocated app');
  unrelated = path.join(temporary, 'unrelated cwd');
  await extractRelease(release, app);
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, '.env'), 'PORT=invalid\nREDIS_ENABLED=invalid\n');
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await fs.writeFile(
    path.join(app, '.env'),
    `PORT=${port}\nPORT_SEARCH_RANGE=0\nTOKEN=null\nREDIS_ENABLED=false\nSCWC_TERMINAL_STATE_FILE=./state.json\nSCWC_APP_DIR=wrong\nSCWC_RUNTIME_ROOT=wrong\nSCWC_DISTRIBUTION_MODE=wrong\n`,
  );
}, 40_000);
afterAll(async () => {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
  if (temporary) {
    if (path.dirname(temporary) !== path.resolve(os.tmpdir())) {
      throw new Error('测试清理目录超出边界');
    }
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3 });
  }
});

function start(args: string[]) {
  const child = spawn(process.execPath, [path.join(app, 'start.cjs'), ...args], {
    cwd: unrelated,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      SCWC_NODE_PATH: '',
      SCWC_PLUGIN_DIR: '',
      FORCE_COLOR: '0',
      TERM: 'dumb',
    },
  });
  children.add(child);
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      children.delete(child);
      resolve(code);
    });
  });
  return { child, done, output: () => output };
}

describe.skipIf(!available)('relocated external Node distribution', () => {
  it('runs default terminal and direct core without reading the unrelated cwd environment', async () => {
    for (const mode of [
      { args: [], input: ':a\n:new\n:q\n', terminal: true },
      { args: ['--no-terminal'], input: 'exit\n', terminal: false },
    ]) {
      await fs.rm(path.join(app, 'state.json'), { force: true });
      const running = start(mode.args);
      const timeout = setTimeout(() => running.child.kill('SIGKILL'), 25_000);
      try {
        running.child.stdin?.end(mode.input);
        expect(await running.done, running.output()).toBe(0);
        if (mode.terminal) {
          const state = JSON.parse(await fs.readFile(path.join(app, 'state.json'), 'utf8')) as {
            windows: unknown[];
          };
          expect(state.windows).toHaveLength(3);
        } else {
          expect(running.output()).toContain('服务启动');
          expect(existsSync(path.join(app, 'state.json'))).toBe(false);
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  }, 60_000);

  it('provides SDK, SQLite, custom-env Workers and automatic Vite pages without plugin dependencies', async () => {
    const pluginRoot = path.join(temporary, 'external plugins');
    const plugin = path.join(pluginRoot, 'node-release-check');
    await fs.mkdir(path.join(plugin, 'web'), { recursive: true });
    await fs.writeFile(
      path.join(plugin, 'package.json'),
      JSON.stringify({
        type: 'module',
        main: 'index.ts',
        scripts: { 'build:web': 'vite build --config vite.config.ts' },
      }),
    );
    await fs.writeFile(
      path.join(plugin, 'vite.config.ts'),
      `import scwcVite from '@scwc/vite-plugin'; import path from 'node:path'; export default { root:path.join(import.meta.dirname,'web'),plugins:[scwcVite()],worker:{plugins:()=>[scwcVite()]},build:{outDir:'dist'} };`,
    );
    await fs.writeFile(
      path.join(plugin, 'web/index.html'),
      '<html><body><script type="module" src="./main.ts"></script></body></html>',
    );
    await fs.writeFile(
      path.join(plugin, 'web/main.ts'),
      `import {LitElement,html} from 'lit'; import {customElement,property} from 'lit/decorators.js'; import {z} from 'scwc:deps'; import '@vscode/codicons/dist/codicon.css';
@customElement('node-release-check') class Component extends LitElement { @property({type:String}) accessor label=z.string().parse('ready'); render(){return html\`<p>\${this.label}</p>\`;} }
document.body.append(document.createElement('node-release-check')); new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});`,
    );
    await fs.writeFile(
      path.join(plugin, 'web/worker.ts'),
      "import {z} from 'scwc:deps'; function identity(value){return value;} @identity class Message {value='worker';} postMessage(z.string().parse(new Message().value));",
    );
    await fs.writeFile(
      path.join(plugin, 'worker.ts'),
      `import {parentPort} from 'node:worker_threads'; import {z,Database} from 'scwc:deps'; const db=new Database(':memory:');const value=db.prepare('select 42 as value').get().value;db.close();parentPort.postMessage({value,label:z.string().parse('worker'),custom:process.env.CUSTOM_VALUE,app:process.env.SCWC_APP_DIR});`,
    );
    await fs.writeFile(
      path.join(plugin, 'index.ts'),
      `import {once} from 'node:events'; import {Database} from 'scwc:deps'; import {createPluginWorker} from 'scwc:runtime'; let result;
export default {async onRequest(){},async onLoad(){const db=new Database(':memory:');const value=db.prepare('select 42 as value').get().value;db.close();const worker=createPluginWorker(new URL('./worker.ts',import.meta.url),{env:{CUSTOM_VALUE:'retained'}});const [workerValue]=await once(worker,'message');await worker.terminate();result={value,workerValue,app:process.env.SCWC_APP_DIR,execPath:process.execPath};},ui:{entry:'./web/dist/index.html',api:[{method:'get',path:'/check',handler:()=>result}]}};`,
    );
    const running = start(['--no-terminal', '--plugin-dir', pluginRoot]);
    const timeout = setTimeout(() => running.child.kill('SIGKILL'), 30_000);
    const url = `http://127.0.0.1:${port}`;
    const headers = { Origin: 'http://localhost' };
    try {
      await expect
        .poll(
          async () => {
            try {
              const response = await fetch(`${url}/web/api/pages?site=http://localhost`, {
                headers,
                signal: AbortSignal.timeout(1000),
              });
              const body = (await response.json()) as { data?: { dir: string }[] };
              return body.data?.some((page) => page.dir === 'node-release-check');
            } catch {
              return false;
            }
          },
          { timeout: 20_000 },
        )
        .toBe(true)
        .catch((error) => {
          throw new Error(`发行核心输出：\n${running.output()}`, { cause: error });
        });
      const identity = (await (
        await fetch(`${url}/web/api/safeId/node-release-check?site=http://localhost`, { headers })
      ).json()) as { data: { safeId: string } };
      const result = await (
        await fetch(`${url}/web/api/plugin/${identity.data.safeId}/check?site=http://localhost`, {
          headers,
        })
      ).json();
      expect(result).toMatchObject({
        success: true,
        data: {
          value: 42,
          app,
          execPath: process.execPath,
          workerValue: { value: 42, label: 'worker', custom: 'retained', app },
        },
      });
      expect(existsSync(path.join(plugin, 'node_modules'))).toBe(false);
      const assets = await fs.readdir(path.join(plugin, 'web/dist/assets'));
      expect(assets.some((file) => file.startsWith('worker-'))).toBe(true);
      for (const file of assets.filter((file) => file.endsWith('.js'))) {
        execFileSync(process.execPath, ['--check', path.join(plugin, 'web/dist/assets', file)]);
      }
      expect(
        await (
          await fetch(`${url}/web/page/plugin/node-release-check/?site=http://localhost`, {
            headers,
          })
        ).text(),
      ).toContain('scwcutils');
      expect((await fetch(`${url}/web/`)).status).toBe(200);
      running.child.stdin?.end('exit\n');
      expect(await running.done, running.output()).toBe(0);
    } finally {
      clearTimeout(timeout);
      if (running.child.exitCode === null) {
        running.child.kill('SIGKILL');
        await running.done;
      }
    }
  }, 45_000);

  it('uses the platform launcher with a quoted relative Node path and preserves spaces in arguments', async () => {
    const nodeLink = path.join(app, 'chosen node');
    await fs.mkdir(nodeLink);
    await fs.symlink(
      path.dirname(process.execPath),
      path.join(nodeLink, 'bin'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const filename = path.basename(process.execPath);
    await fs.appendFile(
      path.join(app, '.env'),
      `\nexport SCWC_NODE_PATH="./chosen node/bin/${filename}" # configured Node\n`,
    );
    const launcher =
      process.platform === 'win32'
        ? ([
            'powershell.exe',
            [
              '-NoProfile',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              path.join(app, 'start.ps1'),
              '--help',
            ],
          ] as const)
        : (['sh', [path.join(app, 'start.sh'), '--help']] as const);
    expect(
      execFileSync(launcher[0], [...launcher[1]], {
        cwd: unrelated,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '', SCWC_NODE_PATH: '/wrong/node' },
      }),
    ).toContain('SCWC 外置 Node 运行时版');
    await fs.appendFile(path.join(app, '.env'), '\nSCWC_NODE_PATH="./missing node"\n');
    expect(() =>
      execFileSync(launcher[0], [...launcher[1]], { cwd: unrelated, stdio: 'pipe' }),
    ).toThrow();
  }, 15_000);
});
