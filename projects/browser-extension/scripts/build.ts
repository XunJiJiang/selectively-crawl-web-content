import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildVite } from 'vite';
import { build as buildScript } from 'esbuild';
import { zipSync } from 'fflate';

const project = path.resolve(import.meta.dirname, '..');
const defaultOutput = path.resolve(project, '../../dist/browser-extension');
export async function buildBrowserExtensions(output = defaultOutput) {
  const metadata = JSON.parse(await fs.readFile(path.join(project, 'package.json'), 'utf8')) as {
    version: string;
  };
  await buildVite({
    configFile: path.join(project, 'vite.config.ts'),
    build: { outDir: path.join(output, 'chromium'), emptyOutDir: true },
  });
  const chromium = path.join(output, 'chromium');
  for (const name of ['background', 'content']) {
    await buildScript({
      entryPoints: [path.join(project, `src/${name}.ts`)],
      outfile: path.join(chromium, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: ['chrome120', 'firefox128', 'safari18'],
      minify: false,
      tsconfig: path.join(project, 'tsconfig.json'),
    });
  }
  await fs.cp(path.join(project, 'assets/icons'), path.join(chromium, 'icons'), {
    recursive: true,
  });
  await fs.copyFile(path.resolve(project, '../../LICENSE'), path.join(chromium, 'LICENSE'));
  const common = {
    manifest_version: 3,
    name: 'SCWC · 选择性网页采集',
    version: metadata.version,
    description:
      '在工具栏弹窗中选择网页内容并发送到你配置的 SCWC 核心，支持网站抓取项与插件配置同步。',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    action: {
      default_popup: 'index.html',
      default_title: 'SCWC · 网页采集',
      default_icon: { '16': 'icons/16.png', '32': 'icons/32.png' },
    },
    icons: {
      '16': 'icons/16.png',
      '32': 'icons/32.png',
      '48': 'icons/48.png',
      '128': 'icons/128.png',
    },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  };
  const variants = {
    chromium: {
      ...common,
      minimum_chrome_version: '120',
      background: { service_worker: 'background.js' },
    },
    firefox: {
      ...common,
      background: { scripts: ['background.js'] },
      browser_specific_settings: {
        gecko: {
          id: 'browser-extension@scwc.xunji',
          strict_min_version: '140.0',
          data_collection_permissions: {
            required: ['websiteContent', 'browsingActivity'],
            optional: [],
          },
        },
      },
    },
    safari: { ...common, background: { scripts: ['background.js'], persistent: false } },
  };
  async function files(directory: string, prefix = ''): Promise<Record<string, Uint8Array>> {
    const result: Record<string, Uint8Array> = {};
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) {
        Object.assign(result, await files(path.join(directory, entry.name), name + '/'));
      } else {
        result[name] = new Uint8Array(await fs.readFile(path.join(directory, entry.name)));
      }
    }
    return result;
  }
  for (const [name, manifest] of Object.entries(variants)) {
    const directory = path.join(output, name);
    if (name !== 'chromium') {
      if (path.dirname(directory) !== output) {
        throw new Error('输出目录越界');
      }
      await fs.rm(directory, { recursive: true, force: true });
      await fs.cp(chromium, directory, { recursive: true });
    }
    await fs.writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
    );
    await fs.writeFile(
      path.join(output, `scwc-${name}-${metadata.version}.zip`),
      zipSync(await files(directory), { level: 6 }),
    );
  }
  console.log(`浏览器扩展已输出到 ${output}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await buildBrowserExtensions();
}
