import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  enablePlugin,
  disablePlugin,
  onceDisablePlugin,
  reloadPlugin,
  enqueuePlugin,
  currentPluginDirectory,
  plugins,
} from '../plugin/load.ts';
import { buildPluginWeb } from '../plugin/web/build.ts';
import { pluginCatalog } from './catalog.ts';
import { assert, json, now, type WorkbenchStorage } from './storage.ts';
import { workbenchEvents } from './events.ts';
export interface Job {
  id: string;
  pluginId: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled';
  phase: string;
  revision: number;
  logs: { seq: number; level: string; text: string }[];
  error?: string;
  createdAt: string;
}
export class OperationService {
  private controllers = new Map<string, AbortController>();
  private running = new Map<string, Promise<void>>();
  private sharedBuilds = new Map<string, string>();
  private stopping = false;
  private storage: WorkbenchStorage;
  constructor(storage: WorkbenchStorage) {
    this.storage = storage;
  }
  get(id: string) {
    const row = this.storage.db.prepare('SELECT value_json FROM jobs WHERE id=?').get(id) as
      | { value_json: string }
      | undefined;
    assert(row, 'not_found', '任务不存在', 404);
    return JSON.parse(row.value_json) as Job;
  }
  private save(job: Job) {
    const row = this.storage.db.prepare('SELECT value_json FROM jobs WHERE id=?').get(job.id) as
      | { value_json: string }
      | undefined;
    if (row) {
      job.revision = Math.max(job.revision, JSON.parse(row.value_json).revision + 1);
    }
    this.storage.db
      .prepare(
        'INSERT INTO jobs VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
      )
      .run(job.id, json(job), now());
    workbenchEvents.publish('job.changed', job, job.id, job.revision);
  }
  async start(pluginId: string, action: string, key: string) {
    assert(!this.stopping, 'stopping', '核心正在退出', 503);
    assert(
      ['rescan', 'enable', 'disable', 'once-disable', 'reload', 'build-ui'].includes(action),
      'invalid_action',
      '未知插件操作',
    );
    if (action !== 'rescan') {
      await pluginCatalog.require(pluginId);
    }
    const shared = action === 'build-ui' ? this.sharedBuilds.get(pluginId) : undefined;
    const accepted = this.storage.receipt(`job:${key}`, json({ pluginId, action }), () => {
      if (shared) {
        return this.get(shared);
      }
      const value: Job = {
        id: randomUUID(),
        pluginId,
        type: action,
        status: 'queued',
        phase: 'queued',
        revision: 1,
        logs: [],
        createdAt: now(),
      };
      this.save(value);
      return value;
    });
    // The receipt is the original acceptance; current status lives in jobs.
    const job = this.get(accepted.id);
    if (this.running.has(job.id) || job.status !== 'queued') {
      return this.get(job.id);
    }
    if (action === 'build-ui') {
      this.sharedBuilds.set(pluginId, job.id);
    }
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const run = Promise.resolve().then(async () => {
      try {
        controller.signal.throwIfAborted();
        job.status = 'running';
        job.phase = action;
        job.revision++;
        this.save(job);
        if (action === 'rescan') {
          await pluginCatalog.list(true);
        } else if (action === 'build-ui') {
          await enqueuePlugin(pluginId, async () => {
            controller.signal.throwIfAborted();
            pluginCatalog.buildState(pluginId, true);
            const log =
              (level: string) =>
              (...args: unknown[]) => {
                job.logs.push({
                  seq: (job.logs.at(-1)?.seq ?? 0) + 1,
                  level,
                  text: args.map(String).join(' ').slice(0, 8192),
                });
                if (job.logs.length > 500) {
                  job.logs.shift();
                }
                job.revision++;
                this.save(job);
              };
            const plugin = plugins.find((p) => p.pluginId === pluginId);
            await buildPluginWeb(
              path.join(await currentPluginDirectory(), pluginId),
              { info: log('info'), warn: log('warn'), error: log('error'), pathInfo: log('info') },
              {
                signal: controller.signal,
                expectedEntry: plugin?.handler?.ui?.entry
                  ? path.resolve(path.dirname(plugin.entryFile), plugin.handler.ui.entry)
                  : undefined,
              },
            );
            await plugin?.handler?.ui?.html?.();
          });
        } else {
          await (
            {
              enable: enablePlugin,
              disable: disablePlugin,
              'once-disable': onceDisablePlugin,
              reload: reloadPlugin,
            }[action] ?? (() => Promise.reject(new Error('未知操作')))
          )(pluginId);
        }
        job.status = 'succeeded';
        job.phase = 'done';
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
      } finally {
        if (action === 'build-ui') {
          this.sharedBuilds.delete(pluginId);
          pluginCatalog.buildState(
            pluginId,
            false,
            job.status === 'failed' ? job.error : undefined,
          );
        }
        job.revision++;
        this.save(job);
        this.controllers.delete(job.id);
        this.running.delete(job.id);
        pluginCatalog.invalidate();
      }
    });
    this.running.set(job.id, run);
    return job;
  }
  cancel(id: string, revision: number) {
    const job = this.get(id);
    assert(job.revision === revision, 'revision_conflict', '任务状态已变化', 409);
    assert(['queued', 'running'].includes(job.status), 'not_cancellable', '任务已结束', 409);
    assert(
      job.type === 'build-ui' || job.status === 'queued',
      'not_cancellable',
      '生命周期操作已进入不可取消阶段',
      409,
    );
    job.status = 'cancelling';
    job.revision++;
    this.controllers.get(id)?.abort();
    this.save(job);
    return job;
  }
  async close() {
    this.stopping = true;
    for (const c of this.controllers.values()) {
      c.abort();
    }
    await Promise.all(this.running.values());
  }
}
