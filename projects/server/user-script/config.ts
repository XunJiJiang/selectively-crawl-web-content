import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ENV_DIR } from '../common/paths.ts';
import { openDatabase, WorkbenchError } from '../workbench/storage.ts';
import { websiteOrigin, type UserScriptSnapshot } from '../../shared/userscript-config.ts';
import { snapshotSchema } from '../../shared/userscript-config-schema.ts';

export class UserScriptConfigDatabase {
  private db;
  private listeners = new Map<string, Set<(snapshot: UserScriptSnapshot) => void>>();
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    this.db = openDatabase(
      file,
      `CREATE TABLE IF NOT EXISTS website_configs (
      website TEXT PRIMARY KEY, updated_at TEXT NOT NULL, value_json TEXT NOT NULL
    );`,
    );
  }
  get(website: string): UserScriptSnapshot | null {
    const current = this.read(websiteOrigin(website));
    return current ? snapshotSchema.parse(current) : null;
  }
  private read(key: string): unknown {
    const row = this.db
      .prepare('SELECT value_json FROM website_configs WHERE website=?')
      .get(key) as { value_json: string } | undefined;
    return row ? JSON.parse(row.value_json) : null;
  }
  sync(input: unknown): UserScriptSnapshot {
    const parsed = snapshotSchema.safeParse(input);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data)) > 512 * 1024) {
      throw new WorkbenchError('invalid_site_config', '网站配置格式错误或超过 512 KiB', 400);
    }
    const next = parsed.data;
    let changed = false;
    const result = this.db.transaction(() => {
      const previous = this.get(next.website);
      // 日期相同时保留核心已有版本，所有客户端都以同一结果收敛。
      if (previous && previous.updatedAt >= next.updatedAt) {
        return previous;
      }
      this.db
        .prepare(
          'INSERT INTO website_configs VALUES (?,?,?) ON CONFLICT(website) DO UPDATE SET updated_at=excluded.updated_at,value_json=excluded.value_json',
        )
        .run(next.website, next.updatedAt, JSON.stringify(next));
      changed = true;
      return next;
    })();
    if (changed) {
      for (const listener of this.listeners.get(result.website) ?? []) {
        listener(result);
      }
    }
    return result;
  }
  subscribe(website: string, listener: (snapshot: UserScriptSnapshot) => void) {
    const key = websiteOrigin(website),
      listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) {
        this.listeners.delete(key);
      }
    };
  }
  async close() {
    if (this.file !== ':memory:') {
      const temporary = `${this.file}.backup-${randomUUID()}`;
      await this.db.backup(temporary);
      fs.renameSync(temporary, `${this.file}.backup`);
    }
    this.listeners.clear();
    this.db.close();
  }
}
let database: UserScriptConfigDatabase | undefined;
export function getUserScriptConfig() {
  return (database ??= new UserScriptConfigDatabase(
    path.resolve(ENV_DIR, process.env.SCWC_DATA_DIR || 'data', 'scwc/userscript-config.sqlite'),
  ));
}
export async function closeUserScriptConfig() {
  const current = database;
  database = undefined;
  await current?.close();
}
