import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import '../common/environment.ts';
import { ENV_DIR } from '../common/paths.ts';

export class WorkbenchError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
export function assert(
  condition: unknown,
  code: string,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) {
    throw new WorkbenchError(code, message, status);
  }
}
export const coreBootId = randomUUID();
export const now = () => new Date().toISOString();
export const json = (value: unknown) => JSON.stringify(value);

function open(file: string, ddl: string) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  let db: Database.Database | undefined;
  try {
    db = new Database(file);
    if (db.pragma('quick_check', { simple: true }) !== 'ok') {
      throw new Error('数据库完整性检查失败');
    }
  } catch {
    db?.close();
    const backupFile = `${file}.backup`;
    let backup: Database.Database | undefined;
    try {
      backup = new Database(backupFile, { readonly: true, fileMustExist: true });
      assert(
        backup.pragma('quick_check', { simple: true }) === 'ok',
        'database_unhealthy',
        '备份不健康',
        503,
      );
    } catch {
      throw new WorkbenchError(
        'database_unhealthy',
        `数据库和健康备份无法读取，请恢复备份：${file}`,
        503,
      );
    } finally {
      backup?.close();
    }
    const stamp = `.corrupt-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) {
        fs.renameSync(file + suffix, file + suffix + stamp);
      }
    }
    fs.copyFileSync(backupFile, file);
    db = new Database(file);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  const version = db.pragma('user_version', { simple: true }) as number;
  assert(version <= 1, 'schema_too_new', '数据库版本高于当前核心支持版本', 503);
  db.transaction(() => {
    db.exec(ddl);
    db.pragma('user_version = 1');
  })();
  return db;
}

const workbenchDDL = `
CREATE TABLE IF NOT EXISTS installation (id TEXT PRIMARY KEY, schema_version INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS preferences (profile_id TEXT PRIMARY KEY, value_json TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS bookmarks (id TEXT PRIMARY KEY, value_json TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS closed_tabs (id TEXT PRIMARY KEY, operation_id TEXT NOT NULL, batch_id TEXT NOT NULL, profile_id TEXT NOT NULL, workspace_id TEXT NOT NULL, plugin_id TEXT NOT NULL, closed_at TEXT NOT NULL, restored_at TEXT, value_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS closed_tabs_time ON closed_tabs(profile_id, closed_at DESC, id);
CREATE INDEX IF NOT EXISTS closed_tabs_plugin ON closed_tabs(plugin_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS closed_tabs_batch ON closed_tabs(batch_id);
CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, owner TEXT NOT NULL, plugin_id TEXT NOT NULL, checksum TEXT NOT NULL, metadata_json TEXT NOT NULL, payload BLOB NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS terminals (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), value_json TEXT NOT NULL, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS executions (id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL REFERENCES terminals(id), boot_id TEXT NOT NULL, status TEXT NOT NULL, command TEXT NOT NULL, request_key TEXT NOT NULL UNIQUE, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS output_records (stream_id TEXT NOT NULL, seq INTEGER NOT NULL, timestamp TEXT NOT NULL, value_json TEXT NOT NULL, PRIMARY KEY(stream_id, seq));
CREATE TABLE IF NOT EXISTS output_streams (id TEXT PRIMARY KEY, seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, source_key TEXT NOT NULL, dedupe_key TEXT, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS notifications_dedupe ON notifications(source_key, dedupe_key);
CREATE TABLE IF NOT EXISTS operation_receipts (request_key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL);
`;
const configDDL = `
CREATE TABLE IF NOT EXISTS config_values (plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL CHECK(typeof(value)='text'), updated_at TEXT NOT NULL, PRIMARY KEY(plugin_id,key));
CREATE TABLE IF NOT EXISTS config_revisions (plugin_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS config_definitions (plugin_id TEXT NOT NULL, definition_id TEXT NOT NULL, schema_version TEXT NOT NULL, descriptor_json TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(plugin_id,definition_id));
`;
export class WorkbenchStorage {
  readonly db: Database.Database;
  readonly config: Database.Database;
  readonly installationId: string;
  private files: string[];
  constructor(workbenchFile: string, configFile: string) {
    this.files = [workbenchFile, configFile];
    this.db = open(workbenchFile, workbenchDDL);
    this.config = open(configFile, configDDL);
    this.db
      .prepare('INSERT OR IGNORE INTO installation VALUES (?,1)')
      .run(
        (this.db.prepare('SELECT id FROM installation').get() as { id: string } | undefined)?.id ??
          randomUUID(),
      );
    this.installationId = (
      this.db.prepare('SELECT id FROM installation').get() as { id: string }
    ).id;
    this.db
      .prepare("UPDATE executions SET status='interrupted' WHERE status IN ('running','returned')")
      .run();
    for (const row of this.db.prepare('SELECT id,value_json FROM jobs').all() as {
      id: string;
      value_json: string;
    }[]) {
      const job = JSON.parse(row.value_json);
      if (['queued', 'running', 'cancelling'].includes(job.status)) {
        job.status = 'failed';
        job.error = '核心重启，操作已中断';
        job.revision++;
        this.db
          .prepare('UPDATE jobs SET value_json=?,updated_at=? WHERE id=?')
          .run(json(job), now(), row.id);
      }
    }
    this.cleanup();
  }
  receipt<T>(key: string, fingerprint: string, work: () => T): T {
    return this.db.transaction(() => {
      const previous = this.db
        .prepare('SELECT * FROM operation_receipts WHERE request_key=?')
        .get(key) as { fingerprint: string; result_json: string } | undefined;
      if (previous) {
        assert(
          previous.fingerprint === fingerprint,
          'idempotency_conflict',
          '幂等键已用于不同请求',
          409,
        );
        return JSON.parse(previous.result_json) as T;
      }
      const result = work();
      this.db
        .prepare('INSERT INTO operation_receipts VALUES (?,?,?,?)')
        .run(key, fingerprint, json(result), now());
      return result;
    })();
  }
  cleanup() {
    this.db.transaction(() => {
      this.db
        .prepare(
          "DELETE FROM closed_tabs WHERE closed_at < datetime('now','-90 days') OR id NOT IN (SELECT id FROM closed_tabs ORDER BY closed_at DESC LIMIT 10000)",
        )
        .run();
      this.db
        .prepare(
          "DELETE FROM notifications WHERE updated_at < datetime('now','-30 days') OR id NOT IN (SELECT id FROM notifications ORDER BY updated_at DESC LIMIT 1000)",
        )
        .run();
      this.db
        .prepare("DELETE FROM output_records WHERE timestamp < datetime('now','-7 days')")
        .run();
      this.db
        .prepare("DELETE FROM operation_receipts WHERE created_at < datetime('now','-7 days')")
        .run();
      this.db.prepare("DELETE FROM jobs WHERE updated_at < datetime('now','-7 days')").run();
    })();
  }
  async backup(directory: string) {
    fs.mkdirSync(directory, { recursive: true });
    const stamp = Date.now();
    await this.db.backup(path.join(directory, `workbench-${stamp}.sqlite`));
    await this.config.backup(path.join(directory, `plugin-config-${stamp}.sqlite`));
  }
  close() {
    this.db.close();
    this.config.close();
  }
  async checkpointBackup() {
    for (const [index, db] of [this.db, this.config].entries()) {
      const file = this.files[index];
      if (file === ':memory:') {
        continue;
      }
      assert(
        db.pragma('quick_check', { simple: true }) === 'ok',
        'database_unhealthy',
        '数据库损坏，保留最后健康备份',
        503,
      );
      const temporary = `${file}.backup-${randomUUID()}`;
      await db.backup(temporary);
      fs.renameSync(temporary, `${file}.backup`);
    }
  }
}
let storage: WorkbenchStorage | undefined;
export function getStorage() {
  const dataDirectory = path.resolve(ENV_DIR, process.env.SCWC_DATA_DIR || 'data');
  return (storage ??= new WorkbenchStorage(
    path.resolve(
      ENV_DIR,
      process.env.SCWC_WEB_WORKBENCH_DB || path.join(dataDirectory, 'web/workbench.sqlite'),
    ),
    path.join(dataDirectory, 'scwc/plugin-config.sqlite'),
  ));
}
export function closeStorage() {
  storage?.close();
  storage = undefined;
}
