import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { assert, json, now, WorkbenchError, type WorkbenchStorage } from './storage.ts';
import { workbenchEvents, type WorkbenchEvents } from './events.ts';

export const identifier = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^/\\\x00-\x1f]+$/);
const positive = z.number().finite().positive().max(100000);
const ratio = z.number().gt(0).lt(1);
const locator = z
  .object({
    installationId: identifier,
    pluginId: identifier,
    path: z.string().max(8192),
    search: z.string().max(8192),
    hash: z.string().max(8192),
  })
  .strict();
export const tabSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: identifier,
      kind: z.literal('plugin'),
      pluginId: identifier,
      originalPluginTitle: z.string().max(1000),
      originalPageTitle: z.string().max(1000),
      customTitle: z.string().max(1000).nullable(),
      url: z.string().max(16384),
      locator,
      pinned: z.boolean(),
      keepAlive: z.boolean(),
      createdAt: z.string(),
      lastFocusedAt: z.string(),
      navigation: z.object({
        entries: z.array(z.json()).max(500),
        index: z.number().int().min(-1),
      }),
      stateSnapshotId: identifier.nullable(),
    })
    .strict(),
  z
    .object({
      id: identifier,
      kind: z.literal('internal'),
      page: z.enum([
        'welcome',
        'settings',
        'keybindings',
        'search',
        'bookmarks',
        'history',
        'plugins',
      ]),
      pinned: z.boolean(),
      customTitle: z.string().max(1000).nullable(),
      createdAt: z.string(),
      lastFocusedAt: z.string(),
    })
    .strict(),
]);
export type LayoutNode =
  | {
      kind: 'split';
      id: string;
      axis: 'horizontal' | 'vertical';
      ratio: number;
      first: LayoutNode;
      second: LayoutNode;
    }
  | {
      kind: 'group';
      id: string;
      tabIds: string[];
      activeTabId: string | null;
      tabBarPosition: 'top' | 'bottom' | 'left' | 'right';
    };
const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z
      .object({
        kind: z.literal('group'),
        id: identifier,
        tabIds: z.array(identifier).max(500),
        activeTabId: identifier.nullable(),
        tabBarPosition: z.enum(['top', 'bottom', 'left', 'right']),
      })
      .strict(),
    z
      .object({
        kind: z.literal('split'),
        id: identifier,
        axis: z.enum(['horizontal', 'vertical']),
        ratio,
        first: nodeSchema,
        second: nodeSchema,
      })
      .strict(),
  ]),
);
export const snapshotSchema = z
  .object({
    layout: z
      .object({
        schemaVersion: z.literal(1),
        mainSidebar: z
          .object({
            side: z.enum(['left', 'right']),
            visible: z.boolean(),
            size: positive,
            view: z.enum(['search', 'pages', 'bookmarks', 'history', 'plugins']),
            openPagesRatio: ratio,
          })
          .strict(),
        auxiliarySidebar: z.object({ visible: z.boolean(), size: positive }).strict(),
        panel: z
          .object({
            dock: z.enum(['bottom', 'left', 'right']),
            align: z.enum(['center', 'full']),
            visible: z.boolean(),
            width: positive,
            height: positive,
            activeView: z.enum(['output', 'terminal']),
            terminalListSize: positive,
          })
          .strict(),
        center: nodeSchema,
        focusedGroupId: identifier,
      })
      .strict(),
    tabs: z.array(tabSchema).max(500),
    focusedPluginTabId: identifier.nullable().optional(),
  })
  .strict();
