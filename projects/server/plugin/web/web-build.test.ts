import { bundledNodeFixture } from '../../scripts/release-test-utils.ts';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { buildPluginWeb, ensurePluginWeb } from './build.ts';
import { parseWebBuildScript } from './options.ts';
import { sharedPackageAssets } from '../../scripts/shared-package-assets.ts';

const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom') as {
  JSDOM: new (
    html: string,
    options: { runScripts: 'outside-only'; url: string },
  ) => { window: Window & { eval(code: string): unknown } };
};
const viteDirectory = path.dirname(require.resolve('vite/package.json'));
const vitePluginDirectory = fileURLToPath(new URL('../../../vite-plugin/', import.meta.url));

const roots: string[] = [];
const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
const bundled = await bundledNodeFixture();
const executable = bundled?.executable ?? '';
afterAll(async () => {
  await bundled?.cleanup();
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

async function fixture(experimentalDecorators?: boolean) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-web-test-'));
  roots.push(directory);
  await fs.mkdir(path.join(directory, 'web'));
  if (experimentalDecorators !== undefined) {
    await fs.writeFile(
      path.join(directory, 'web/tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', experimentalDecorators } }),
    );
  }
  await fs.writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({
      type: 'module',
      scripts: { 'build:web': 'vite build --config "vite config.ts"' },
    }),
  );
  await fs.writeFile(
    path.join(directory, 'vite config.ts'),
    `
import { defineConfig } from 'vite';
import scwcVite from '@scwc/vite-plugin';
import path from 'node:path';
export default defineConfig({
  root:path.join(import.meta.dirname,'web'),
  plugins:[scwcVite()],
  worker:{plugins:()=>[scwcVite()]},
  build:{outDir:'dist'},
});
`,
  );
  await fs.writeFile(
    path.join(directory, 'web/index.html'),
    '<html><body><script type="module" src="./main.ts"></script></body></html>',
  );
  await fs.writeFile(
    path.join(directory, 'web/main.ts'),
    `
import {html,render,LitElement} from 'lit';
import {customElement,property} from 'lit/decorators.js';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'scwc:deps';
import '@vscode/codicons/dist/codicon.css';
render(html\`<p>\${z.string().parse('shared')} \${repeat([1,2], value=>value)}</p>\`,document.body);
@customElement('scwc-decorator-fixture')
class DecoratorFixture extends LitElement {
  @property({type:String,reflect:true}) accessor label = 'initial';
  render() { return html\`<span>\${this.label}</span>\`; }
}
document.body.append(document.createElement('scwc-decorator-fixture'));
new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
`,
  );
  await fs.writeFile(
    path.join(directory, 'web/worker.ts'),
    `import {html} from 'lit'; import {z} from 'scwc:deps';
function identity(value) { return value; }
@identity class WorkerValue { text = 'worker'; }
postMessage(z.string().parse(String(html\`\${new WorkerValue().text}\`)));`,
  );
  return { directory, entry: path.join(directory, 'web/dist/index.html') };
}

async function verifyBrowserOutput(entry: string): Promise<void> {
  const directory = path.dirname(entry);
  const files = await fs.readdir(path.join(directory, 'assets'));
  for (const file of files.filter((file) => file.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(directory, 'assets', file)], {
      stdio: 'pipe',
    });
  }
  const html = await fs.readFile(entry, 'utf8');
  const asset = html.match(/src="[^"]*\/assets\/([^"/]+\.js)"/)?.[1];
  if (!asset) {
    throw new Error('Missing browser entry');
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'http://localhost/',
  });
  Object.defineProperty(dom.window, 'Worker', {
    value: function WorkerStub() {
      return {};
    },
  });
  try {
    const code = await fs.readFile(path.join(directory, 'assets', asset), 'utf8');
    // JSDOM evaluates classic scripts; the original module syntax is checked above.
    dom.window.eval(
      code.replaceAll('import.meta.url', JSON.stringify('http://localhost/entry.js')),
    );
    const element = dom.window.document.querySelector(
      'scwc-decorator-fixture',
    ) as unknown as HTMLElement & { label: string; updateComplete: Promise<unknown> };
    expect(element).not.toBeNull();
    await element.updateComplete;
    expect(element.shadowRoot?.textContent).toContain('initial');
    element.setAttribute('label', 'updated');
    await element.updateComplete;
    expect(element.label).toBe('updated');
    expect(element.shadowRoot?.textContent).toContain('updated');
  } finally {
    dom.window.close();
  }
}

