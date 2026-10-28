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
import { z } from 'zod';
import { progressSchema } from './feedback-schema.ts';
import type { FeedbackOwner, TaskState } from '../../shared/workbench-feedback.ts';
export type Job = TaskState;
const taskSchema = z
  .object({
    title: z.string().min(1).max(1000),
    type: z.string().min(1).max(100).optional(),
    status: z
      .enum(['queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'])
      .optional(),
    phase: z.string().max(1000).optional(),
    content: z.string().max(64000).optional(),
    progress: progressSchema.optional(),
    error: z.string().max(16000).optional(),
  })
  .strict();
export const taskFinished = (job: Pick<Job, 'status'>) =>
  ['succeeded', 'failed', 'cancelled'].includes(job.status);
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
  list() {
    return (
      this.storage.db.prepare('SELECT value_json FROM jobs ORDER BY updated_at,id').all() as {
        value_json: string;
      }[]
    ).map((row) => JSON.parse(row.value_json) as Job);
  }
  owned(id: string, owner: FeedbackOwner) {
    const job = this.get(id);
    assert(
      job.owner?.source === owner.source &&
        job.owner?.pluginId === owner.pluginId &&
        job.owner?.tabId === owner.tabId &&
        job.owner?.ownerId === owner.ownerId,
      'task_owner',
      '任务不属于当前调用方',
      403,
    );
    return job;
  }
  create(input: unknown, owner: FeedbackOwner) {
    assert(!this.stopping, 'stopping', '核心正在退出', 503);
    const options = taskSchema.parse(input);
    const job: Job = {
      ...options,
      id: randomUUID(),
      pluginId: owner.pluginId ?? '',
      type: options.type ?? 'custom',
      status: options.status ?? 'running',
      phase: options.phase ?? '',
      progress: options.progress === undefined ? null : options.progress,
      revision: 1,
      logs: [],
      createdAt: now(),
      readAt: null,
      owner,
    };
    this.save(job);
    return job;
  }
  update(id: string, input: unknown, owner: FeedbackOwner) {
    const patch = taskSchema
      .partial()
      .extend({
        log: z
          .object({ level: z.string().max(40).optional(), text: z.string().max(8192) })
          .strict()
          .optional(),
      })
      .parse(input);
    const job = this.owned(id, owner);
    assert(
      !taskFinished(job) || !patch.status || taskFinished({ status: patch.status }),
      'task_finished',
      '已完成任务不能重新运行',
      409,
    );
    const { log, ...fields } = patch;
    Object.assign(
      job,
      Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)),
    );
    if (log) {
      job.logs = [
        ...job.logs,
        { seq: (job.logs.at(-1)?.seq ?? 0) + 1, level: log.level ?? 'info', text: log.text },
      ].slice(-500);
    }
    if (taskFinished(job) && patch.progress === undefined) {
      job.progress = job.status === 'succeeded' ? 100 : false;
    }
    this.save(job);
    return job;
  }
  acknowledge(ids: string[]) {
    z.array(z.string()).max(1000).parse(ids);
    for (const id of ids) {
      const job = this.get(id);
      if (taskFinished(job) && !job.readAt) {
        job.readAt = now();
        this.save(job);
      }
    }
  }
  releaseOwner(ownerId: string) {
    for (const job of this.list()) {
      if (job.owner?.ownerId === ownerId && !taskFinished(job)) {
        job.status = 'failed';
        job.error = '任务所属进程或页面已关闭';
        job.progress = false;
        this.save(job);
      }
    }
  }
  private save(job: Job) {
    const row = this.storage.db.prepare('SELECT value_json FROM jobs WHERE id=?').get(job.id) as
      | { value_json: string }
      | undefined;
    if (row) {
      const previous = JSON.parse(row.value_json) as Job;
      job.revision = Math.max(job.revision, previous.revision + 1);
      if (!taskFinished(previous) && taskFinished(job)) {
        job.readAt = null;
      } else if (!job.readAt) {
        job.readAt = previous.readAt ?? null;
      }
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
        readAt: null,
        progress: null,
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
        job.progress = 100;
      } catch (error) {
        job.error = error instanceof Error ? error.message : String(error);
        job.status = controller.signal.aborted ? 'cancelled' : 'failed';
        job.progress = false;
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
    if (job.owner) {
      job.status = 'cancelled';
      job.progress = false;
      this.save(job);
      return job;
    }
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
