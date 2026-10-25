import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WorkbenchStorage, coreBootId, assert } from './storage.ts';
import { PluginConfigService } from './plugin-config.ts';
import { WorkspaceService, defaultSnapshot, validateSnapshot } from './workspace.ts';
import { WorkbenchEvents } from './events.ts';
import { PageSessions } from './page-sessions.ts';
import { CommandService } from './command-service.ts';
import { registerCommand, unregisterPluginCommand, SYSTEM_SYMBOL } from '../utils/command.ts';
import { createLogger } from '../utils/log.ts';
import { NotificationService } from './notifications.ts';

const stores: WorkbenchStorage[] = [],
  directories: string[] = [],
  commands: CommandService[] = [];
function fixture() {
  const storage = new WorkbenchStorage(':memory:', ':memory:');
  stores.push(storage);
  return {
    storage,
    config: new PluginConfigService(storage, new WorkbenchEvents()),
    workspace: new WorkspaceService(storage),
  };
}
afterEach(async () => {
  commands.splice(0).forEach((c) => c.close());
  stores.splice(0).forEach((s) => s.close());
  await Promise.all(directories.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  unregisterPluginCommand('workbench-test');
});
const definition = {
  id: 'settings',
  schemaVersion: '1',
  items: [
    {
      id: 'limit',
      key: 'global.limit',
      label: '数量',
      control: 'number' as const,
      defaultValue: '10',
      rules: { codec: 'integer' as const, min: 1, max: 100 },
    },
  ],
};

describe('persistent plugin strings', () => {
  it('keeps plugin namespaces, literal dotted keys and empty strings; rejects nonstrings atomically', async () => {
    const { config } = fixture();
    await config.update('a', { a: '', 'a.b': '{"n":1}' });
    await config.update('b', { a: 'other' });
    expect(config.get('a', 'a')).toBe('');
    expect(config.get('a', 'a.b')).toBe('{"n":1}');
    expect(config.get('b', 'a')).toBe('other');
    await expect(config.update('a', { good: 'ok', bad: 12 })).rejects.toThrow();
    expect(config.get('a', 'good')).toBeUndefined();
    await expect(config.update('a', { 'constructor.x': 'no' })).rejects.toThrow();
    await expect(config.update('a', { big: 'x'.repeat(65537) })).rejects.toThrow();
    await config.update('a', {}, { reset: ['a.b'] });
    expect(config.get('a', 'a.b')).toBeUndefined();
  });
  it('CAS and reset apply one plugin revision, preserve defaults, and reject obsolete validation', async () => {
    const { config } = fixture();
    const registered = config.define('a', definition, 0);
    expect(registered.revision).toBe(1);
    expect(config.define('a', definition, 1).revision).toBe(1);
    await config.update('a', { 'global.limit': '20' }, { baseRevision: 1 });
    await expect(
      config.update('a', { 'global.limit': '30' }, { baseRevision: 1 }),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
    await config.update('a', {}, { reset: ['global.limit'], baseRevision: 2 });
    expect(config.snapshot('a').values).toEqual({});
    expect(config.get('a', 'global.limit')).toBe('10');
    await expect(config.update('a', { 'global.limit': 'NaN' })).rejects.toThrow();
    const backend = {
      ...definition,
      items: [{ ...definition.items[0], validationPolicy: 'backend-required' as const }],
    };
    config.define('a', backend, 3);
    await expect(config.update('a', { 'global.limit': '40' })).rejects.toMatchObject({
      code: 'backend_unavailable',
    });
    const ready = Promise.withResolvers<Record<string, string>>();
    config.bindValidator('a', () => ready.promise);
    const writing = config.update('a', { 'global.limit': '40' });
    config.define('a', { ...backend, schemaVersion: '2' }, 4);
    ready.resolve({ 'global.limit': '40' });
    await expect(writing).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(config.get('a', 'global.limit')).toBe('10');
  });
  it('persists across reopen and never stores strings in the workbench or Redis', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-config-'));
    directories.push(directory);
    const a = path.join(directory, 'workbench.sqlite'),
      b = path.join(directory, 'data/scwc/plugin-config.sqlite');
    const first = new WorkbenchStorage(a, b);
    const id = first.installationId;
    await new PluginConfigService(first).update('plugin', { key: 'value' });
    await first.backup(path.join(directory, 'backup'));
    first.close();
    const second = new WorkbenchStorage(a, b);
    stores.push(second);
    expect(second.installationId).toBe(id);
    expect(new PluginConfigService(second).get('plugin', 'key')).toBe('value');
    expect(
      second.db.prepare("SELECT name FROM sqlite_master WHERE name='config_values'").get(),
    ).toBeUndefined();
    expect(second.config.pragma('user_version', { simple: true })).toBe(1);
  });
  it('quarantines a corrupt primary and restores its last healthy backup', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-recovery-'));
    directories.push(directory);
    const a = path.join(directory, 'workbench.sqlite'),
      b = path.join(directory, 'config.sqlite');
    const storage = new WorkbenchStorage(a, b);
    await new PluginConfigService(storage).update('p', { key: 'saved' });
    await storage.checkpointBackup();
    storage.close();
    await fs.writeFile(b, 'corrupt sqlite');
    const recovered = new WorkbenchStorage(a, b);
    stores.push(recovered);
    expect(new PluginConfigService(recovered).get('p', 'key')).toBe('saved');
    expect(
      (await fs.readdir(directory)).some((name) => name.startsWith('config.sqlite.corrupt-')),
    ).toBe(true);
  });
});

