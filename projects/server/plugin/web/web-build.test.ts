import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPluginWeb, ensurePluginWeb } from './build.ts';
import { parseWebBuildScript } from './options.ts';

const roots: string[] = [];
const logger = { info: vi.fn(), pathInfo: vi.fn(), warn: vi.fn(), error: vi.fn() };
const executable = fileURLToPath(
  new URL(
    '../../../../dist/core/' + (process.platform === 'win32' ? 'scwc.exe' : 'scwc'),
    import.meta.url,
  ),
);
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  vi.clearAllMocks();
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-web-test-'));
  roots.push(directory);
  await fs.mkdir(path.join(directory, 'web'));
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
import path from 'node:path';
export default defineConfig({root:path.join(import.meta.dirname,'web'),build:{outDir:'dist'}});
`,
  );
  await fs.writeFile(
    path.join(directory, 'web/index.html'),
    '<html><body><script type="module" src="./main.ts"></script></body></html>',
  );
  await fs.writeFile(
    path.join(directory, 'web/main.ts'),
    `
import {html,render} from 'lit';
import {repeat} from 'lit/directives/repeat.js';
import {z} from 'scwc:deps';
import '@vscode/codicons/dist/codicon.css';
render(html\`<p>\${z.string().parse('shared')} \${repeat([1,2], value=>value)}</p>\`,document.body);
new Worker(new URL('./worker.ts',import.meta.url),{type:'module'});
`,
  );
  await fs.writeFile(
    path.join(directory, 'web/worker.ts'),
    "import {html} from 'lit'; import {z} from 'scwc:deps'; postMessage(z.string().parse(String(html`worker`)));",
  );
  return { directory, entry: path.join(directory, 'web/dist/index.html') };
}

describe('plugin frontend contract', () => {
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

  it('builds missing pages and Workers from core packages, deduplicates requests, and preserves old pages on failure', async () => {
    const f = await fixture();
    expect(existsSync(path.join(f.directory, 'node_modules'))).toBe(false);
    await Promise.all([
      buildPluginWeb(f.directory, logger, { expectedEntry: f.entry }),
      buildPluginWeb(f.directory, logger, { expectedEntry: f.entry }),
    ]);
    const html = await fs.readFile(f.entry, 'utf8');
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
  }, 30_000);

  it.skipIf(!existsSync(executable))(
    'builds with the SEA executable without external Node, Vite or core node_modules',
    async () => {
      const f = await fixture();
      const temp = path.join(f.directory, 'temp');
      await fs.mkdir(temp);
      execFileSync(executable, ['--build-plugin-web', f.directory], {
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
    },
    60_000,
  );
});
