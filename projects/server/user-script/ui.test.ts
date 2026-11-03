import { expect, it, vi } from 'vitest';
import { ScriptUIRuntime } from './ui.ts';
import type { ScriptConfigV2, ScriptContext, ScriptUIEvent } from '../../shared/script-ui.ts';

const context: ScriptContext = {
  version: 'v2',
  site: {
    url: 'https://example.com/article',
    rootUrl: 'https://example.com',
    origin: 'https://example.com',
    pathname: '/article',
    host: 'example.com',
    hostname: 'example.com',
  },
  data: [{ label: 'body', value: 'article', images: [] }],
  values: {},
  logger: {} as SCWC.TLogger,
};
it('expands backend components, compiles grouped JSON and executes a bound pipeline with captured data', async () => {
  const run = vi.fn(function (this: ScriptContext, value) {
    expect(this.data).toEqual(context.data);
    expect(this.version).toBe('v2');
    return value;
  });
  const config: ScriptConfigV2 = {
    version: 'v2',
    title: 'Demo',
    handlers: { save: { run } },
    components: {
      editor: () => ({
        type: 'stack',
        children: [
          { type: 'input', name: 'query', value: 'default' },
          {
            type: 'button',
            text: 'Save',
            for: 'query',
            events: { click: 'core:string.trim($for:query)|save($prev)' },
          },
        ],
      }),
    },
    content: {
      format: 'json',
      version: 1,
      root: {
        type: 'tabs',
        tabs: [
          { id: 'editor', label: 'Editor', children: [{ type: 'custom', component: 'editor' }] },
          {
            id: 'preview',
            label: 'Preview',
            children: [{ type: 'text', text: '${core:value.read("query")}' }],
          },
        ],
      },
    },
  };
  const runtime = new ScriptUIRuntime(),
    model = await runtime.render(config, context);
  expect(model.compiled.format).toBe('json');
  expect(model.updates).toEqual([{ id: expect.any(String), value: 'default' }]);
  const event: ScriptUIEvent = {
    version: 'v2',
    instanceId: model.instanceId,
    eventId: 'once',
    bindingId: model.compiled.events[0].id,
    fields: { query: { value: '  hello  ', editSequence: 1 } },
  };
  const result = await runtime.event(event, context);
  expect(result.result).toBe('hello');
  expect(result.updates[0].value).toBe('  hello  ');
  expect(await runtime.event(event, context)).toEqual(result);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(
    runtime.event({ ...event, fields: { query: { value: 'changed', editSequence: 2 } } }, context),
  ).rejects.toThrow('身份冲突');
  await expect(
    runtime.event(
      { ...event, eventId: 'other' },
      { ...context, site: { ...context.site, url: 'https://other.example/' } },
    ),
  ).rejects.toThrow('过期');
  await expect(
    runtime.event({ ...event, eventId: 'unknown', bindingId: 'injected' }, context),
  ).rejects.toThrow('未知事件');
});
it('rejects frontend handlers, side effects in templates and recursively expanding components', async () => {
  const runtime = new ScriptUIRuntime();
  const config: ScriptConfigV2 = {
    version: 'v2',
    title: 'Invalid',
    content: { format: 'json', version: 1, root: { type: 'text', text: '${write()}' } },
    handlers: { write: { run: () => 'no' } },
  };
  await expect(runtime.render(config, context)).rejects.toThrow('只读');
  await expect(
    runtime.render(
      {
        ...config,
        content: {
          format: 'json',
          version: 1,
          root: { type: 'button', text: 'Bad', events: { click: 'ui:unsafe()' } },
        },
      },
      context,
    ),
  ).rejects.toThrow('后端');
  await expect(
    runtime.render(
      {
        ...config,
        components: { loop: () => ({ type: 'custom', component: 'loop' }) },
        content: { format: 'json', version: 1, root: { type: 'custom', component: 'loop' } },
      },
      context,
    ),
  ).rejects.toThrow('展开超过限制');
});
