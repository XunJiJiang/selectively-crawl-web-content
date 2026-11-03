import { expect, it } from 'vitest';
import {
  scriptConfigProblem,
  readScriptValues,
  saveScriptValues,
  SCRIPT_CONFIG_RANGES,
  ScriptUIRefreshQueue,
} from './script-ui.ts';
import type { ScriptUIModel } from './script-ui.ts';
it('defaults to retained v1 and refuses unsupported or too-new JSON configurations', () => {
  expect(scriptConfigProblem({}, '3.2.0')).toBeUndefined();
  expect(
    scriptConfigProblem({ version: 'v1', compatibleVersions: SCRIPT_CONFIG_RANGES }, '3.2.0'),
  ).toBeUndefined();
  expect(
    scriptConfigProblem({ version: 'v2', compatibleVersions: SCRIPT_CONFIG_RANGES }, '3.2.0'),
  ).toBeUndefined();
  expect(
    scriptConfigProblem({ version: 'v2', compatibleVersions: SCRIPT_CONFIG_RANGES }, '3.1.29'),
  ).toContain('3.2.0-*');
  expect(
    scriptConfigProblem({ version: 'v3', compatibleVersions: { v3: '4.0.0-*' } }, '3.2.0'),
  ).toContain('4.0.0-*');
});

it('serializes and coalesces template invalidations and preserves reserved site config channels', async () => {
  const queue = new ScriptUIRefreshQueue<number>();
  const resolvers: ((value: number) => void)[] = [];
  const read = () => new Promise<number>((resolve) => resolvers.push(resolve));
  const first = queue.run('p', read);
  await Promise.resolve();
  const second = queue.run('p', read);
  queue.run('p', read);
  expect(resolvers).toHaveLength(1);
  resolvers.shift()!(1);
  await Promise.resolve();
  await Promise.resolve();
  expect(resolvers).toHaveLength(1);
  resolvers.shift()!(2);
  expect(await first).toBe(2);
  expect(await second).toBe(2);
  const reserved = { pluginId: 'p', channel: 'v2:config:enabled', value: true };
  expect(saveScriptValues('p', { q: 'draft' }, [reserved])).toContainEqual(reserved);
});
it('persists v2 fields alongside legacy values and round-trips multiple selections', () => {
  const saved = saveScriptValues('plugin', { q: 'draft', enabled: false, choices: ['a', 'b'] }, [
    { pluginId: 'other', channel: 'v2:q', value: 'keep' },
    { pluginId: 'plugin', channel: 'old', value: 123 },
  ]);
  const model = {
    compiled: {
      fields: [
        { name: 'q', kind: 'string' },
        { name: 'enabled', kind: 'boolean' },
        { name: 'choices', kind: 'multiple' },
      ],
    },
  } as ScriptUIModel;
  expect(readScriptValues('plugin', model, saved)).toEqual({
    q: 'draft',
    enabled: false,
    choices: ['a', 'b'],
  });
  expect(saved).toContainEqual({ pluginId: 'plugin', channel: 'old', value: 123 });
  expect(saved).toContainEqual({ pluginId: 'other', channel: 'v2:q', value: 'keep' });
});
