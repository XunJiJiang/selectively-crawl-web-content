import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  plugins,
  inactivePlugins,
  currentPluginDirectory,
  pluginLifecycleEvents,
} from '../plugin/load.ts';
import { parseWebBuildScript } from '../plugin/web/options.ts';
import { workbenchEvents } from './events.ts';
import { assert } from './storage.ts';

export class PluginCatalog {
  revision = 0;
  private cache: { expires: number; items: Awaited<ReturnType<PluginCatalog['scan']>> } | undefined;
  private lastKnown = new Map<
    string,
    { fingerprint: string; handler: SCWC.IHostedPluginHandler }
  >();
  private building = new Set<string>();
  private errors = new Map<string, string>();
  constructor() {
    pluginLifecycleEvents.on('change', () => this.invalidate());
  }
  invalidate() {
    this.cache = undefined;
    this.revision++;
    workbenchEvents.publish(
      'catalog.changed',
      { revision: this.revision },
      undefined,
      this.revision,
    );
  }
  buildState(id: string, building: boolean, error?: string) {
    if (building) {
      this.building.add(id);
    } else {
      this.building.delete(id);
    }
    if (error) {
      this.errors.set(id, error);
    } else {
      this.errors.delete(id);
    }
    this.invalidate();
  }
  async list(force = false) {
    if (!force && this.cache && this.cache.expires > Date.now()) {
      return this.cache.items;
    }
    const items = await this.scan();
    this.cache = { items, expires: Date.now() + 2000 };
    return items;
  }
  async require(id: string) {
    const item = (await this.list()).find((p) => p.pluginId === id);
    assert(item, 'not_found', '插件不存在', 404);
    return item;
  }
  private async scan() {
    const directory = await currentPluginDirectory();
    const dirs = await fs
      .readdir(directory, { withFileTypes: true })
      .catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT') {
          return [];
        }
        throw e;
      });
    const items = [];
    for (const dir of dirs
      .filter((d) => d.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const id = dir.name,
        root = path.join(directory, id),
        diagnostics: { code: string; message: string }[] = [];
      let pkg: {
          name?: unknown;
          main?: unknown;
          version?: unknown;
          description?: unknown;
          enabled?: unknown;
          scwc?: { ui?: { title?: unknown; description?: unknown; entry?: unknown } };
          scripts?: Record<string, unknown>;
        } = {},
        fingerprint = '';
      try {
        const raw = await fs.readFile(path.join(root, 'package.json'), 'utf8');
        pkg = JSON.parse(raw);
        assert(
          pkg && typeof pkg === 'object' && !Array.isArray(pkg),
          'invalid_package',
          '包元数据不是对象',
        );
        const entry = typeof pkg.main === 'string' ? path.resolve(root, pkg.main) : '';
        const stat = entry ? await fs.stat(entry).catch(() => undefined) : undefined;
        fingerprint = createHash('sha256')
          .update(raw)
          .update(stat ? `${stat.size}:${stat.mtimeMs}` : 'missing')
          .digest('hex');
        if (!stat?.isFile() || !entry.match(/\.(ts|js)$/)) {
          diagnostics.push({ code: 'invalid_main', message: '插件入口缺失或无效' });
        }
      } catch {
        diagnostics.push({ code: 'invalid_package', message: 'package.json 缺失或格式错误' });
      }
      const live = plugins.find((p) => p.pluginId === id),
        inactive = inactivePlugins.find((p) => p.pluginId === id);
      if (live?.handler && this.lastKnown.get(id)?.handler !== live.handler) {
        this.lastKnown.set(id, { fingerprint, handler: live.handler });
      }
      const known = this.lastKnown.get(id),
        handler = live?.handler ?? (known?.fingerprint === fingerprint ? known.handler : undefined);
      const ui = pkg.scwc?.ui;
      const text = (v: unknown, label: string) => {
        if (v === undefined || v === null) {
          return null;
        }
        if (typeof v !== 'string') {
          diagnostics.push({ code: 'invalid_metadata', message: `${label} 必须为字符串` });
          return null;
        }
        return v.trim() || null;
      };
      const titles = [
        [text(ui?.title, 'scwc.ui.title'), 'package-ui'],
        [text(handler?.name, 'name'), 'exported-name'],
        [text(pkg.name, 'package.name'), 'package-name'],
        [id, 'directory'],
      ];
      const descriptions = [
        [text(handler?.description, 'description'), 'export'],
        [text(ui?.description, 'scwc.ui.description'), 'package-ui'],
        [text(pkg.description, 'package.description'), 'package-description'],
      ];
      const title = titles.find((t) => t[0]) ?? [id, 'directory'],
        description = descriptions.find((t) => t[0]);
      let buildCapability: 'supported' | 'absent' | 'unsupported' = 'absent';
      if (pkg.scripts?.['build:web']) {
        try {
          parseWebBuildScript(pkg.scripts['build:web'], root);
          buildCapability = 'supported';
        } catch {
          buildCapability = 'unsupported';
        }
      }
      const runtimeEntry = handler?.ui?.entry
        ? path.resolve(
            path.dirname(
              live?.entryFile ??
                path.resolve(root, typeof pkg.main === 'string' ? pkg.main : 'index.ts'),
            ),
            handler.ui.entry,
          )
        : undefined;
      const staticEntry = typeof ui?.entry === 'string' ? path.resolve(root, ui.entry) : undefined;
      const entry = runtimeEntry ?? staticEntry;
      if (runtimeEntry && staticEntry && runtimeEntry !== staticEntry) {
        diagnostics.push({ code: 'ui_entry_conflict', message: '运行时和静态UI入口不同' });
      }
      const exists = entry
        ? await fs.stat(entry).then(
            (s) => s.isFile(),
            () => false,
          )
        : false;
      const status =
        live?.runtime?.status ??
        (live
          ? 'ready'
          : pkg.enabled === false
            ? 'disabled'
            : inactive?.reason === '插件已临时停止'
              ? 'stopped'
              : inactive || diagnostics.length
                ? 'failed'
                : 'stopped');
      items.push({
        pluginId: id,
        exportedName: text(handler?.name, 'name'),
        packageName: text(pkg.name, 'package.name'),
        title: title[0] as string,
        description: (description?.[0] ?? null) as string | null,
        presentation: {
          titleSource: title[1],
          descriptionSource: description?.[1] ?? null,
          exportState: live ? 'current' : handler ? 'last-known' : 'unknown',
        },
        diagnostics,
        version: text(pkg.version, 'version'),
        enabled: pkg.enabled !== false,
        runtime: {
          status,
          pid: live?.runtime?.pid ?? null,
          reason: live?.runtime?.reason ?? inactive?.reason ?? null,
        },
        ui: {
          detection: runtimeEntry
            ? live
              ? 'runtime'
              : 'last-known'
            : staticEntry
              ? 'declared'
              : handler
                ? 'none'
                : 'unknown',
          state: this.building.has(id)
            ? 'building'
            : this.errors.has(id)
              ? 'error'
              : entry
                ? exists
                  ? 'ready'
                  : 'missing'
                : handler
                  ? 'none'
                  : 'unknown',
          entryUrl: exists && live ? `/web/page/plugin/${encodeURIComponent(id)}/` : null,
          buildCapability,
          diagnostics: this.errors.has(id)
            ? [{ code: 'build_failed', message: this.errors.get(id) ?? '构建失败' }]
            : [],
        },
        revision: this.revision,
      });
    }
    return items;
  }
}
export const pluginCatalog = new PluginCatalog();
