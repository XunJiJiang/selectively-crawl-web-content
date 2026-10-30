import { z } from 'zod';
import { websiteOrigin } from './userscript-config.ts';

const text = z.string().max(16384);
const value = z.union([text, z.number().finite(), z.boolean(), z.null()]);
export const snapshotSchema = z
  .object({
    version: z.literal(1),
    website: z.string().refine((value) => {
      try {
        return websiteOrigin(value) === value;
      } catch {
        return false;
      }
    }),
    updatedAt: z.iso.datetime({ precision: 3 }),
    data: z
      .object({
        config: z
          .object({
            api: z.object({ host: text, port: text, token: text }).strict(),
            plugin: z.object({ refreshRule: text }).strict(),
            notify: z.object({ placement: z.enum(['tl', 'tr', 'tc', 'bl', 'br', 'bc']) }).strict(),
          })
          .strict(),
        items: z.array(z.object({ selector: text, label: text, prefix: text }).strict()).max(500),
        window: z
          .object({
            pos: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
            minimized: z.boolean(),
            selectionExpanded: z.boolean(),
          })
          .strict(),
        plugin: z.object({ expanded: z.boolean(), activeTab: text }).strict(),
        controls: z.array(z.object({ pluginId: text, channel: text, value }).strict()).max(1000),
      })
      .strict(),
  })
  .strict();

/** 仅供迁回 origin 时读取短期使用过的路径副本，不参与同步协议。 */
export const pathSnapshotSchema = snapshotSchema.extend({
  version: z.literal(2),
  website: z
    .string()
    .max(16384)
    .refine((value) => {
      try {
        return websiteOrigin(value) + new URL(value).pathname === value;
      } catch {
        return false;
      }
    }),
});
