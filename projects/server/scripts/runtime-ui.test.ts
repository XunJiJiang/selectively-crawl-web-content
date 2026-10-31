import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { BUILD_ROOT } from './build-runtime.ts';
import { sharedExternalPackages, sharedPackageAssets } from './shared-package-assets.ts';

it('compiles and sanitizes declarative UI with only the shipped runtime assets', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-runtime-ui-'));
  try {
    const runtime = path.join(directory, 'runtime');
    await fs.mkdir(runtime);
    for (const [relative, source] of Object.entries(await sharedPackageAssets(BUILD_ROOT))) {
      const destination = path.join(runtime, relative);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    }
    await build({
      entryPoints: [path.join(BUILD_ROOT, 'projects/server/workbench/ui-compiler.ts')],
      outfile: path.join(runtime, 'compiler.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs',
      minify: true,
      keepNames: true,
      external: sharedExternalPackages,
      define: { 'import.meta.url': JSON.stringify('file:///scwc/bundle.cjs') },
    });
    const output = execFileSync(
      process.execPath,
      [
        '--eval',
        `
try {
const {registerHooks}=require('node:module');
const {pathToFileURL}=require('node:url');
const root=pathToFileURL(process.cwd()+'/').href;
registerHooks({resolve(specifier,context,next){const result=next(specifier,context);if(result.url.startsWith('file:')&&!result.url.startsWith(root))throw Error('Dependency outside runtime: '+result.url);return result;}});
const {compileUI,compileCSS}=require('./runtime/compiler.cjs');
const content=compileUI({format:'html',version:1,html:'<p>ready</p><script>throw Error("unsafe")</script>'},{resource:value=>value,validateCall:()=>{}});
console.log(JSON.stringify({nodes:content.nodes,css:compileCSS('p { color: red }',value=>value)}));
} catch (error) { console.error(error.message); process.exitCode=1; }
`,
      ],
      {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      },
    );
    expect(JSON.parse(output)).toMatchObject({
      nodes: [{ tag: 'p', children: [{ text: 'ready' }] }],
      css: 'p{color:red}',
    });
    expect(output).not.toContain('unsafe');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 30_000);
