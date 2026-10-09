import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TerminalPlugins } from './load.ts';
import { TerminalController } from '../controller.ts';
import { TerminalModel } from '../model.ts';
import { CoreConnection } from '../core.ts';
import { StateStore } from '../storage.ts';
import type { CommandConflict } from './types.d.ts';

async function fixture(plugins: Record<string, { names: string[]; id?: string }>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-conflicts-'));
  for (const [folder, plugin] of Object.entries(plugins)) {
    const location = path.join(directory, folder);
    await fs.mkdir(location);
    await fs.writeFile(
      path.join(location, 'package.json'),
      JSON.stringify({ type: 'module', main: 'index.ts' }),
    );
    await fs.writeFile(
      path.join(location, 'index.ts'),
      `export default {id: ${JSON.stringify(plugin.id)}, onLoad({registerCommand}) {
      for (const name of ${JSON.stringify(plugin.names)}) registerCommand({name, usage: name + ' <value>', description: '${folder}', execute(context) {context.write('RUN:${folder}:' + context.logger.pluginId);}});
    }};`,
    );
  }
  return directory;
}
async function cleanup(loader: TerminalPlugins, directory: string) {
  await loader.unload();
  await fs.rm(directory, { recursive: true, force: true });
}

describe('plugin identifiers and grouped command conflicts', () => {
  it('groups every built-in conflict for one plugin into one decision and prefixes all its commands', async () => {
    const directory = await fixture({ example: { names: ['help', 'one', 'two', 'extra'] } });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return 'a';
    };
    try {
      await loader.load(directory, 'output', [{ name: 'one' }, { name: 'two' }]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].names).toEqual(['help', 'one', 'two']);
      expect(loader.list().map((command) => command.name)).toEqual([
        'example:help',
        'example:one',
        'example:two',
        'example:extra',
      ]);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('groups plugin-pair conflicts and asks the other plugin even when the first has added a prefix', async () => {
    const directory = await fixture({
      first: { names: ['one', 'two'] },
      second: { names: ['one', 'two'] },
    });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return conflict.kind === 'cleared' ? 'b' : 'a';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(conflicts.map(({ kind, names, second }) => [kind, names, second.id])).toEqual([
        ['commands', ['one', 'two'], 'first'],
        ['cleared', [], 'second'],
      ]);
      expect(loader.list().map((command) => command.name)).toEqual([
        'first:one',
        'first:two',
        'one',
        'two',
      ]);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('drops whole plugins and continues checking the remaining participants', async () => {
    const directory = await fixture({
      first: { names: ['one', 'two'] },
      second: { names: ['one', 'two'] },
      third: { names: ['one', 'two'] },
    });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      if (conflict.kind === 'cleared') {
        return 'b';
      }
      return conflict.first.id === 'second' ? 'c' : 'b';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(
        conflicts
          .filter(({ kind }) => kind === 'commands')
          .map(({ first, second, names }) => [first.id, second.id, names]),
      ).toEqual([
        ['second', 'first', ['one', 'two']],
        ['third', 'first', ['one', 'two']],
      ]);
      expect(loader.list().map((command) => command.description)).toEqual(['third', 'third']);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('checks all matching identifiers before commands and keeps checking a survivor among three duplicates', async () => {
    const directory = await fixture({
      first: { names: ['shared'], id: 'same' },
      second: { names: ['shared'], id: 'same' },
      third: { names: ['shared'], id: 'same' },
    });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return 'e';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(conflicts.map(({ kind, first, second }) => [kind, first.id, second.id])).toEqual([
        ['identifier', 'first', 'second'],
        ['identifier', 'first', 'third'],
      ]);
      expect(loader.list().map((command) => command.description)).toEqual(['first']);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('renames the second identifier, rejects occupied names and uses the custom identifier for commands and logger identity', async () => {
    const directory = await fixture({
      first: { names: ['shared'], id: 'same' },
      second: { names: ['shared'], id: 'same' },
      taken: { names: [], id: 'occupied' },
    });
    const loader = new TerminalPlugins();
    const output: string[] = [];
    loader.on('output', ({ text }: { text: string }) => output.push(text));
    loader.resolveConflict = async (conflict) => {
      if (conflict.kind === 'identifier') {
        expect(conflict.checkIdentifier?.('occupied', 'second')).toContain('已被占用');
        if (conflict.identifiers) {
          conflict.identifiers.second = 'custom';
        }
        return 'a';
      }
      return 'a';
    };
    try {
      await loader.load(directory, 'output', [{ name: 'shared' }]);
      expect(loader.has('custom:shared')).toBe(true);
      await loader.execute('custom:shared', [], { windowId: 'window', executionId: 'run' });
      await expect.poll(() => output.includes('RUN:second:custom')).toBe(true);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('allows both identifiers to change and rejects a duplicate proposed for the second', async () => {
    const directory = await fixture({
      first: { names: ['shared'], id: 'same' },
      second: { names: ['shared'], id: 'same' },
    });
    const loader = new TerminalPlugins();
    loader.resolveConflict = async (conflict) => {
      if (conflict.kind === 'identifier') {
        if (conflict.identifiers) {
          conflict.identifiers.first = 'alpha';
        }
        expect(conflict.checkIdentifier?.('alpha', 'second')).toContain('已被占用');
        if (conflict.identifiers) {
          conflict.identifiers.second = 'beta';
        }
        return 'c';
      }
      return 'a';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(loader.list().map((command) => command.name)).toEqual(['alpha:shared', 'beta:shared']);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('persists renamed identifiers, prefix policies and discarded plugins across a restart', async () => {
    const directory = await fixture({
      auxiliaryFirst: { names: ['solo-first'], id: 'alias' },
      auxiliarySecond: { names: ['solo-second'], id: 'alias' },
      first: { names: ['one', 'extra'], id: 'same' },
      second: { names: ['one'], id: 'same' },
      third: { names: ['two'] },
    });
    const model = new TerminalModel();
    const store = new StateStore(path.join(directory, 'state.json'));
    const loader = new TerminalPlugins();
    loader.preferences = model.pluginPreferences;
    loader.resolveConflict = async (conflict) => {
      if (conflict.kind === 'identifier') {
        if (conflict.identifiers) {
          conflict.identifiers.second = conflict.identifier === 'alias' ? 'custom-only' : 'custom';
        }
        return 'a';
      }
      return conflict.second.id === 'third' ? 'b' : 'a';
    };
    const commands = [{ name: 'one' }, { name: 'two' }];
    try {
      await store.lock();
      await loader.load(directory, 'output', commands);
      expect(Object.values(model.pluginPreferences)).toContainEqual({
        policy: undefined,
        identifier: 'custom-only',
      });
      const expected = loader.list().map((command) => command.name);
      await store.save(model);
      await loader.unload();
      const restored = await store.load();
      const restarted = new TerminalPlugins();
      restarted.preferences = restored.pluginPreferences;
      const resolve = vi.fn();
      restarted.resolveConflict = resolve;
      try {
        await restarted.load(directory, 'output', commands);
        expect(resolve).not.toHaveBeenCalled();
        expect(restarted.list().map((command) => command.name)).toEqual(expected);
        expect(restarted.has('custom:one')).toBe(true);
        expect(restarted.has('two')).toBe(false);
      } finally {
        await restarted.unload();
      }
    } finally {
      await store.release();
      await cleanup(loader, directory);
    }
  });
  it('rechecks new core collisions for plugins previously kept without a prefix', async () => {
    const directory = await fixture({
      first: { names: ['shared', 'future'] },
      second: { names: ['shared'] },
    });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return conflict.kind === 'cleared' ? 'b' : 'a';
    };
    try {
      await loader.load(directory, 'output', []);
      await loader.reconcile([{ name: 'shared' }]);
      expect(conflicts.at(-1)?.second.id).toBe('second');
      expect(loader.has('second:shared')).toBe(true);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('provides a fixed colon for keyboard choices, retains window drafts and retries invalid choices', async () => {
    const directory = await fixture({ example: { names: ['one', 'two'] } });
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.record(model.active, 'old');
    model.setInput('saved draft', 11);
    const core = new CoreConnection({ args: [] });
    const controller = new TerminalController(model, core);
    core.emit('commands', [{ name: 'one' }, { name: 'two' }]);
    const loading = controller.plugins.load(directory, model.output.id, [
      { name: 'one' },
      { name: 'two' },
    ]);
    try {
      await expect.poll(() => model.confirmation?.text).toContain('one、two');
      expect(model.text).toBe(':');
      await controller.key({ name: 'backspace', sequence: '' });
      expect(model.text).toBe(':');
      await controller.key({ name: 'text', sequence: 'c' });
      await controller.key({ name: 'enter', sequence: '\r' });
      expect(model.confirmation?.text).toContain('请输入 :a、:b');
      expect(model.text).toBe(':');
      controller.renderer.frame(model);
      await controller.key({ name: 'up', sequence: '' });
      expect(model.active.draft).toBe('saved draft');
      await controller.key({ name: 'text', sequence: 'a' });
      await controller.key({ name: 'enter', sequence: '\r' });
      await loading;
      expect(controller.plugins.has('example:one')).toBe(true);
      expect(controller.plugins.has('example:two')).toBe(true);
    } finally {
      await cleanup(controller.plugins, directory);
    }
  });
  it('does not silently choose a policy without a decision UI', async () => {
    const directory = await fixture({ example: { names: ['help', 'extra'] } });
    const loader = new TerminalPlugins();
    const output = vi.fn();
    loader.on('output', output);
    try {
      await loader.load(directory, 'output', []);
      expect(loader.has('extra')).toBe(false);
      expect(loader.has('example:help')).toBe(false);
      expect(output.mock.calls.some(([event]) => event.text.includes('需要交互裁决'))).toBe(true);
    } finally {
      await cleanup(loader, directory);
    }
  });
});
