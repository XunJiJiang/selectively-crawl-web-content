import { expect, it, vi } from 'vitest';
import { ScriptUIRuntime } from './ui.ts';
import type { ScriptConfigV2, ScriptContext, ScriptUIEvent } from '../../shared/script-ui.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';

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

it('validates script/extension inputs before actions and reports malformed async controllers', async () => {
  const save = vi.fn(() => 'saved');
  const validate = vi.fn(async (value, other) => ({
    success: value === other,
    message: '输入不一致',
  }));
  const config: ScriptConfigV2 = {
    version: 'v2',
    title: 'Validation',
    handlers: { save: { run: save }, check: { readOnly: true, run: validate } },
    content: {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        children: [
          { type: 'input', inputType: 'password', name: 'password', value: 'abc' },
          {
            type: 'textarea',
            name: 'confirm',
            minLength: 2,
            maxLength: 8,
            pattern: '[a-z]+',
            patternMessage: '只允许小写字母',
            validator: 'check($this,$for:password)',
          },
          { type: 'button', for: 'confirm', events: { click: 'save' } },
        ],
      },
    },
  };
  const runtime = new ScriptUIRuntime(),
    model = await runtime.render(config, context);
  const send = (value: string, event = 'click') =>
    runtime.event(
      {
        version: 'v2',
        instanceId: model.instanceId,
        eventId: crypto.randomUUID(),
        bindingId: requireValue(model.compiled.events.find((binding) => binding.event === event))
          .id,
        fields: {
          confirm: { value, editSequence: 1 },
          password: { value: 'abc', editSequence: 0 },
        },
      },
      context,
    );
  await expect(send('A!')).rejects.toThrow('只允许小写字母');
  expect(validate).not.toHaveBeenCalled();
  await expect(send('ab')).rejects.toThrow('输入不一致');
  expect(validate).toHaveBeenLastCalledWith('ab', 'abc');
  expect(save).not.toHaveBeenCalled();
  await expect(send('abc', 'blur')).resolves.toMatchObject({ saved: {} });
  expect(save).not.toHaveBeenCalled();
  await expect(send('abc')).resolves.toMatchObject({ result: 'saved' });
  expect(save).toHaveBeenCalledTimes(1);
  validate.mockResolvedValueOnce(true as never);
  await expect(send('abc')).rejects.toMatchObject({ code: 'UI_INVALID_VALIDATOR_RESULT' });
  expect(save).toHaveBeenCalledTimes(1);
});

it('does not publish invalid referenced or returned field values in template updates', async () => {
  const runtime = new ScriptUIRuntime();
  const consume = vi.fn(() => 'must not run');
  const model = await runtime.render(
    {
      version: 'v2',
      title: 'Read barrier',
      handlers: {
        check: { readOnly: true, run: () => ({ success: false, message: '控件校验失败' }) },
        consume: { readOnly: true, run: consume },
      },
      content: {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            { type: 'input', name: 'q', value: 'invalid', validator: 'check($this)' },
            { type: 'text', text: '${consume($for:q)}' },
            { type: 'text', text: '${core:value.read("q")}' },
            { type: 'input', name: 'target', minLength: 4, value: '${"x"}' },
          ],
        },
      },
    },
    context,
  );
  expect(consume).not.toHaveBeenCalled();
  expect(model.updates).toEqual([
    expect.objectContaining({ field: 'q', error: '控件校验失败' }),
    expect.objectContaining({ field: 'q', error: '控件校验失败' }),
    expect.objectContaining({ field: 'target', error: expect.stringContaining('至少输入') }),
  ]);
  expect(model.updates.every((update) => !Object.hasOwn(update, 'value'))).toBe(true);
});
