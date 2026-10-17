import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getStorage, json, now, assert, type WorkbenchStorage } from './storage.ts';
import { workbenchEvents } from './events.ts';
export type { NotificationLogger, NotificationOptions } from '../types/notifications.d.ts';
const optionsSchema = z
  .object({
    message: z.string().max(16000).optional(),
    dedupeKey: z.string().max(200).optional(),
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
    identity: { tabId?: string; executionId?: string } = {},
  ) {
    z.enum(['info', 'success', 'warn', 'error']).parse(level);
    z.string().min(1).max(1000).parse(title);
    const opts = optionsSchema.parse(options);
    const sourceKey = `${source}:${pluginId ?? 'core'}`;
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
    const value = {
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
      actions: opts.target ? [{ type: 'plugin-url', path: opts.target.pluginPath }] : [],
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
    return value;
  }
  list() {
    return (
      this.storage.db
        .prepare('SELECT value_json FROM notifications ORDER BY updated_at DESC,id')
        .all() as { value_json: string }[]
    ).map((r) => JSON.parse(r.value_json));
  }
  change(ids: string[], remove = false) {
    z.array(z.string()).max(1000).parse(ids);
    this.storage.db.transaction(() => {
      for (const id of ids) {
        if (remove) {
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
let service: NotificationService | undefined;
export function getNotifications() {
  return (service ??= new NotificationService(getStorage()));
}
