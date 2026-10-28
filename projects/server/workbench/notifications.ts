import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getStorage, json, now, assert, type WorkbenchStorage } from './storage.ts';
import {
  createFeedbackClient,
  type FeedbackOwner,
  type FeedbackRequest,
  type NotificationState,
} from '../../shared/workbench-feedback.ts';
import { progressSchema } from './feedback-schema.ts';
import { workbenchEvents } from './events.ts';
export type { NotificationLogger, NotificationOptions } from '../types/notifications.d.ts';
const optionsSchema = z
  .object({
    message: z.string().max(16000).optional(),
    dedupeKey: z.string().max(200).optional(),
    progress: progressSchema.optional(),
    autoRead: z.boolean().optional(),
    actions: z
      .array(
        z
          .object({
            type: z.literal('callback'),
            id: z.string().uuid(),
            label: z.string().min(1).max(100),
          })
          .strict(),
      )
      .max(4)
      .optional(),
    target: z
      .object({
        pluginPath: z
          .string()
          .max(8192)
          .refine(
            (v) =>
              v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') && !v.includes('..'),
          ),
      })
      .strict()
      .optional(),
  })
  .strict();
export class NotificationService {
  private rates = new Map<string, { tokens: number; time: number }>();
  private handlers = new Map<string, (actionId: string) => void | Promise<void>>();
  private viewers = new Map<string, { ids: Set<string>; time: number }>();
  private storage: WorkbenchStorage;
  constructor(storage: WorkbenchStorage) {
    this.storage = storage;
  }
  publish(
    source: 'core' | 'plugin' | 'page',
    pluginId: string | null,
    level: string,
    title: string,
    options: unknown = {},
    identity: { tabId?: string; executionId?: string; ownerId?: string } = {},
  ) {
    z.enum(['info', 'success', 'warn', 'error']).parse(level);
    z.string().min(1).max(1000).parse(title);
    const opts = optionsSchema.parse(options);
    const sourceKey = `${source}:${pluginId ?? 'core'}:${identity.ownerId ?? identity.tabId ?? ''}`;
    const rate = this.rates.get(sourceKey) ?? { tokens: 30, time: Date.now() };
    rate.tokens = Math.min(30, rate.tokens + (Date.now() - rate.time) / 100);
    rate.time = Date.now();
    this.rates.set(sourceKey, rate);
    assert(rate.tokens >= 1, 'rate_limited', '通知过于频繁', 429);
    rate.tokens--;
    const previous = opts.dedupeKey
      ? (this.storage.db
          .prepare('SELECT id,value_json FROM notifications WHERE source_key=? AND dedupe_key=?')
          .get(sourceKey, opts.dedupeKey) as { id: string; value_json: string } | undefined)
      : undefined;
    const old = previous ? JSON.parse(previous.value_json) : undefined;
    assert(
      (opts.actions?.length ?? 0) + Number(Boolean(opts.target)) <= 4,
      'invalid_actions',
      '通知最多支持 4 个操作按钮',
    );
    const value: NotificationState & { createdAt: string; dedupeKey: string | null } = {
      id: previous?.id ?? randomUUID(),
      source,
      pluginId,
      ...identity,
      level,
      title,
      message: opts.message ?? '',
      createdAt: old?.createdAt ?? now(),
      updatedAt: now(),
      readAt: null,
      dedupeKey: opts.dedupeKey ?? null,
      count: (old?.count ?? 0) + 1,
      progress: opts.progress === undefined ? false : opts.progress,
      autoRead: opts.autoRead ?? true,
      seenAt: old?.seenAt ?? null,
      actions: [
        ...(opts.actions ?? []),
        ...(opts.target ? [{ type: 'plugin-url', path: opts.target.pluginPath }] : []),
      ],
    };
    this.storage.db.transaction(() => {
      this.storage.db
        .prepare(
          'INSERT INTO notifications VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at',
        )
        .run(value.id, sourceKey, opts.dedupeKey ?? null, json(value), value.updatedAt);
      this.storage.db
        .prepare(
          'DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY updated_at DESC LIMIT 1000)',
        )
        .run();
    })();
    workbenchEvents.publish(
      previous ? 'notification.updated' : 'notification.created',
      value,
      value.id,
    );
    return this.withVisibility(value);
  }
  private withVisibility(value: NotificationState): NotificationState {
    return {
      ...value,
      visible: [...this.viewers.values()].some(
        (v) => Date.now() - v.time < 20000 && v.ids.has(value.id),
      ),
    };
  }
  get(id: string, owner?: FeedbackOwner) {
    const row = this.storage.db
      .prepare('SELECT value_json FROM notifications WHERE id=?')
      .get(id) as { value_json: string } | undefined;
    assert(row, 'not_found', '通知不存在', 404);
    const value = JSON.parse(row.value_json) as NotificationState;
    if (owner) {
      assert(
        value.source === owner.source &&
          value.pluginId === owner.pluginId &&
          value.tabId === owner.tabId &&
          value.ownerId === owner.ownerId,
        'notification_owner',
        '通知不属于当前调用方',
        403,
      );
    }
    return this.withVisibility(value);
  }
  private save(value: NotificationState) {
    const { visible: _visible, ...stored } = value;
    this.storage.db
      .prepare('UPDATE notifications SET value_json=?,updated_at=? WHERE id=?')
      .run(json(stored), value.updatedAt, value.id);
    workbenchEvents.publish('notification.updated', stored, value.id);
    return this.withVisibility(stored);
  }
  update(id: string, input: unknown, owner: FeedbackOwner) {
    const patch = optionsSchema
      .omit({ dedupeKey: true })
      .extend({
        title: z.string().min(1).max(1000).optional(),
        level: z.enum(['info', 'success', 'warn', 'error']).optional(),
      })
      .parse(input);
    const value = this.get(id, owner);
    const { actions, target, ...fields } = patch;
    Object.assign(
      value,
      Object.fromEntries(Object.entries(fields).filter(([, field]) => field !== undefined)),
    );
    if (actions !== undefined || target !== undefined) {
      value.actions = [
        ...(actions ?? []),
        ...(target ? [{ type: 'plugin-url', path: target.pluginPath }] : []),
      ];
      assert(value.actions.length <= 4, 'invalid_actions', '通知最多支持 4 个操作按钮');
    }
    value.updatedAt = now();
    return this.save(value);
  }
  read(id: string, read: boolean, owner: FeedbackOwner) {
    const value = this.get(id, owner);
    value.readAt = z.boolean().parse(read) ? now() : null;
    return this.save(value);
  }
  bindAction(id: string, handler: (actionId: string) => void | Promise<void>) {
    this.handlers.set(id, handler);
    if (this.handlers.size > 1000) {
      const retained = new Set(
        (this.storage.db.prepare('SELECT id FROM notifications').all() as { id: string }[]).map(
          (row) => row.id,
        ),
      );
      for (const key of this.handlers.keys()) {
        if (!retained.has(key)) {
          this.handlers.delete(key);
        }
      }
    }
  }
  async invoke(id: string, actionId: string) {
    const value = this.get(id);
    assert(
      value.actions.some((a) => a.type === 'callback' && a.id === actionId),
      'invalid_action',
      '通知操作已失效',
      409,
    );
    const handler = this.handlers.get(id);
    assert(handler, 'action_unavailable', '通知操作所属页面或插件已关闭', 409);
    await handler(actionId);
    return { invoked: true };
  }
  releaseOwner(ownerId: string) {
    for (const value of this.list()) {
      if (value.ownerId === ownerId) {
        this.handlers.delete(value.id);
      }
    }
  }
  visibility(viewer: string, ids: string[]) {
    z.array(z.string()).max(1000).parse(ids);
    const visible = new Set(ids);
    if (visible.size) {
      this.viewers.set(viewer, { ids: visible, time: Date.now() });
    } else {
      this.viewers.delete(viewer);
    }
    for (const [id, value] of this.viewers) {
      if (Date.now() - value.time >= 20000) {
        this.viewers.delete(id);
      }
    }
    for (const id of visible) {
      const row = this.storage.db
        .prepare('SELECT value_json FROM notifications WHERE id=?')
        .get(id) as { value_json: string } | undefined;
      if (!row) {
        continue;
      }
      const value = JSON.parse(row.value_json) as NotificationState;
      if (!value.seenAt) {
        value.seenAt = now();
        this.save(value);
      }
    }
    return { visible: ids };
  }
  list() {
    return (
      this.storage.db
        .prepare('SELECT value_json FROM notifications ORDER BY updated_at DESC,id')
        .all() as { value_json: string }[]
    ).map((r) => this.withVisibility(JSON.parse(r.value_json)));
  }
  change(ids: string[], remove = false) {
    z.array(z.string()).max(1000).parse(ids);
    this.storage.db.transaction(() => {
      for (const id of ids) {
        if (remove) {
          this.handlers.delete(id);
          this.storage.db.prepare('DELETE FROM notifications WHERE id=?').run(id);
        } else {
          const row = this.storage.db
            .prepare('SELECT value_json FROM notifications WHERE id=?')
            .get(id) as { value_json: string } | undefined;
          if (row) {
            const v = JSON.parse(row.value_json);
            v.readAt = now();
            this.storage.db
              .prepare('UPDATE notifications SET value_json=? WHERE id=?')
              .run(json(v), id);
          }
        }
      }
    })();
    workbenchEvents.publish('notification.updated', { ids, deleted: remove });
  }
}
const services = new WeakMap<WorkbenchStorage, NotificationService>();
export function getNotifications(storage = getStorage()) {
  let service = services.get(storage);
  if (!service) {
    service = new NotificationService(storage);
    services.set(storage, service);
  }
  return service;
}
export function createNotificationLogger(owner: FeedbackOwner) {
  const client = createFeedbackClient((async (path, input) => {
    const service = getNotifications();
    const body = (input ?? {}) as Record<string, unknown>;
    if (path === '/notifications/publish') {
      const value = service.publish(
        owner.source,
        owner.pluginId,
        body.level as string,
        body.title as string,
        body.options,
        { tabId: owner.tabId, ownerId: owner.ownerId, executionId: owner.executionId },
      );
      service.bindAction(value.id, (actionId) => client.dispatchAction({ id: value.id, actionId }));
      return value;
    }
    const match = path.match(/^\/notifications\/([^/]+)(?:\/(update|read|close))?$/);
    assert(match, 'invalid_action', '未知通知操作');
    const [, id, action] = match;
    service.get(id, owner);
    if (action === 'update') {
      return service.update(id, body, owner);
    }
    if (action === 'read') {
      return service.read(id, body.read as boolean, owner);
    }
    if (action === 'close') {
      service.change([id], true);
      return;
    }
    return service.get(id, owner);
  }) as FeedbackRequest);
  return client.logger;
}