describe('workspace leases and close history', () => {
  it('persists bookmark folders and bookmark membership without altering encoded URLs', () => {
    const { workspace } = fixture();
    workspace.setPreferences({ bookmarkFolders: [{ id: 'research', name: '资料' }] }, 0);
    const url = 'http://localhost/web/page/plugin/p/%E4%B8%AD%E6%96%87?q=a%26b#draft';
    const bookmark = workspace.bookmark({
      pluginId: 'p',
      url,
      locator: {
        installationId: 'i',
        pluginId: 'p',
        path: '/%E4%B8%AD%E6%96%87',
        search: '?q=a%26b',
        hash: '#draft',
      },
      originalTitle: 'P',
      folderId: 'research',
    });
    expect(workspace.preferences().values.bookmarkFolders).toEqual([
      { id: 'research', name: '资料' },
    ]);
    expect(workspace.bookmarks()[0]).toMatchObject({ id: bookmark.id, url, folderId: 'research' });
    workspace.bookmark(undefined, bookmark.id, bookmark.revision, true);
    expect(workspace.bookmarks()).toEqual([]);
  });
  it('clones a live duplicate window, renews only its owner, and expires leases', () => {
    const { storage } = fixture();
    let clock = 0;
    const w = new WorkspaceService(storage, new WorkbenchEvents(), () => clock);
    const a = w.lease('workspace', 'one', 'acquire');
    expect(a).toHaveProperty('token');
    const b = w.lease('workspace', 'two', 'acquire');
    expect(b.workspaceId).not.toBe('workspace');
    expect(b).toHaveProperty('clonedFrom', 'workspace');
    expect(() => w.checkLease('workspace', 'two', 'bad')).toThrow();
    clock = 30001;
    expect(() =>
      w.checkLease('workspace', 'one', 'token' in a ? (a.token ?? '') : undefined),
    ).toThrow();
  });
  it('closes only plugin tabs into one history, replays receipts and restores to a validated group', () => {
    const { workspace: w } = fixture(),
      lease = w.lease('ws', 'window', 'acquire');
    const token = 'token' in lease ? (lease.token ?? '') : '';
    const snapshot = defaultSnapshot(),
      group = snapshot.layout.center;
    assert(group.kind === 'group', 'test', 'expected group');
    snapshot.tabs = [
      {
        id: 'plugin-tab',
        kind: 'plugin',
        pluginId: 'p',
        originalPluginTitle: 'P',
        originalPageTitle: 'Page',
        customTitle: null,
        url: 'http://localhost/web/page/plugin/p/',
        locator: { installationId: 'i', pluginId: 'p', path: '/', search: '', hash: '' },
        pinned: false,
        keepAlive: false,
        createdAt: 'now',
        lastFocusedAt: 'now',
        navigation: { entries: [], index: -1 },
        stateSnapshotId: null,
      },
      {
        id: 'internal-tab',
        kind: 'internal',
        page: 'settings',
        pinned: false,
        customTitle: null,
        createdAt: 'now',
        lastFocusedAt: 'now',
      },
    ];
    group.tabIds = ['plugin-tab', 'internal-tab'];
    group.activeTabId = 'plugin-tab';
    w.save('ws', snapshot, 0, 'window', token, 'save');
    const result = w.closeTabs('ws', ['plugin-tab', 'internal-tab'], 1, 'window', token, 'close');
    expect(w.history()).toHaveLength(1);
    expect(w.get('ws').snapshot.tabs).toHaveLength(0);
    expect(
      w.closeTabs('ws', ['plugin-tab', 'internal-tab'], 1, 'window', token, 'close').closeIds,
    ).toEqual(result.closeIds);
    expect(w.history()).toHaveLength(1);
    expect(() => w.closeTabs('ws', [], 1, 'window', token, 'other')).toThrow();
    expect(w.history()).toHaveLength(1);
    w.restore('ws', result.closeIds, group.id, 2, 'window', token, 'restore');
    expect(w.get('ws').snapshot.tabs).toHaveLength(1);
    expect(w.history()[0].restoredAt).toBeTruthy();
    const invalid = structuredClone(snapshot);
    assert(invalid.layout.center.kind === 'group', 'test', 'expected group');
    invalid.layout.center.tabIds.push('plugin-tab');
    expect(() => validateSnapshot(invalid)).toThrow();
  });
});

