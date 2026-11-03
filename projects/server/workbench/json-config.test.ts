import { afterEach, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { WorkbenchStorage } from './storage.ts';
import { PluginConfigService } from './plugin-config.ts';
import { DeclarativeUIService } from './declarative-ui.ts';
import type { UIWireRegistry } from '../../shared/declarative-ui.ts';

const fixture = vi.hoisted(() => ({ config: undefined as PluginConfigService | undefined }));
vi.mock('./plugin-config.ts', async (original) => ({
  ...(await original<typeof import('./plugin-config.ts')>()),
  getPluginConfig: () => {
    assert.ok(fixture.config);
    return fixture.config;
  },
}));
let storage: WorkbenchStorage;
let service: DeclarativeUIService;
afterEach(() => {
  service?.releaseOwner('epoch');
  storage?.close();
});

it('binds typed settings to SQLite without handlers, normalizes values and preserves conflicting drafts', async () => {
  storage = new WorkbenchStorage(':memory:', ':memory:');
  const config = (fixture.config = new PluginConfigService(storage));
  config.define(
    'p',
    {
      id: 'general',
      schemaVersion: '1',
      label: '常规',
      description: '组说明',
      footer: '组下方说明',
      items: [
        {
          id: 'title',
          key: 'title',
          label: '标题',
          control: 'text',
          defaultValue: 'initial',
          validationPolicy: 'backend-required',
        },
        {
          id: 'limit',
          key: 'limit',
          label: '数量',
          control: 'number',
          defaultValue: '3',
          rules: { codec: 'integer', min: 1, max: 10 },
        },
        {
          id: 'enabled',
          key: 'enabled',
          label: '启用',
          control: 'checkbox',
          defaultValue: 'false',
        },
      ],
    },
    0,
  );
  config.bindValidator('p', async (values) =>
    Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()])),
  );
  service = new DeclarativeUIService();
  const registry: UIWireRegistry = {
    handlers: [],
    mounts: [],
    inspector: false,
    views: [
      {
        surface: 'mainSidebar',
        definition: {
          id: 'settings',
          title: 'Settings',
          content: {
            format: 'json',
            version: 1,
            root: {
              type: 'group',
              label: 'Settings',
              children: [
                { type: 'setting', name: 'noteField', label: 'Title', config: 'title' },
                {
                  type: 'setting',
                  name: 'limit',
                  label: 'Limit',
                  config: 'limit',
                  valueType: 'integer',
                  min: 1,
                  max: 10,
                },
                {
                  type: 'setting',
                  name: 'enabled',
                  label: 'Enabled',
                  config: 'enabled',
                  valueType: 'boolean',
                },
              ],
            },
          },
        },
      },
    ],
  };
  await service.install('p', 'epoch', process.cwd(), registry, async () => {
    throw Error('No custom controller');
  });
  const instance = await service.create({
    pluginId: 'p',
    surface: 'mainSidebar',
    viewId: 'settings',
    windowId: 'window',
    workspaceId: 'workspace',
    tabId: null,
    sourceTabId: null,
    sourceFrameEpoch: null,
  });
  const read = (fields = {}) =>
    service.data(instance.id, 'window', { renderRevision: instance.renderRevision, fields });
  let sequence = 0;
  const save = (name: string, value: string | boolean) => {
    const binding = instance.compiled.events.find((event) => event.capture.includes(name));
    assert.ok(binding);
    return service.execute(instance.id, 'window', {
      eventId: `save-${++sequence}`,
      renderRevision: instance.renderRevision,
      bindingId: binding.id,
      fields: { [name]: { value, editSequence: sequence } },
    });
  };
  expect((await read()).updates.map((update) => update.value)).toEqual(['initial', '3', false]);
  expect(await save('noteField', '  saved  ')).toMatchObject({
    status: 'succeeded',
    effects: expect.arrayContaining([
      expect.objectContaining({ type: 'value.write', args: ['noteField', 'saved'] }),
    ]),
  });
  expect(config.get('p', 'title')).toBe('saved');
  expect(await save('enabled', true)).toMatchObject({ status: 'succeeded' });
  expect(config.get('p', 'enabled')).toBe('true');
  expect(await save('limit', '2.5')).toMatchObject({ status: 'failed' });
  expect(config.get('p', 'limit')).toBe('3');
  await config.update('p', { title: 'remote' });
  expect((await read({ noteField: 'saved', enabled: true, limit: '3' })).updates[0].value).toBe(
    'remote',
  );
  expect(await save('noteField', 'next')).toMatchObject({ status: 'succeeded' });
  await config.update('p', { title: 'other writer' });
  await read({ noteField: 'local draft', enabled: true, limit: '3' });
  expect(await save('noteField', 'local draft')).toMatchObject({
    status: 'failed',
    error: { code: 'UI_CONFIG_CONFLICT' },
  });
  expect(config.get('p', 'title')).toBe('other writer');
});
