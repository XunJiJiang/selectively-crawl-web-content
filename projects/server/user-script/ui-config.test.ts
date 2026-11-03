import { afterEach, expect, it, vi } from 'vitest';
import { WorkbenchStorage } from '../workbench/storage.ts';
import { PluginConfigService } from '../workbench/plugin-config.ts';
import { UserScriptConfigDatabase } from './config.ts';
import { scriptConfigStorage } from './ui-config.ts';
import { ScriptUIRuntime } from './ui.ts';
import type { ScriptContext, ScriptConfigV2, ScriptUIModel } from '../../shared/script-ui.ts';

vi.mock('../common/environment.ts', () => ({}));
const fixture = vi.hoisted(() => ({
  plugin: undefined as PluginConfigService | undefined,
  site: undefined as UserScriptConfigDatabase | undefined,
}));
vi.mock('../workbench/plugin-config.ts', async (original) => ({
  ...(await original<typeof import('../workbench/plugin-config.ts')>()),
  getPluginConfig: () => fixture.plugin!,
}));
vi.mock('./config.ts', async (original) => ({
  ...(await original<typeof import('./config.ts')>()),
  getUserScriptConfig: () => fixture.site!,
}));
let storage: WorkbenchStorage;
afterEach(async () => {
  storage?.close();
  await fixture.site?.close();
});
const context: ScriptContext = {
  version: 'v2',
  site: {
    url: 'https://one.example/a',
    origin: 'https://one.example',
    rootUrl: 'https://one.example',
    pathname: '/a',
    host: 'one.example',
    hostname: 'one.example',
  },
  values: {},
  data: [],
  logger: {} as SCWC.TLogger,
};
it('uses global string config with backend normalization and origin-isolated site values with field CAS', async () => {
  storage = new WorkbenchStorage(':memory:', ':memory:');
  fixture.plugin = new PluginConfigService(storage);
  fixture.site = new UserScriptConfigDatabase(':memory:');
  fixture.plugin.define(
    'p',
    {
      id: 'general',
      schemaVersion: '1',
      groups: [{ id: 'g', itemIds: ['title', 'limit'] }],
      items: [
        {
          id: 'title',
          key: 'title',
          label: 'Title',
          control: 'text',
          defaultValue: 'initial',
          validationPolicy: 'backend-required',
        },
        {
          id: 'limit',
          key: 'limit',
          label: 'Limit',
          control: 'number',
          defaultValue: '3',
          rules: { codec: 'integer', min: 1, max: 9 },
        },
      ],
    },
    0,
  );
  fixture.plugin.bindValidator('p', async (values) => ({
    ...values,
    ...(values.title === undefined ? {} : { title: values.title.trim() }),
  }));
  const config: ScriptConfigV2 = {
    version: 'v2',
    title: 'Bound',
    content: {
      format: 'json',
      version: 1,
      root: {
        type: 'group',
        label: '常规',
        description: '上方说明',
        footer: '下方说明',
        children: [
          { type: 'setting', label: '标题', config: 'title', name: 'cfg.title' },
          {
            type: 'setting',
            label: '数值',
            config: 'limit',
            name: 'cfg.limit',
            valueType: 'integer',
            min: 1,
            max: 9,
          },
          {
            type: 'setting',
            label: '站点开关',
            config: 'enabled',
            name: 'cfg.enabled',
            configScope: 'site',
            valueType: 'boolean',
          },
        ],
      },
    },
  };
  const runtime = new ScriptUIRuntime(scriptConfigStorage('p'));
  const model = await runtime.render(config, context);
  expect(model.boundFields).toEqual(['cfg.title', 'cfg.limit', 'cfg.enabled']);
  expect(model.updates.map((item) => item.value)).toEqual(['initial', '3', false]);
  const event = (model: ScriptUIModel, name: string, value: string | boolean) => ({
    version: 'v2' as const,
    instanceId: model.instanceId,
    eventId: crypto.randomUUID(),
    bindingId: model.compiled.events.find(
      (e) => e.nodeId === model.compiled.fields.find((f) => f.name === name)?.nodeId,
    )!.id,
    fields: { [name]: { value, editSequence: 1 } },
  });
  const normalized = await runtime.event(event(model, 'cfg.title', '  saved  '), context);
  expect(normalized.saved).toEqual({ 'cfg.title': 'saved' });
  expect(fixture.plugin.snapshot('p').effectiveValues.title).toBe('saved');
  await expect(runtime.event(event(model, 'cfg.limit', '2.5'), context)).rejects.toThrow('数值');
  await runtime.event(event(model, 'cfg.limit', '5'), context);
  expect(fixture.plugin.snapshot('p').values.limit).toBe('5');
  await runtime.event(event(model, 'cfg.enabled', true), context);
  expect(fixture.site.get('https://one.example/other')?.data.controls).toContainEqual({
    pluginId: 'p',
    channel: 'v2:config:enabled',
    value: true,
  });
  expect(fixture.site.get('https://two.example')).toBeNull();
  const upload = structuredClone(fixture.site.get(context.site.url)!);
  upload.updatedAt = new Date(Date.parse(upload.updatedAt) + 1).toISOString();
  upload.data.controls = [];
  expect(fixture.site.sync(upload, { preserveBoundConfigs: true }).data.controls).toContainEqual({
    pluginId: 'p',
    channel: 'v2:config:enabled',
    value: true,
  });
  const stale = await runtime.render(config, context);
  await fixture.plugin.update('p', { title: 'remote' });
  await expect(runtime.event(event(stale, 'cfg.title', 'draft'), context)).rejects.toThrow(
    '其他调用',
  );
  const refreshed = await runtime.render(config, {
    ...context,
    previousInstanceId: stale.instanceId,
    dirtyFields: ['cfg.title'],
  });
  await expect(
    runtime.event(event(refreshed, 'cfg.title', 'draft after refresh'), context),
  ).rejects.toThrow('其他调用');
  const read = await runtime.event(
    {
      version: 'v2',
      instanceId: stale.instanceId,
      eventId: crypto.randomUUID(),
      bindingId: '$read',
      readOnly: true,
      fields: {},
    },
    context,
  );
  expect(read.updates[0].value).toBe('remote');
  await runtime.event(event(stale, 'cfg.title', 'after read'), context);
  const second = await runtime.render(config, context);
  const siteBaseline = await scriptConfigStorage('p').read('site', context.site.url, 'enabled');
  await scriptConfigStorage('p').write(
    'site',
    context.site.url,
    'enabled',
    'false',
    siteBaseline,
    true,
  );
  await expect(runtime.event(event(second, 'cfg.enabled', true), context)).rejects.toThrow(
    '其他调用',
  );
});