describe('events, tickets and notifications', () => {
  it('reports replay gaps, consumes tickets once and binds validation to exact data', () => {
    const events = new WorkbenchEvents();
    for (let i = 0; i < 2100; i++) {
      events.publish('changed', { i });
    }
    expect(events.replay({ workbench: 0 }, coreBootId).gap).toBe(true);
    expect(events.replay({ workbench: 2099 }, coreBootId).events).toHaveLength(1);
    const sessions = new PageSessions(),
      ticket = sessions.ticket('http://localhost', 'window');
    expect(() => sessions.consume(ticket, 'http://wrong')).toThrow();
    expect(() => sessions.consume(ticket, 'http://localhost')).toThrow();
    const s = sessions.create({
        origin: 'http://localhost',
        pluginId: 'p',
        safeId: 's',
        owner: 'w',
        tabId: 't',
        frameEpoch: 'e',
      }),
      validation = sessions.validation(s, { value: '1' });
    expect(() => sessions.consumeValidation(validation, { value: '2' })).toThrow();
    expect(() => sessions.consumeValidation(validation, { value: '1' })).toThrow();
  });
  it('deduplicates notifications, shares read status and bounds bursts', () => {
    const { storage } = fixture(),
      service = new NotificationService(storage);
    service.publish('plugin', 'p', 'success', '完成', { dedupeKey: 'done' });
    const n = service.publish('plugin', 'p', 'success', '完成', { dedupeKey: 'done' });
    expect(n.count).toBe(2);
    expect(service.list()).toHaveLength(1);
    service.change([n.id]);
    expect(service.list()[0].readAt).toBeTruthy();
    for (let i = 0; i < 28; i++) {
      service.publish('plugin', 'p', 'info', 'status');
    }
    expect(() => service.publish('plugin', 'p', 'info', 'overload')).toThrow();
  });
});