describe('plugin frontend contract', () => {
  it('builds with the copied shared frontend package and styles outside the workspace', async () => {
    const f = await fixture();
    const root = fileURLToPath(new URL('../../../../', import.meta.url));
    const assets = await sharedPackageAssets(root, [
      '@scwc/vite-plugin',
      'zod',
      '@vscode/codicons',
    ]);
    for (const file of [
      'frontend.ts',
      'backend.ts',
      'components/button.css',
      'components/scroll-container/scroll-container.ts',
    ]) {
      expect(assets[`node_modules/@scwc/shared/${file}`]).toBeDefined();
    }
    for (const [relative, source] of Object.entries(assets)) {
      const destination = path.join(f.directory, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await fs.symlink(viteDirectory, path.join(f.directory, 'node_modules/vite'), linkType);
    await fs.symlink(
      path.dirname(require.resolve('esbuild/package.json')),
      path.join(f.directory, 'node_modules/esbuild'),
      linkType,
    );
    execFileSync(
      process.execPath,
      [
        path.join(viteDirectory, 'bin/vite.js'),
        'build',
        '--config',
        'vite config.ts',
        '--configLoader',
        'native',
      ],
      {
        cwd: f.directory,
        stdio: 'pipe',
        timeout: 20_000,
        env: { ...process.env, SCWC_RUNTIME_ROOT: undefined },
      },
    );
    await verifyBrowserOutput(f.entry);
  }, 30_000);

  it('automatically registers page components without a shared import', async () => {
    const f = await fixture();
    await fs.writeFile(
      path.join(f.directory, 'web/main.ts'),
      "document.body.append(document.createElement('scwc-button'));",
    );
    await buildPluginWeb(f.directory, logger, { expectedEntry: f.entry });
    const files = await fs.readdir(path.join(path.dirname(f.entry), 'assets'));
    const script = files.find((file) => file.endsWith('.js'));
    if (!script) {
      throw new Error('Missing browser entry');
    }
    const source = await fs.readFile(path.join(path.dirname(f.entry), 'assets', script), 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only',
      url: 'http://localhost/',
    });
    try {
      dom.window.eval(source);
      for (const tag of [
        'button',
        'input',
        'trigger',
        'toggle',
        'select',
        'checkbox',
        'notify',
        'scroll-container',
      ]) {
        expect(dom.window.customElements.get(`scwc-${tag}`)).toBeDefined();
      }
      const button = dom.window.document.querySelector('scwc-button') as HTMLElement & {
        updateComplete: Promise<unknown>;
      };
      await button.updateComplete;
      expect(button.shadowRoot?.querySelector('button')).not.toBeNull();
      expect(dom.window.document.querySelectorAll('.scwc-notify-root')).toHaveLength(1);
    } finally {
      dom.window.close();
    }
  }, 30_000);

  it('resolves explicit shared frontend exports and leaves Workers free of DOM registrations', async () => {
    const f = await fixture();
    await fs.appendFile(
      path.join(f.directory, 'web/main.ts'),
      "import { cache, tryCatch, SCWCScrollContainer } from 'scwc:shared/frontend'; document.body.dataset.shared = String(tryCatch(() => cache((n) => n * 2)(3))[1]); document.body.append(new SCWCScrollContainer());",
    );
    await buildPluginWeb(f.directory, logger, { expectedEntry: f.entry });
    await verifyBrowserOutput(f.entry);
    const directory = path.join(path.dirname(f.entry), 'assets');
    const worker = (await fs.readdir(directory)).find(
      (file) => file.startsWith('worker-') && file.endsWith('.js'),
    );
    if (!worker) {
      throw new Error('Missing browser Worker');
    }
    expect(await fs.readFile(path.join(directory, worker), 'utf8')).not.toContain('scwc-notify');
  }, 30_000);

  it.each(['bundle', 'native'])(
    'uses the public Vite plugin in a standalone %s config without browser dependencies',
    async (configLoader) => {
      const f = await fixture();
      await fs.mkdir(path.join(f.directory, 'node_modules/@scwc'), { recursive: true });
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.symlink(viteDirectory, path.join(f.directory, 'node_modules/vite'), linkType);
      await fs.symlink(
        vitePluginDirectory,
        path.join(f.directory, 'node_modules/@scwc/vite-plugin'),
        linkType,
      );
      execFileSync(
        process.execPath,
        [
          path.join(viteDirectory, 'bin/vite.js'),
          'build',
          '--config',
          'vite config.ts',
          '--configLoader',
          configLoader,
        ],
        {
          cwd: f.directory,
          stdio: 'pipe',
          timeout: 20_000,
          env: { ...process.env, SCWC_RUNTIME_ROOT: undefined },
        },
      );
      for (const name of ['lit', 'zod', '@vscode/codicons']) {
        expect(existsSync(path.join(f.directory, 'node_modules', name))).toBe(false);
      }
      await verifyBrowserOutput(f.entry);
    },
    25_000,
  );

  it('prefers a plugin-owned browser package and does not expose unlisted core packages', async () => {
    const f = await fixture();
    const owned = path.join(f.directory, 'node_modules/dayjs');
    await fs.mkdir(owned, { recursive: true });
    await fs.writeFile(
      path.join(owned, 'package.json'),
      JSON.stringify({ name: 'dayjs', type: 'module', exports: './index.js' }),
    );
    await fs.writeFile(path.join(owned, 'index.js'), "export default 'plugin-owned-dayjs';");
    await fs.appendFile(
      path.join(f.directory, 'web/main.ts'),
      "import owned from 'dayjs'; document.body.append(owned);",
    );
    await buildPluginWeb(f.directory, logger, { expectedEntry: f.entry });
    const html = await fs.readFile(f.entry, 'utf8');
    const scripts = (await fs.readdir(path.join(path.dirname(f.entry), 'assets'))).filter((file) =>
      file.endsWith('.js'),
    );
    const code = await Promise.all(
      scripts.map((file) => fs.readFile(path.join(path.dirname(f.entry), 'assets', file), 'utf8')),
    );
    expect(code.some((source) => source.includes('plugin-owned-dayjs'))).toBe(true);
    await fs.appendFile(path.join(f.directory, 'web/main.ts'), "import 'string-width';");
    await expect(buildPluginWeb(f.directory, logger, { expectedEntry: f.entry })).rejects.toThrow(
      '构建失败',
    );
    expect(await fs.readFile(f.entry, 'utf8')).toBe(html);
  }, 30_000);

  it('parses quoted Vite configuration and rejects arbitrary shell commands', () => {
    expect(
      parseWebBuildScript('vite build web --config "my config.ts" --mode=testing', '/plugin'),
    ).toEqual({
      root: path.resolve('/plugin', 'web'),
      configFile: path.resolve('/plugin', 'my config.ts'),
      mode: 'testing',
    });
    expect(() => parseWebBuildScript('node arbitrary.js', '/plugin')).toThrow('vite build');
    expect(() => parseWebBuildScript('vite build && node arbitrary.js', '/plugin')).toThrow(
      '不支持参数',
    );
    expect(() => parseWebBuildScript(undefined, '/plugin')).toThrow('scripts.build:web');
  });

  it('builds through a directory alias while checking the real entry path', async () => {
    const f = await fixture();
    const aliases = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-web-alias-'));
    roots.push(aliases);
    const alias = path.join(aliases, 'linked plugin');
    await fs.symlink(f.directory, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await buildPluginWeb(alias, logger, { expectedEntry: f.entry });
    await verifyBrowserOutput(f.entry);
  }, 30_000);

  it('rejects an output directory whose existing ancestor links outside the plugin', async () => {
    const f = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-web-outside-'));
    roots.push(outside);
    await fs.writeFile(path.join(outside, 'keep.txt'), 'untouched');
    await fs.symlink(
      outside,
      path.join(f.directory, 'linked output'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await fs.writeFile(
      path.join(f.directory, 'vite config.ts'),
      "export default { root: './web', build: { outDir: '../linked output/dist' } };",
    );
    await expect(buildPluginWeb(f.directory, logger)).rejects.toThrow('Vite outDir');
    expect(await fs.readdir(outside)).toEqual(['keep.txt']);
    expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('untouched');
  });

  it('accepts supplied frontend artifacts without requiring a build script', async () => {
    const f = await fixture();
    await fs.mkdir(path.dirname(f.entry));
    await fs.writeFile(f.entry, 'prebuilt');
    await fs.writeFile(path.join(f.directory, 'package.json'), '{}');
    await ensurePluginWeb(
      f.directory,
      path.join(f.directory, 'index.ts'),
      {
        onRequest: () => undefined,
        ui: { entry: './web/dist/index.html' },
      },
      logger,
    );
    expect(await fs.readFile(f.entry, 'utf8')).toBe('prebuilt');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each([undefined, true])(
    'builds missing pages and Workers with experimentalDecorators=%s, deduplicates requests, and preserves old pages on failure',
    async (experimentalDecorators) => {
      const f = await fixture(experimentalDecorators);
      expect(existsSync(path.join(f.directory, 'node_modules'))).toBe(false);
      await Promise.all([
        buildPluginWeb(f.directory, logger, { expectedEntry: f.entry }),
        buildPluginWeb(f.directory, logger, { expectedEntry: f.entry }),
      ]);
      const html = await fs.readFile(f.entry, 'utf8');
      await verifyBrowserOutput(f.entry);
      expect(html).toContain(`/web/page/plugin/${path.basename(f.directory)}/assets/`);
      expect(
        logger.info.mock.calls.filter((call) => String(call[0]).startsWith('正在构建插件页面')),
      ).toHaveLength(1);
      expect(
        (await fs.readdir(path.join(path.dirname(f.entry), 'assets'))).some((file) =>
          file.startsWith('worker-'),
        ),
      ).toBe(true);
      await fs.writeFile(path.join(f.directory, 'web/main.ts'), 'invalid TypeScript {');
      await expect(buildPluginWeb(f.directory, logger, { expectedEntry: f.entry })).rejects.toThrow(
        '构建失败',
      );
      expect(await fs.readFile(f.entry, 'utf8')).toBe(html);
      expect(
        (await fs.readdir(path.dirname(path.dirname(f.entry)))).some((file) =>
          file.startsWith('.scwc-web-'),
        ),
      ).toBe(false);
    },
    30_000,
  );

  it.skipIf(!existsSync(executable))(
    'builds with the SEA executable without external Node, Vite or core node_modules',
    async () => {
      const f = await fixture();
      const portableExecutable = path.join(f.directory, path.basename(executable));
      await fs.copyFile(executable, portableExecutable);
      const temp = path.join(f.directory, 'temp');
      await fs.mkdir(temp);
      execFileSync(portableExecutable, ['--build-plugin-web', f.directory], {
        cwd: f.directory,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          NODE_OPTIONS: '',
          SCWC_RUNTIME_ROOT: undefined,
          TEMP: temp,
          TMP: temp,
          TMPDIR: temp,
        },
      });
      expect(await fs.readFile(f.entry, 'utf8')).toContain(
        `/web/page/plugin/${path.basename(f.directory)}/assets/`,
      );
      expect(existsSync(path.join(f.directory, 'node_modules'))).toBe(false);
      await verifyBrowserOutput(f.entry);
    },
    60_000,
  );
});
