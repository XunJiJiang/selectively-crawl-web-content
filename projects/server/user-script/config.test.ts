import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../common/environment.ts', () => ({}));
import { UserScriptConfigDatabase } from './config.ts';
import {
  defaultSiteData,
  websiteOrigin,
  type UserScriptSnapshot,
} from '../../shared/userscript-config.ts';

const databases: UserScriptConfigDatabase[] = [];
afterEach(async () => {
  for (const db of databases.splice(0)) {
    await db.close();
  }
});
function snapshot(
  website = 'https://one.example',
  updatedAt = '2026-10-30T10:00:00.000Z',
): UserScriptSnapshot {
  return { version: 1, website: websiteOrigin(website), updatedAt, data: defaultSiteData() };
}
describe('separate website configuration database', () => {
  it('reads and updates one origin row from every same-origin path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-origin-migration-'));
    try {
      const file = path.join(directory, 'userscript.sqlite');
      const legacy = snapshot();
      legacy.data.config.api.token = 'legacy-core';
      const old = new Database(file);
      old.exec(
        'CREATE TABLE website_configs (website TEXT PRIMARY KEY, updated_at TEXT NOT NULL, value_json TEXT NOT NULL)',
      );
      old
        .prepare('INSERT INTO website_configs VALUES (?,?,?)')
        .run(legacy.website, legacy.updatedAt, JSON.stringify(legacy));
      old.close();
      const db = new UserScriptConfigDatabase(file);
      databases.push(db);
      const first = db.sync(snapshot('https://one.example/first', '1970-01-01T00:00:00.000Z'));
      expect(first).toEqual(legacy);
      const updated = { ...first, updatedAt: '2026-10-31T10:00:00.000Z', data: defaultSiteData() };
      db.sync(updated);
      const second = db.sync(snapshot('https://one.example/second', '1970-01-01T00:00:00.000Z'));
      expect(second).toEqual(updated);
      const saved = new Database(file, { readonly: true });
      expect(
        (
          saved
            .prepare('SELECT value_json FROM website_configs WHERE website=?')
            .get(legacy.website) as { value_json: string }
        ).value_json,
      ).toBe(JSON.stringify(updated));
      expect(
        (saved.prepare('SELECT COUNT(*) AS count FROM website_configs').get() as { count: number })
          .count,
      ).toBe(1);
      saved.close();
      await db.close();
      databases.pop();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('shares origin data and notifications across paths and embedding contexts', () => {
    const db = new UserScriptConfigDatabase(':memory:');
    databases.push(db);
    const parent = snapshot('https://one.example/host');
    const child = snapshot('https://one.example/child');
    const notified = vi.fn();
    db.subscribe(child.website + '?frame=1', notified);
    db.sync(parent);
    expect(notified).toHaveBeenCalledOnce();
    child.data.window.pos.x = 600;
    child.updatedAt = '2026-10-31T10:00:00.000Z';
    db.sync(child);
    expect(notified).toHaveBeenCalledTimes(2);
    expect(db.get('https://one.example/child?direct=1#part')).toEqual(child);
    expect(db.get(parent.website)).toEqual(child);
    const direct = { ...child, updatedAt: '2026-10-31T12:00:00.000Z', data: defaultSiteData() };
    db.sync(direct);
    expect(notified).toHaveBeenLastCalledWith(direct);
    expect(db.get(child.website)).toEqual(direct);
    expect(db.get(parent.website)).toEqual(direct);
  });
  it('keeps websites isolated, latest dates authoritative, equal dates stable and notifications scoped', () => {
    const db = new UserScriptConfigDatabase(':memory:');
    databases.push(db);
    const a = vi.fn(),
      b = vi.fn(),
      off = db.subscribe('https://one.example', a);
    db.subscribe('https://two.example', b);
    const first = snapshot();
    db.sync(first);
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
    const stale = snapshot(undefined, '2026-10-29T10:00:00.000Z');
    stale.data.window.minimized = false;
    expect(db.sync(stale)).toEqual(first);
    const tie = snapshot();
    tie.data.items = [{ selector: '#tie', label: 'tie', prefix: '' }];
    expect(db.sync(tie)).toEqual(first);
    expect(a).toHaveBeenCalledOnce();
    db.sync(snapshot('https://two.example'));
    expect(b).toHaveBeenCalledOnce();
    const latest = snapshot(undefined, '2026-10-31T10:00:00.000Z');
    latest.data.controls = [{ pluginId: 'p', channel: 'c', value: 0 }];
    expect(db.sync(latest)).toEqual(latest);
    expect(a).toHaveBeenCalledTimes(2);
    off();
    db.sync(snapshot(undefined, '2026-11-01T10:00:00.000Z'));
    expect(a).toHaveBeenCalledTimes(2);
  });
  it('persists credentials, selections, controls and window state across a core restart', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-site-db-'));
    try {
      const file = path.join(directory, 'userscript.sqlite'),
        first = new UserScriptConfigDatabase(file);
      const value = snapshot();
      value.data.config.api.token = 'saved';
      value.data.window.pos = { x: 9, y: 10 };
      first.sync(value);
      await first.close();
      const reopened = new UserScriptConfigDatabase(file);
      expect(reopened.get(value.website)).toEqual(value);
      await reopened.close();
      expect((await fs.stat(file + '.backup')).size).toBeGreaterThan(0);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
  it('rejects invalid dates, non-website origins and invalid values without altering existing data', () => {
    const db = new UserScriptConfigDatabase(':memory:');
    databases.push(db);
    const original = snapshot();
    db.sync(original);
    expect(() => db.sync({ ...original, updatedAt: 'not-a-date' })).toThrow('配置格式');
    expect(() => db.sync({ ...original, website: 'file:///tmp' })).toThrow('配置格式');
    expect(() =>
      db.sync({
        ...original,
        data: { ...original.data, window: { ...original.data.window, pos: { x: NaN, y: 1 } } },
      }),
    ).toThrow('配置格式');
    expect(db.get(original.website)).toEqual(original);
  });
});