export type WorkspaceSnapshot = z.infer<typeof snapshotSchema>;
export function defaultSnapshot(): WorkspaceSnapshot {
  const group = randomUUID();
  return {
    layout: {
      schemaVersion: 1,
      mainSidebar: { side: 'left', visible: true, size: 260, view: 'pages', openPagesRatio: 0.5 },
      auxiliarySidebar: { visible: true, size: 280 },
      panel: {
        dock: 'bottom',
        align: 'center',
        visible: false,
        width: 600,
        height: 260,
        activeView: 'output',
        terminalListSize: 180,
      },
      center: { kind: 'group', id: group, tabIds: [], activeTabId: null, tabBarPosition: 'top' },
      focusedGroupId: group,
    },
    tabs: [],
  };
}
function boundedTree(input: unknown, depth = 0, count = { n: 0 }) {
  assert(depth <= 20 && ++count.n <= 999, 'invalid_layout', '布局树超出深度或数量限制');
  if (input && typeof input === 'object' && 'kind' in input && input.kind === 'split') {
    boundedTree((input as Extract<LayoutNode, { kind: 'split' }>).first, depth + 1, count);
    boundedTree((input as Extract<LayoutNode, { kind: 'split' }>).second, depth + 1, count);
  }
}
export function validateSnapshot(input: unknown) {
  boundedTree((input as WorkspaceSnapshot)?.layout?.center);
  const snapshot = snapshotSchema.parse(input),
    ids = new Set<string>(),
    tabs = new Set<string>(),
    groups = new Set<string>();
  const visit = (node: LayoutNode) => {
    assert(!ids.has(node.id), 'invalid_layout', '分组或分割ID重复');
    ids.add(node.id);
    if (node.kind === 'split') {
      visit(node.first);
      visit(node.second);
      return;
    }
    groups.add(node.id);
    for (const id of node.tabIds) {
      assert(!tabs.has(id), 'invalid_layout', '标签属于多个组');
      tabs.add(id);
    }
    assert(
      node.activeTabId === null || node.tabIds.includes(node.activeTabId),
      'invalid_layout',
      '激活标签不在当前组',
    );
  };
  visit(snapshot.layout.center);
  assert(groups.has(snapshot.layout.focusedGroupId), 'invalid_layout', '聚焦组不存在');
  const all = snapshot.tabs.map((t) => t.id);
  assert(
    new Set(all).size === all.length && tabs.size === all.length && all.every((id) => tabs.has(id)),
    'invalid_layout',
    '标签与分组不一致',
  );
  assert(
    !snapshot.focusedPluginTabId ||
      snapshot.tabs.some((t) => t.id === snapshot.focusedPluginTabId && t.kind === 'plugin'),
    'invalid_layout',
    '插件焦点不合法',
  );
  for (const t of snapshot.tabs) {
    if (t.kind === 'plugin') {
      assert(
        t.locator.pluginId === t.pluginId && t.navigation.index < t.navigation.entries.length,
        'invalid_tab',
        '页面身份或导航索引无效',
      );
    }
  }
  return snapshot;
}
const preferenceSchema = z
  .object({
    theme: z.enum(['system', 'light-2026', 'dark-2026']).optional(),
    keybindings: z
      .array(
        z
          .object({
            commandId: identifier,
            platform: z.enum(['mac', 'windows', 'linux', 'all']),
            context: z
              .string()
              .max(200)
              .regex(/^[\w. !&|()-]*$/),
            keys: z.array(z.string().min(1).max(100)).max(4).nullable(),
          })
          .strict(),
      )
      .max(2000)
      .optional(),
    energy: z
      .object({ idleMinutes: z.number().min(1).max(1440), enabled: z.boolean() })
      .strict()
      .optional(),
  })
  .strict();
