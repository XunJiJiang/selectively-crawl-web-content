import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getStorage, assert, json, now, type WorkbenchStorage } from './storage.ts';
import { WorkspaceService } from './workspace.ts';
import { OperationService } from './operations.ts';
import { CommandService } from './command-service.ts';
import { NotificationService } from './notifications.ts';
export class WorkbenchRuntime {
  readonly workspace: WorkspaceService;
  readonly operations: OperationService;
  readonly commands: CommandService;
  readonly notifications: NotificationService;
  readonly storage: WorkbenchStorage;
  constructor(storage: WorkbenchStorage) {
    this.storage = storage;
    this.workspace = new WorkspaceService(storage);
    this.operations = new OperationService(storage);
    this.commands = new CommandService(storage, this.workspace);
    this.notifications = new NotificationService(storage);
  }
  snapshot(
    input: { kind: string; owner: string; pluginId: string; metadata?: unknown },
    payload: Buffer,
  ) {
    z.enum(['state', 'preview']).parse(input.kind);
    assert(
      payload.length <= (input.kind === 'state' ? 256 * 1024 : 2 * 1024 * 1024),
      'payload_too_large',
      '快照过大',
      413,
    );
    if (input.kind === 'state') {
      z.json().parse(JSON.parse(payload.toString()));
    } else {
      assert(
        payload.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        'invalid_image',
        '预览只接受PNG',
      );
    }
    const result = this.storage.db.transaction(() => {
      const budget = input.kind === 'state' ? 25 * 1024 * 1024 : 100 * 1024 * 1024;
      const size = (
        this.storage.db
          .prepare('SELECT COALESCE(SUM(length(payload)),0) AS bytes FROM snapshots WHERE kind=?')
          .get(input.kind) as { bytes: number }
      ).bytes;
      assert(
        size + payload.length <= budget,
        'quota_exceeded',
        '快照配额不足，请清理未使用快照',
        409,
      );
      const id = randomUUID(),
        checksum = createHash('sha256').update(payload).digest('hex');
      this.storage.db
        .prepare('INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?)')
        .run(
          id,
          input.kind,
          input.owner,
          input.pluginId,
          checksum,
          json(input.metadata ?? {}),
          payload,
          now(),
        );
      return { id, checksum, kind: input.kind, bytes: payload.length };
    })();
    return result;
  }
  getSnapshot(id: string, owner?: string, pluginId?: string) {
    const row = this.storage.db.prepare('SELECT * FROM snapshots WHERE id=?').get(id) as
      | {
          id: string;
          kind: string;
          owner: string;
          plugin_id: string;
          checksum: string;
          metadata_json: string;
          payload: Buffer;
        }
      | undefined;
    assert(row, 'not_found', '快照不存在', 404);
    assert(!owner || row.owner === owner, 'snapshot_owner', '快照不属于此页面', 403);
    assert(!pluginId || row.plugin_id === pluginId, 'snapshot_owner', '快照不属于此插件', 403);
    return row;
  }
  deleteSnapshot(id: string, owner?: string, pluginId?: string) {
    this.getSnapshot(id, owner, pluginId);
    const refs = [
      ...this.storage.db.prepare('SELECT snapshot_json AS value_json FROM workspaces').all(),
      ...this.storage.db.prepare('SELECT value_json FROM bookmarks').all(),
      ...this.storage.db.prepare('SELECT value_json FROM closed_tabs').all(),
    ] as { value_json: string }[];
    assert(
      !refs.some((r) => r.value_json.includes(`"${id}"`)),
      'snapshot_referenced',
      '快照仍被引用',
      409,
    );
    this.storage.db.prepare('DELETE FROM snapshots WHERE id=?').run(id);
    return { deleted: true };
  }
  async close() {
    await this.operations.close();
    this.commands.close();
    this.storage.cleanup();
    await this.storage.checkpointBackup();
  }
}
let runtime: WorkbenchRuntime | undefined;
export function getWorkbench() {
  return (runtime ??= new WorkbenchRuntime(getStorage()));
}
export async function closeWorkbench() {
  await runtime?.close();
  runtime = undefined;
}
