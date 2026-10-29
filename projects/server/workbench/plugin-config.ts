import { z } from 'zod';
import { assert, getStorage, json, now, WorkbenchError, type WorkbenchStorage } from './storage.ts';
import { workbenchEvents, type WorkbenchEvents } from './events.ts';
import type { ConfigDefinition, ConfigSnapshot } from '../types/plugin-config.d.ts';

const keySchema = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (v) =>
      !/[\x00-\x1f\x7f]/.test(v) &&
      !v.split('.').some((p) => ['__proto__', 'prototype', 'constructor'].includes(p)),
  );
const valueSchema = z.string().refine((v) => Buffer.byteLength(v) <= 65536, '值不能超过64KiB');
const definitionSchema = z
  .object({
    id: z.string().min(1).max(200),
    schemaVersion: z.string().min(1).max(100),
    items: z
      .array(
        z
          .object({
            id: keySchema,
            key: keySchema,
            label: z.string().min(1).max(500),
            description: z.string().max(4000).optional(),
            control: z.enum([
              'text',
              'textarea',
              'number',
              'switch',
              'select',
              'color',
              'readonly',
            ]),
            defaultValue: valueSchema.optional(),
            validationPolicy: z.enum(['declarative', 'backend-required']).optional(),
            rules: z
              .object({
                codec: z.enum(['string', 'integer', 'number', 'boolean']).optional(),
                min: z.number().finite().optional(),
                max: z.number().finite().optional(),
                maxLength: z.number().int().nonnegative().max(65536).optional(),
                options: z.array(valueSchema).max(200).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
type Validator = (values: Record<string, string>) => Promise<Record<string, string>>;
export class PluginConfigService {
  private validators = new Map<string, Validator>();
  private confirmedDefinitions = new Set<string>();
  definitionVerified(pluginId: string, id: string) {
    return this.confirmedDefinitions.has(JSON.stringify([pluginId, id]));
  }
  private storage: WorkbenchStorage;
  private events: WorkbenchEvents;
  constructor(storage: WorkbenchStorage, events: WorkbenchEvents = workbenchEvents) {
    this.storage = storage;
    this.events = events;
  }
  bindValidator(pluginId: string, validator: Validator) {
    this.validators.set(pluginId, validator);
    return () => {
      if (this.validators.get(pluginId) === validator) {
        this.validators.delete(pluginId);
      }
    };
  }
  snapshot(pluginId: string): ConfigSnapshot {
    const db = this.storage.config;
    const values = Object.fromEntries(
      (
        db.prepare('SELECT key,value FROM config_values WHERE plugin_id=?').all(pluginId) as {
          key: string;
          value: string;
        }[]
      ).map((r) => [r.key, r.value]),
    );
    const definitions = (
      db
        .prepare(
          'SELECT descriptor_json FROM config_definitions WHERE plugin_id=? ORDER BY definition_id',
        )
        .all(pluginId) as { descriptor_json: string }[]
    ).map((r) => JSON.parse(r.descriptor_json) as ConfigDefinition);
    const defaults = definitions.flatMap((d) =>
      d.items.filter((i) => i.defaultValue !== undefined).map((i) => [i.key, i.defaultValue ?? '']),
    );
    const schemaRevision = (
      db
        .prepare(
          'SELECT COALESCE(MAX(revision),0) AS revision FROM config_definitions WHERE plugin_id=?',
        )
        .get(pluginId) as { revision: number }
    ).revision;
    return {
      values,
      effectiveValues: { ...Object.fromEntries(defaults), ...values },
      definitions,
      definitionSources: Object.fromEntries(
        definitions.map((def) => [
          def.id,
          this.definitionVerified(pluginId, def.id) ? 'backend' : 'legacy-unverified',
        ]),
      ),
      schemaRevision,
      revision:
        (
          db.prepare('SELECT revision FROM config_revisions WHERE plugin_id=?').get(pluginId) as
            | { revision: number }
            | undefined
        )?.revision ?? 0,
    };
  }
  get(pluginId: string, key: string) {
    keySchema.parse(key);
    const values = this.snapshot(pluginId).effectiveValues;
    return Object.hasOwn(values, key) ? values[key] : undefined;
  }
  define(pluginId: string, input: unknown, baseRevision: number) {
    const definition = definitionSchema.parse(input);
    const before = this.snapshot(pluginId);
    this.cas(before, baseRevision);
    if (json(before.definitions.find((d) => d.id === definition.id)) === json(definition)) {
      this.confirmedDefinitions.add(JSON.stringify([pluginId, definition.id]));
      return before;
    }
    const db = this.storage.config;
    const result = db.transaction(() => {
      const current = this.snapshot(pluginId);
      this.cas(current, baseRevision);
      const byKey = new Map(
        current.definitions
          .filter((d) => d.id !== definition.id)
          .flatMap((d) => d.items.map((i) => [i.key, i] as const)),
      );
      const keys = new Set<string>();
      for (const item of definition.items) {
        assert(!keys.has(item.key), 'definition_conflict', '配置定义包含重复键', 409);
        keys.add(item.key);
        const existing = byKey.get(item.key);
        assert(
          !existing ||
            json([
              existing.defaultValue,
              existing.rules,
              existing.validationPolicy,
              existing.control === 'readonly',
            ]) ===
              json([
                item.defaultValue,
                item.rules,
                item.validationPolicy,
                item.control === 'readonly',
              ]),
          'definition_conflict',
          '同一个键的定义不兼容',
          409,
        );
        if (item.defaultValue !== undefined) {
          this.validate(item.defaultValue, item);
        }
      }
      const revision = current.revision + 1;
      db.prepare(
        'INSERT INTO config_definitions VALUES (?,?,?,?,?) ON CONFLICT(plugin_id,definition_id) DO UPDATE SET schema_version=excluded.schema_version,descriptor_json=excluded.descriptor_json,revision=excluded.revision',
      ).run(pluginId, definition.id, definition.schemaVersion, json(definition), revision);
      this.revision(pluginId, revision);
      return this.snapshot(pluginId);
    })();
    this.confirmedDefinitions.add(JSON.stringify([pluginId, definition.id]));
    this.changed(pluginId, result, [
      ...new Set([
        ...(before.definitions.find((d) => d.id === definition.id)?.items.map((i) => i.key) ?? []),
        ...definition.items.map((i) => i.key),
      ]),
    ]);
    return result;
  }
  private cas(current: ConfigSnapshot, baseRevision: number) {
    if (baseRevision !== current.revision) {
      throw new WorkbenchError('revision_conflict', '配置已被其他调用更新', 409, current);
    }
  }
  private revision(pluginId: string, revision: number) {
    this.storage.config
      .prepare(
        'INSERT INTO config_revisions VALUES (?,?) ON CONFLICT(plugin_id) DO UPDATE SET revision=excluded.revision',
      )
      .run(pluginId, revision);
  }
  private validate(value: string, item: ConfigDefinition['items'][number]) {
    const r = item.rules;
    if (!r) {
      return;
    }
    assert(
      r.maxLength === undefined || value.length <= r.maxLength,
      'validation_failed',
      `${item.key} 长度超限`,
    );
    assert(
      !r.options || r.options.includes(value),
      'validation_failed',
      `${item.key} 不在允许选项中`,
    );
    if (r.codec === 'boolean') {
      assert(
        value === 'true' || value === 'false',
        'validation_failed',
        `${item.key} 必须是布尔字符串`,
      );
    }
    if (r.codec === 'integer' || r.codec === 'number') {
      const number = Number(value);
      assert(
        value.trim() === value &&
          value !== '' &&
          Number.isFinite(number) &&
          (r.codec !== 'integer' || /^[+-]?\d+$/.test(value)),
        'validation_failed',
        `${item.key} 必须是有效数字字符串`,
      );
      assert(
        (r.min === undefined || number >= r.min) && (r.max === undefined || number <= r.max),
        'validation_failed',
        `${item.key} 超出范围`,
      );
    }
  }
  async update(
    pluginId: string,
    input: unknown,
    options: {
      baseRevision?: number;
      schemaRevision?: number;
      reset?: string[];
      originRequestId?: string;
      verifiedDefinitions?: boolean;
    } = {},
  ) {
    let values = z.record(keySchema, valueSchema).parse(input);
    const reset = z
      .array(keySchema)
      .max(2000)
      .parse(options.reset ?? []);
    const before = this.snapshot(pluginId),
      base = options.baseRevision ?? before.revision;
    this.cas(before, base);
    assert(
      options.schemaRevision === undefined || options.schemaRevision === before.schemaRevision,
      'schema_conflict',
      '配置定义已变化',
      409,
    );
    const items = new Map(
      before.definitions.flatMap((d) => d.items.map((i) => [i.key, i] as const)),
    );
    const keys = [...new Set([...Object.keys(values), ...reset])];
    assert(keys.length <= 2000, 'quota_exceeded', '配置键数量超限');
    let backend = false;
    for (const key of keys) {
      const item = items.get(key);
      if (options.verifiedDefinitions && item) {
        const definitions = before.definitions.filter((def) =>
          def.items.some((i) => i.key === key),
        );
        assert(
          definitions.every((def) => this.definitionVerified(pluginId, def.id)),
          'legacy_definition',
          '旧配置定义需要插件后端确认后编辑',
          409,
        );
      }
      if (!item) {
        continue;
      }
      assert(item.control !== 'readonly', 'readonly', '配置为只读', 403);
      assert(
        item.validationPolicy !== 'page-required',
        'page_validation_required',
        '旧页面校验定义需由插件后端重新声明后编辑',
        409,
      );
      backend ||= item.validationPolicy === 'backend-required';
    }
    if (backend || this.validators.has(pluginId)) {
      const validator = this.validators.get(pluginId);
      assert(validator, 'backend_unavailable', '插件配置校验宿主不可用', 409);
      const proposed = { ...values };
      for (const key of reset) {
        const v = items.get(key)?.defaultValue;
        if (v !== undefined) {
          proposed[key] = v;
        }
      }
      const normalized = z.record(keySchema, valueSchema).parse(await validator(proposed));
      assert(
        Object.keys(normalized).length === Object.keys(proposed).length &&
          Object.keys(normalized).every((k) => k in proposed),
        'validation_failed',
        '校验器改变了键集合',
      );
      values = Object.fromEntries(Object.keys(values).map((k) => [k, normalized[k]]));
    }
    for (const [key, value] of Object.entries(values)) {
      const item = items.get(key);
      if (item) {
        this.validate(value, item);
      }
    }
    const result = this.storage.config.transaction(() => {
      const current = this.snapshot(pluginId);
      this.cas(current, base);
      assert(
        current.schemaRevision === before.schemaRevision,
        'schema_conflict',
        '校验期间定义已变化',
        409,
      );
      const count = new Set([...Object.keys(current.values), ...Object.keys(values)]);
      reset.forEach((k) => count.delete(k));
      assert(count.size <= 2000, 'quota_exceeded', '每插件最多2000个配置键');
      const put = this.storage.config.prepare(
        'INSERT INTO config_values VALUES (?,?,?,?) ON CONFLICT(plugin_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',
      );
      for (const [key, value] of Object.entries(values)) {
        put.run(pluginId, key, value, now());
      }
      const del = this.storage.config.prepare(
        'DELETE FROM config_values WHERE plugin_id=? AND key=?',
      );
      for (const key of reset) {
        del.run(pluginId, key);
      }
      this.revision(pluginId, base + 1);
      return this.snapshot(pluginId);
    })();
    this.changed(pluginId, result, keys, options.originRequestId);
    return result;
  }
  private changed(
    pluginId: string,
    snapshot: ConfigSnapshot,
    changedKeys: string[],
    originRequestId?: string,
  ) {
    this.events.publish(
      'config.changed',
      {
        pluginId,
        changedKeys,
        effectiveValues: snapshot.effectiveValues,
        revision: snapshot.revision,
        schemaRevision: snapshot.schemaRevision,
        originRequestId,
      },
      pluginId,
      snapshot.revision,
    );
  }
}
let service: PluginConfigService | undefined;
export function getPluginConfig() {
  return (service ??= new PluginConfigService(getStorage()));
}
