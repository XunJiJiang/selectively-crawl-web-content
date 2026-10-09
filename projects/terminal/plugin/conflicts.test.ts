import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TerminalPlugins } from './load.ts';
import { TerminalController } from '../controller.ts';
import { TerminalModel } from '../model.ts';
import { CoreConnection } from '../core.ts';
import type { CommandConflict } from './types.d.ts';

async function fixture(plugins: Record<string, string[]>) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'scwc-conflicts-'));
  for (const [id, names] of Object.entries(plugins)) {
    const folder = path.join(directory, id);
    await fs.mkdir(folder);
    await fs.writeFile(
      path.join(folder, 'package.json'),
      JSON.stringify({ type: 'module', main: 'index.ts' }),
    );
    await fs.writeFile(
      path.join(folder, 'index.ts'),
      `export default {onLoad({registerCommand}) {
      for (const name of ${JSON.stringify(names)}) registerCommand({name, usage: name + ' <value>', description: '${id}', execute(context) {context.write('RUN:${id}');}});
    }};`,
    );
  }
  return directory;
}
async function cleanup(loader: TerminalPlugins, directory: string) {
  await loader.unload();
  await fs.rm(directory, { recursive: true, force: true });
}

describe('pairwise terminal command conflict decisions', () => {
  it('drops the whole rejected plugin and removes it from later system and plugin comparisons', async () => {
    const directory = await fixture({ first: ['shared', 'extra'], second: ['shared'] });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return conflict.second.id === 'first' ? 'b' : 'a';
    };
    try {
      await loader.load(directory, 'output', [{ name: 'shared' }, { name: 'extra' }]);
      expect(conflicts.map((item) => [item.first.kind, item.name, item.second.id])).toEqual([
        ['core', 'shared', 'first'],
        ['core', 'shared', 'second'],
      ]);
      expect(loader.has('extra')).toBe(false);
      expect(loader.has('first:shared')).toBe(false);
      expect(loader.has('second:shared')).toBe(true);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('prompts for every pair among three plugins even after earlier commands received prefixes', async () => {
    const directory = await fixture({ first: ['shared'], second: ['shared'], third: ['shared'] });
    const loader = new TerminalPlugins();
    const pairs: string[] = [];
    loader.resolveConflict = async (conflict) => {
      pairs.push(conflict.first.id + ':' + conflict.second.id);
      return 'a';
    };
    const outputs: string[] = [];
    loader.on('output', ({ text }: { text: string }) => outputs.push(text));
    try {
      await loader.load(directory, 'output', []);
      expect(pairs).toEqual(['first:second', 'first:third', 'second:third']);
      expect(loader.list().map((item) => item.name)).toEqual([
        'first:shared',
        'second:shared',
        'third:shared',
      ]);
      expect(loader.list()[1].usage).toBe('second:shared <value>');
      await loader.execute('second:shared', [], { windowId: 'window', executionId: 'run' });
      await expect.poll(() => outputs.includes('RUN:second')).toBe(true);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('keeps the first or second entire plugin and stops comparing a discarded owner', async () => {
    const directory = await fixture({
      first: ['shared', 'first-only'],
      second: ['shared', 'second-only'],
      third: ['shared', 'third-only'],
    });
    const loader = new TerminalPlugins();
    const pairs: string[] = [];
    loader.resolveConflict = async (conflict) => {
      pairs.push(conflict.first.id + ':' + conflict.second.id);
      return conflict.second.id === 'second' ? 'b' : 'c';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(pairs).toEqual(['first:second', 'first:third']);
      expect(loader.list().map((item) => item.name)).toEqual(['shared', 'third-only']);
      expect(loader.has('first-only')).toBe(false);
      expect(loader.has('second-only')).toBe(false);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('does not ask about additional commands after either participant was rejected', async () => {
    const directory = await fixture({
      first: ['one', 'two'],
      second: ['one', 'two'],
      third: ['one', 'two'],
    });
    const loader = new TerminalPlugins();
    const conflicts: string[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(`${conflict.first.id}:${conflict.second.id}:${conflict.name}`);
      return conflict.second.id === 'second' ? 'c' : 'b';
    };
    try {
      await loader.load(directory, 'output', []);
      expect(conflicts).toEqual(['first:second:one', 'second:third:one']);
      expect(loader.list().map((item) => item.description)).toEqual(['second', 'second']);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('serializes terminal and core conflicts, then handles core commands registered after loading', async () => {
    const directory = await fixture({ first: ['help', 'future'] });
    const loader = new TerminalPlugins();
    const conflicts: CommandConflict[] = [];
    loader.resolveConflict = async (conflict) => {
      conflicts.push(conflict);
      return 'a';
    };
    try {
      await loader.load(directory, 'output', [{ name: 'help' }]);
      expect(conflicts.map((item) => item.first.kind)).toEqual(['terminal', 'core']);
      expect(loader.has('first:help')).toBe(true);
      await loader.reconcile([{ name: 'help' }, { name: 'future' }]);
      expect(conflicts.map((item) => item.name)).toEqual(['help', 'help', 'future']);
      expect(loader.has('first:future')).toBe(true);
      await loader.reconcile([{ name: 'help' }, { name: 'future' }]);
      expect(conflicts).toHaveLength(3);
    } finally {
      await cleanup(loader, directory);
    }
  });
  it('waits for valid keyboard decisions before publishing commands', async () => {
    const directory = await fixture({ example: ['shared'] });
    const model = new TerminalModel();
    model.switch(model.windows[1].id);
    model.record(model.active, 'old');
    model.setInput('saved draft', 11);
    const core = new CoreConnection({ args: [] });
    const controller = new TerminalController(model, core);
    core.emit('commands', [{ name: 'shared' }]);
    const loading = controller.plugins.load(directory, model.output.id, [{ name: 'shared' }]);
    try {
      await expect.poll(() => model.confirmation?.text).toContain(':a');
      expect(model.confirmation?.text).toContain(':b');
      expect(model.confirmation?.text).not.toContain(':c');
      expect(controller.plugins.has('shared')).toBe(false);
      controller.renderer.frame(model);
      await controller.key({ name: 'up', sequence: '' });
      expect(model.active.draft).toBe('saved draft');
      for (const sequence of ':c') {
        await controller.key({ name: 'text', sequence });
      }
      await controller.key({ name: 'enter', sequence: '\r' });
      expect(model.confirmation?.text).toContain('请输入 :a 或 :b');
      for (const sequence of ':a') {
        await controller.key({ name: 'text', sequence });
      }
      await controller.key({ name: 'enter', sequence: '\r' });
      await loading;
      expect(controller.plugins.has('example:shared')).toBe(true);
    } finally {
      await cleanup(controller.plugins, directory);
    }
  });
  it('does not silently choose a prefix when no conflict decision UI is available', async () => {
    const directory = await fixture({ example: ['help', 'extra'] });
    const loader = new TerminalPlugins();
    const output = vi.fn();
    loader.on('output', output);
    try {
      await loader.load(directory, 'output', []);
      expect(loader.has('extra')).toBe(false);
      expect(loader.has('example:help')).toBe(false);
      expect(output.mock.calls.some(([event]) => event.text.includes('需要交互裁决'))).toBe(true);
      expect(loader.registry.busy()).toBe(false);
    } finally {
      await cleanup(loader, directory);
    }
  });
});