type Row = { id: string; snapshot_json: string; revision: number };
export class WorkspaceService {
  private leases = new Map<string, { owner: string; token: string; expiresAt: number }>();
  readonly storage: WorkbenchStorage;
  private events: WorkbenchEvents;
  private clock: () => number;
  constructor(
    storage: WorkbenchStorage,
    events: WorkbenchEvents = workbenchEvents,
    clock = Date.now,
  ) {
    this.storage = storage;
    this.events = events;
    this.clock = clock;
  }
  get(id: string) {
    identifier.parse(id);
    const row = this.storage.db.prepare('SELECT * FROM workspaces WHERE id=?').get(id) as
      | Row
      | undefined;
    assert(row, 'not_found', '工作区不存在', 404);
    return {
      workspaceId: id,
      revision: row.revision,
      snapshot: validateSnapshot(JSON.parse(row.snapshot_json)),
    };
  }
  lease(id: string, owner: string, action: 'acquire' | 'renew' | 'release', token?: string) {
    identifier.parse(id);
    identifier.parse(owner);
    const current = this.leases.get(id),
      active = current && current.expiresAt > this.clock();
    if (action === 'release') {
      this.checkLease(id, owner, token);
      this.leases.delete(id);
      return { workspaceId: id, released: true };
    }
    if (action === 'renew') {
      this.checkLease(id, owner, token);
      assert(current, 'lease_conflict', '租约不存在', 409);
      current.expiresAt = this.clock() + 30000;
      return { workspaceId: id, ...current };
    }
    let clonedFrom: string | undefined;
    if (active && current.owner !== owner) {
      clonedFrom = id;
      id = randomUUID();
      const source = this.get(clonedFrom);
      this.create(id, source.snapshot);
    } else if (!this.storage.db.prepare('SELECT id FROM workspaces WHERE id=?').get(id)) {
      this.create(id, defaultSnapshot());
    }
    const lease = {
      owner,
      token: active && current?.owner === owner ? current.token : randomUUID(),
      expiresAt: this.clock() + 30000,
    };
    this.leases.set(id, lease);
    return { workspaceId: id, ...lease, clonedFrom };
  }
  private create(id: string, snapshot: WorkspaceSnapshot) {
    this.storage.db
      .prepare('INSERT INTO workspaces VALUES (?,?,?,0)')
      .run(id, 'local', json(snapshot));
  }
  checkLease(id: string, owner: string, token?: string) {
    const lease = this.leases.get(id);
    assert(
      lease && lease.owner === owner && lease.token === token && lease.expiresAt > this.clock(),
      'lease_conflict',
      '工作区写租约无效',
      409,
    );
  }
  private cas(current: { revision: number }, base: number) {
    if (current.revision !== base) {
      throw new WorkbenchError('revision_conflict', '数据已更新', 409, current);
    }
  }
  private write(id: string, snapshot: WorkspaceSnapshot, revision: number) {
    this.storage.db
      .prepare('UPDATE workspaces SET snapshot_json=?,revision=? WHERE id=?')
      .run(json(snapshot), revision, id);
    return { workspaceId: id, snapshot, revision };
  }
  save(
    id: string,
    input: unknown,
    baseRevision: number,
    owner: string,
    lease: string,
    operationId: string,
  ) {
    this.checkLease(id, owner, lease);
    identifier.parse(operationId);
    const snapshot = validateSnapshot(input);
    const result = this.storage.receipt(
      `workspace:${id}:${operationId}`,
      json({ snapshot, baseRevision }),
      () => {
        const current = this.get(id);
        this.cas(current, baseRevision);
        return this.write(id, snapshot, baseRevision + 1);
      },
    );
    this.events.publish('workspace.changed', result, id, result.revision);
    return result;
  }
  closeTabs(
    id: string,
    tabIds: string[],
    baseRevision: number,
    owner: string,
    lease: string,
    operationId: string,
  ) {
    this.checkLease(id, owner, lease);
    z.array(identifier).max(500).parse(tabIds);
    identifier.parse(operationId);
    const result = this.storage.receipt(
      `close:${id}:${operationId}`,
      json({ tabIds, baseRevision }),
      () => {
        const current = this.get(id);
        this.cas(current, baseRevision);
        const selected = new Set(tabIds);
        assert(
          tabIds.every((t) => current.snapshot.tabs.some((tab) => tab.id === t)),
          'not_found',
          '关闭目标不存在',
          404,
        );
        const closeIds: string[] = [];
        const remove = (node: LayoutNode) => {
          if (node.kind === 'split') {
            remove(node.first);
            remove(node.second);
          } else {
            node.tabIds = node.tabIds.filter((t) => !selected.has(t));
            if (node.activeTabId && selected.has(node.activeTabId)) {
              node.activeTabId = node.tabIds[0] ?? null;
            }
          }
        };
        for (const tab of current.snapshot.tabs) {
          if (selected.has(tab.id) && tab.kind === 'plugin') {
            const closeId = randomUUID();
            closeIds.push(closeId);
            this.storage.db
              .prepare('INSERT INTO closed_tabs VALUES (?,?,?,?,?,?,?,?,?)')
              .run(
                closeId,
                operationId,
                operationId,
                'local',
                id,
                tab.pluginId,
                now(),
                null,
                json(tab),
              );
          }
        }
        remove(current.snapshot.layout.center);
        current.snapshot.tabs = current.snapshot.tabs.filter((t) => !selected.has(t.id));
        if (
          current.snapshot.focusedPluginTabId &&
          selected.has(current.snapshot.focusedPluginTabId)
        ) {
          current.snapshot.focusedPluginTabId = null;
        }
        return {
          ...this.write(id, current.snapshot, baseRevision + 1),
          closeIds,
          batchId: operationId,
        };
      },
    );
    this.events.publish('workspace.changed', result, id, result.revision);
    this.events.publish('history.changed', { closeIds: result.closeIds });
    return result;
  }
  history() {
    return (
      this.storage.db.prepare('SELECT * FROM closed_tabs ORDER BY closed_at DESC,id').all() as {
        id: string;
        value_json: string;
        closed_at: string;
        restored_at: string | null;
        batch_id: string;
      }[]
    ).map((r) => ({
      closeId: r.id,
      closedAt: r.closed_at,
      restoredAt: r.restored_at,
      batchId: r.batch_id,
      tab: JSON.parse(r.value_json),
    }));
  }
  deleteHistory(ids: string[]) {
    z.array(identifier).max(10000).parse(ids);
    this.storage.db.transaction(() => {
      for (const id of ids) {
        this.storage.db.prepare('DELETE FROM closed_tabs WHERE id=?').run(id);
      }
    })();
    this.events.publish('history.changed', { deleted: ids });
  }
  restore(
    id: string,
    closeIds: string[],
    groupId: string,
    baseRevision: number,
    owner: string,
    lease: string,
    operationId: string,
  ) {
    this.checkLease(id, owner, lease);
    z.array(identifier).min(1).max(500).parse(closeIds);
    identifier.parse(operationId);
    const result = this.storage.receipt(
      `restore:${id}:${operationId}`,
      json({ closeIds, groupId, baseRevision }),
      () => {
        const current = this.get(id);
        this.cas(current, baseRevision);
        let target: Extract<LayoutNode, { kind: 'group' }> | undefined;
        const find = (n: LayoutNode) => {
          if (n.kind === 'group') {
            if (n.id === groupId) {
              target = n;
            }
          } else {
            find(n.first);
            find(n.second);
          }
        };
        find(current.snapshot.layout.center);
        assert(target, 'not_found', '恢复目标组不存在', 404);
        for (const closeId of new Set(closeIds)) {
          const row = this.storage.db
            .prepare('SELECT value_json FROM closed_tabs WHERE id=?')
            .get(closeId) as { value_json: string } | undefined;
          assert(row, 'not_found', '历史记录不存在', 404);
          const tab = tabSchema.parse(JSON.parse(row.value_json));
          if (current.snapshot.tabs.some((t) => t.id === tab.id)) {
            tab.id = randomUUID();
          }
          current.snapshot.tabs.push(tab);
          target.tabIds.push(tab.id);
          target.activeTabId = tab.id;
          this.storage.db
            .prepare('UPDATE closed_tabs SET restored_at=? WHERE id=?')
            .run(now(), closeId);
        }
        validateSnapshot(current.snapshot);
        return this.write(id, current.snapshot, baseRevision + 1);
      },
    );
    this.events.publish('workspace.changed', result, id, result.revision);
    this.events.publish('history.changed', { restored: closeIds });
    return result;
  }
  preferences() {
    const row = this.storage.db
      .prepare("SELECT * FROM preferences WHERE profile_id='local'")
      .get() as { value_json: string; revision: number } | undefined;
    return { values: row ? JSON.parse(row.value_json) : {}, revision: row?.revision ?? 0 };
  }
  setPreferences(input: unknown, baseRevision: number, reset: string[] = []) {
    const values = preferenceSchema.parse(input);
    assert(
      reset.every((k) => ['theme', 'keybindings', 'energy'].includes(k)),
      'invalid_preferences',
      '未知偏好字段',
    );
    const result = this.storage.db.transaction(() => {
      const current = this.preferences();
      this.cas(current, baseRevision);
      const next = Object.fromEntries(
        Object.entries({ ...current.values, ...values }).filter(([key]) => !reset.includes(key)),
      );
      this.storage.db
        .prepare(
          "INSERT INTO preferences VALUES ('local',?,?) ON CONFLICT(profile_id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision",
        )
        .run(json(next), baseRevision + 1);
      return this.preferences();
    })();
    this.events.publish('preferences.changed', result, 'local', result.revision);
    return result;
  }
  bookmarks() {
    return (
      this.storage.db.prepare('SELECT * FROM bookmarks ORDER BY id').all() as {
        id: string;
        value_json: string;
        revision: number;
      }[]
    ).map((r) => ({ id: r.id, ...JSON.parse(r.value_json), revision: r.revision }));
  }
  bookmark(input: unknown, id: string = randomUUID(), baseRevision = 0, remove = false) {
    identifier.parse(id);
    const schema = z
      .object({
        pluginId: identifier,
        url: z.string().max(16384),
        locator,
        originalTitle: z.string().max(1000),
        customTitle: z.string().max(1000).nullable().optional(),
        previewId: identifier.nullable().optional(),
      })
      .strict();
    const result = this.storage.db.transaction(() => {
      const row = this.storage.db.prepare('SELECT revision FROM bookmarks WHERE id=?').get(id) as
        | { revision: number }
        | undefined;
      this.cas({ revision: row?.revision ?? 0 }, baseRevision);
      if (remove) {
        assert(row, 'not_found', '收藏不存在', 404);
        this.storage.db.prepare('DELETE FROM bookmarks WHERE id=?').run(id);
        return { id, deleted: true, revision: baseRevision + 1 };
      }
      const value = schema.parse(input);
      assert(value.pluginId === value.locator.pluginId, 'invalid_bookmark', '收藏定位不一致');
      this.storage.db
        .prepare(
          'INSERT INTO bookmarks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json,revision=excluded.revision',
        )
        .run(id, json(value), baseRevision + 1);
      return { id, ...value, revision: baseRevision + 1 };
    })();
    this.events.publish('bookmarks.changed', result, id, result.revision);
    return result;
  }
}