describe('Web command execution', () => {
  it('rejects unknown commands as a user error before accepting execution or clearing the draft', async () => {
    const { storage, workspace } = fixture();
    const lease = workspace.lease('unknown-workspace', 'owner', 'acquire');
    assert('token' in lease, 'test', 'lease required');
    const service = new CommandService(storage, workspace);
    commands.push(service);
    const terminal = service.saveTerminal('unknown-workspace', 'owner', lease.token, {
      title: 'Unknown',
      draft: 'missing-command',
    });
    await expect(
      service.execute(
        'unknown-workspace',
        'owner',
        lease.token,
        terminal.id,
        'missing-command',
        'unknown-key',
      ),
    ).rejects.toMatchObject({ code: 'unknown_command', status: 400 });
    expect(service.terminal(terminal.id, 'unknown-workspace').draft).toBe('missing-command');
    expect(storage.db.prepare('SELECT count(*) AS count FROM executions').get()).toEqual({
      count: 0,
    });
  });
  it('accepts exit and restart once and requests lifecycle after the execution receipt', async () => {
    const { storage, workspace } = fixture();
    const lease = workspace.lease('lifecycle-workspace', 'owner', 'acquire');
    const token = 'token' in lease ? (lease.token ?? '') : '';
    const lifecycle = vi.fn();
    const service = new CommandService(storage, workspace, lifecycle);
    commands.push(service);
    const terminal = service.saveTerminal('lifecycle-workspace', 'owner', token, {
      title: 'Lifecycle',
    });
    for (const name of ['exit', 'restart']) {
      registerCommand(
        createLogger('lifecycle-test', ''),
        name,
        () => {
          throw new Error('Must use coordinated lifecycle');
        },
        SYSTEM_SYMBOL,
      );
      const receipt = await service.execute(
        'lifecycle-workspace',
        'owner',
        token,
        terminal.id,
        name,
        name,
      );
      expect(lifecycle).not.toHaveBeenCalledWith(name === 'restart');
      expect(
        (await service.execute('lifecycle-workspace', 'owner', token, terminal.id, name, name)).id,
      ).toBe(receipt.id);
      await expect.poll(() => service.execution(receipt.id).status).toBe('succeeded');
      await expect
        .poll(() => lifecycle.mock.calls.some(([restart]) => restart === (name === 'restart')))
        .toBe(true);
    }
    expect(lifecycle).toHaveBeenCalledTimes(2);
  });
  it('persists acceptance, isolates input, keeps returned busy tasks and rejects stale cancels', async () => {
    const { storage, workspace: w } = fixture();
    const a = w.lease('wa', 'owner-a', 'acquire'),
      b = w.lease('wb', 'owner-b', 'acquire');
    const ta = 'token' in a ? (a.token ?? '') : '',
      tb = 'token' in b ? (b.token ?? '') : '';
    const c = new CommandService(storage, w);
    commands.push(c);
    const terminal = c.saveTerminal('wa', 'owner-a', ta, { title: 'A' }),
      other = c.saveTerminal('wb', 'owner-b', tb, { title: 'B' });
    let count = 0;
    const logger = createLogger('test', '');
    registerCommand(
      logger,
      'wb-test',
      async (log, _o, _a, _r, ctx) => {
        count++;
        assert(ctx, 'test', 'context required');
        const [error, value] = await ctx.next('Answer');
        if (error) {
          throw error;
        }
        log.info(value);
      },
      'workbench-test',
    );
    const accepted = await c.execute('wa', 'owner-a', ta, terminal.id, 'wb-test', 'key');
    await expect.poll(() => c.state('wa').inputs.length).toBe(1);
    const request = c.state('wa').inputs[0];
    expect(() =>
      c.input('wb', 'owner-b', tb, request.id, other.id, accepted.id, coreBootId, 'wrong'),
    ).toThrow();
    expect(
      c.input('wa', 'owner-a', ta, request.id, terminal.id, accepted.id, coreBootId, 'answer'),
    ).toEqual({ accepted: true });
    await expect.poll(() => c.execution(accepted.id).status).toBe('succeeded');
    expect((await c.execute('wa', 'owner-a', ta, terminal.id, 'wb-test', 'key')).id).toBe(
      accepted.id,
    );
    expect(count).toBe(1);
    expect(c.execution(accepted.id)).toMatchObject({ command: 'wb-test' });
    expect(
      c.outputPage(terminal.id, 0).items.filter((r: { type?: string }) => r.type === 'command'),
    ).toEqual([
      expect.objectContaining({
        text: 'wb-test',
        executionId: accepted.id,
        coreBootId,
        restored: false,
      }),
    ]);
    expect(
      c.outputPage(terminal.id, 0).items.some((r: { text: string }) => r.text.includes('answer')),
    ).toBe(true);
    expect(c.outputPage(other.id, 0).items).toHaveLength(0);
    storage.db.prepare('INSERT INTO output_records VALUES (?,?,?,?)').run(
      other.id,
      1,
      new Date().toISOString(),
      JSON.stringify({
        seq: 1,
        streamId: other.id,
        timestamp: new Date().toISOString(),
        type: 'command',
        text: 'old',
        coreBootId: 'previous-boot',
      }),
    );
    expect(c.outputPage(other.id, 0).items[0]).toMatchObject({ text: 'old', restored: true });
    await expect(
      c.cancel('wa', 'owner-a', ta, terminal.id, accepted.id, coreBootId),
    ).rejects.toMatchObject({ code: 'stale_execution' });
    unregisterPluginCommand('workbench-test');
    registerCommand(
      logger,
      'wb-busy',
      async (_l, _o, _a, _r, ctx) => {
        assert(ctx, 'test', 'context required');
        const handle = ctx.tasks.begin();
        setTimeout(() => handle.end(), 150);
      },
      'workbench-test',
    );
    const busy = await c.execute('wa', 'owner-a', ta, terminal.id, 'wb-busy', 'busy');
    await expect.poll(() => c.execution(busy.id).status).toBe('returned');
    await expect(
      c.execute('wa', 'owner-a', ta, terminal.id, 'wb-busy', 'busy2'),
    ).rejects.toMatchObject({ code: 'terminal_busy' });
    await expect.poll(() => c.execution(busy.id).status).toBe('succeeded');
  });
});

