import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { websiteOrigin } from '../../shared/userscript-config.ts';
import type { SiteNotification, SiteNotificationBatch } from '../../shared/site-notifications.ts';

const optionsSchema = z
  .object({
    title: z.string().min(1).max(2000),
    description: z.string().max(16000).optional(),
    type: z.enum(['info', 'success', 'warn', 'error']).optional(),
    scope: z.enum(['internal', 'external']).default('internal'),
    placement: z.enum(['tl', 'tr', 'tc', 'bl', 'br', 'bc']).optional(),
    duration: z.number().finite().min(0).max(86400000).optional(),
    progress: z.union([z.number().min(0).max(100), z.null(), z.literal(false)]).optional(),
  })
  .strict();
/** Bounded, transient delivery log; cursors belong to individual receiving documents. */
export class SiteNotificationService {
  private boot = randomUUID();
  private sequence = 0;
  private events: { sequence: number; website: string; value: SiteNotification }[] = [];
  private listeners = new Map<string, Set<(value: SiteNotification) => void>>();
  publish(pluginId: string, site: string, input: unknown) {
    const website = websiteOrigin(site);
    const options = optionsSchema.parse(input);
    const value: SiteNotification = {
      ...options,
      id: randomUUID(),
      pluginId,
      createdAt: Date.now(),
    };
    this.events = [
      ...this.events.filter((event) => event.value.createdAt > Date.now() - 900000),
      { sequence: ++this.sequence, website, value },
    ].slice(-1000);
    for (const listener of this.listeners.get(website) ?? []) {
      listener(value);
    }
    return value.id;
  }
  read(site: string, cursor?: unknown): SiteNotificationBatch {
    const website = websiteOrigin(site);
    const prefix = `${this.boot}:`;
    const parsed =
      typeof cursor === 'string' && cursor.startsWith(prefix)
        ? Number(cursor.slice(prefix.length))
        : NaN;
    const sequence =
      Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= this.sequence
        ? parsed
        : this.sequence;
    return {
      cursor: `${prefix}${this.sequence}`,
      notifications: this.events
        .filter(
          (event) =>
            event.sequence > sequence &&
            event.website === website &&
            event.value.createdAt > Date.now() - 900000,
        )
        .map((event) => event.value),
    };
  }
  subscribe(site: string, listener: (value: SiteNotification) => void) {
    const website = websiteOrigin(site);
    const listeners = this.listeners.get(website) ?? new Set();
    listeners.add(listener);
    this.listeners.set(website, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(website);
      }
    };
  }
}
export const siteNotifications = new SiteNotificationService();