it('cancels a running Web command through its invocation signal and frees the terminal', async () => {
  const { storage, workspace } = fixture();
  const lease = workspace.lease('cancel-workspace', 'owner', 'acquire');
  assert('token' in lease, 'test', 'lease required');
  const service = new CommandService(storage, workspace);
  commands.push(service);
  const terminal = service.saveTerminal('cancel-workspace', 'owner', lease.token, {
    title: 'Cancel',
  });
  let cancelled = false;
  registerCommand(
    createLogger('test', ''),
    'cancel-running',
    async (_log, _options, _unused, _raw, context) => {
      assert(context, 'test', 'context required');
      await new Promise<void>((resolve) =>
        context.signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            resolve();
          },
          { once: true },
        ),
      );
    },
    'workbench-test',
  );
  const execution = await service.execute(
    'cancel-workspace',
    'owner',
    lease.token,
    terminal.id,
    'cancel-running',
    'cancel-key',
  );
  const result = await service.cancel(
    'cancel-workspace',
    'owner',
    lease.token,
    terminal.id,
    execution.id,
    coreBootId,
  );
  expect(cancelled).toBe(true);
  expect(result.needsForce).toBe(false);
  expect(service.execution(execution.id).status).toBe('cancelled');
});

describe('bookmark tree moves', () => {
  it('atomically moves folders and bookmarks in a mixed sibling order, rejecting cycles and stale revisions', () => {
    const { workspace } = fixture();
    workspace.setPreferences(
      {
        bookmarkFolders: [
          { id: 'a', name: 'A' },
          { id: 'b', name: 'B' },
          { id: 'c', name: 'C', parentId: 'a' },
        ],
      },
      0,
    );
    workspace.bookmark(
      {
        pluginId: 'p',
        url: 'http://localhost/web/page/plugin/p/',
        locator: { installationId: 'i', pluginId: 'p', path: '/', search: '', hash: '' },
        originalTitle: 'Page',
      },
      'page',
    );
    let result = workspace.moveBookmark({
      source: 'bookmark:page',
      target: 'folder:a',
      position: 'inside',
      baseRevision: 1,
    });
    expect(result.bookmarks[0].folderId).toBe('a');
    result = workspace.moveBookmark({
      source: 'folder:b',
      target: 'bookmark:page',
      position: 'before',
      baseRevision: 2,
    });
    expect(
      result.preferences.values.bookmarkFolders.find((f: { id: string }) => f.id === 'b').parentId,
    ).toBe('a');
    expect(result.preferences.values.bookmarkOrder.indexOf('folder:b')).toBeLessThan(
      result.preferences.values.bookmarkOrder.indexOf('bookmark:page'),
    );
    expect(() =>
      workspace.moveBookmark({
        source: 'folder:a',
        target: 'folder:c',
        position: 'inside',
        baseRevision: 3,
      }),
    ).toThrow('子文件夹');
    expect(workspace.preferences().revision).toBe(3);
    expect(() =>
      workspace.moveBookmark({
        source: 'folder:b',
        target: null,
        position: 'inside',
        baseRevision: 1,
      }),
    ).toThrow('数据已更新');
    result = workspace.moveBookmark({
      source: 'folder:b',
      target: null,
      position: 'inside',
      baseRevision: 3,
    });
    expect(
      result.preferences.values.bookmarkFolders.find((f: { id: string }) => f.id === 'b').parentId,
    ).toBeNull();
  });
  it('accepts browser and future desktop path bindings in workspace snapshots', () => {
    const snapshot = defaultSnapshot();
    snapshot.binding = { kind: 'local-path', localPath: 'F:/workspace/example.json' };
    expect(validateSnapshot(snapshot).binding?.localPath).toBe('F:/workspace/example.json');
  });
});
