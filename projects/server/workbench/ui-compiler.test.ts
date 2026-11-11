import { describe, expect, it } from 'vitest';
import { compileUI, compileCSS } from './ui-compiler.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';
const options = {
  resource: (value: string) => {
    if (!value.startsWith('/assets/')) {
      throw Error('denied');
    }
    return '/gateway' + value;
  },
  validateCall: () => {
    /* Callback not used by this fixture. */
  },
};
describe('safe UI compilation', () => {
  it('expands validator dependencies before consumers and rejects cyclic field checks', () => {
    const compile = (peer: string) =>
      compileUI(
        {
          format: 'json',
          version: 1,
          root: {
            type: 'stack',
            children: [
              { type: 'input', name: 'q', validator: 'check($this,$for:other)' },
              { type: 'input', name: 'other', minLength: 3, ...(peer ? { validator: peer } : {}) },
              { type: 'button', for: 'q', events: { click: 'ui:send' } },
            ],
          },
        },
        options,
      );
    const result = compile('');
    const click = requireValue(result.events.find((binding) => binding.event === 'click'));
    expect(click.capture).toEqual(['other', 'q']);
    expect(click.program.branches[0][0]).toMatchObject({
      name: 'core:validate',
      validationTarget: 'other',
    });
    expect(() => compile('check($for:q)')).toThrow('循环');
  });
  it('retains legal names that overlap DOM properties instead of dropping their validation', () => {
    const result = compileUI(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'input',
          name: 'target',
          minLength: 4,
          value: '${"x"}',
        },
      },
      options,
    );
    expect(result.fields[0]).toMatchObject({
      name: 'target',
      validation: { rules: { minLength: 4 } },
    });
    expect(result.events).toHaveLength(2);
  });
  it.each(['text', 'number', 'password', 'textarea'])(
    'compiles constraints, readonly and validator dependencies for %s',
    (type) => {
      const compiled = compileUI(
        {
          format: 'json',
          version: 1,
          root: {
            type: 'stack',
            children: [
              { type: 'input', name: 'other', value: '2' },
              {
                type: type === 'textarea' ? 'textarea' : 'input',
                ...(type === 'textarea' ? {} : { inputType: type }),
                name: 'value_1-2',
                minLength: 1,
                maxLength: 8,
                min: 1,
                max: 20,
                pattern: '[0-9]+',
                patternMessage: '请输入数字',
                validator: 'check($this, $for:other)',
                placeholder: '输入值',
                disabled: false,
                readonly: true,
              },
              { type: 'button', for: 'value_1-2', events: { click: 'save' } },
            ],
          },
        },
        options,
      );
      const field = requireValue(compiled.fields.find((field) => field.name === 'value_1-2'));
      const nodes = compiled.nodes.flatMap(function visit(node): typeof compiled.nodes {
        return [node, ...(node.children ?? []).flatMap(visit)];
      });
      expect(nodes.find((node) => node.id === field.nodeId)?.attrs).toMatchObject({
        minlength: '1',
        maxlength: '8',
        readonly: '',
        placeholder: '输入值',
      });
      expect(JSON.stringify(compiled.nodes)).not.toContain('data-ui-validation');
      expect(field.validation?.validator).toMatchObject({
        name: 'check',
        validationField: field.name,
        readOnly: true,
      });
      for (const event of compiled.events) {
        expect(event.capture).toEqual(expect.arrayContaining(['value_1-2', 'other']));
        expect(event.program.branches.slice(0, 2).map((chain) => chain[0].name)).toEqual([
          'core:validate',
          'check',
        ]);
      }
      expect(compiled.events.map((event) => event.event)).toEqual(['click', 'change', 'blur']);
    },
  );
  it.each(['has.dot', 'has space', '斜线', 'x/y', 'x:y', '', 'x\n', '__proto__'])(
    'rejects invalid control names: %j',
    (name) => {
      expect(() =>
        compileUI({ format: 'json', version: 1, root: { type: 'input', name } }, options),
      ).toThrow();
    },
  );
  it('rejects malformed constraints, implicit validators and missing validation dependencies', () => {
    for (const extra of [
      { min: 3, max: 2 },
      { minLength: 3, maxLength: 2 },
      { minLength: '1' },
      { maxLength: -1 },
      { pattern: '[' },
      { patternMessage: 'missing' },
      { validator: 'check' },
      { validator: 'check($for:missing)' },
    ]) {
      expect(() =>
        compileUI(
          { format: 'json', version: 1, root: { type: 'input', name: 'q', ...extra } },
          options,
        ),
      ).toThrow();
    }
    const generated = compileUI(
      {
        format: 'json',
        version: 1,
        root: { type: 'textarea', minLength: 1, validator: 'check($this)' },
      },
      options,
    );
    expect(generated.fields).toHaveLength(1);
    expect(generated.events).toHaveLength(2);
    const bound = compileUI(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'setting',
          config: 'some.key',
          label: '密码',
          control: 'password',
          minLength: 2,
          maxLength: 8,
          pattern: '[a-z]+',
          patternMessage: '小写字母',
          validator: 'check($this)',
          placeholder: '密码',
          readonly: true,
        },
      },
      options,
    );
    expect(bound.fields[0].name).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(bound.fields[0].validation?.rules).toMatchObject({ minLength: 2, pattern: '[a-z]+' });
  });
  it('compiles setting groups with accessible captions and rejects ambiguous automatic bindings', () => {
    const root = {
      type: 'group',
      label: '常规',
      description: '组说明',
      footer: '组下方说明',
      children: [
        {
          type: 'setting',
          name: 'setting-limit',
          config: 'app.limit',
          valueType: 'number',
          label: '数量',
          description: '行说明',
          min: 0,
          max: 10,
        },
        {
          type: 'setting',
          label: '勾选',
          children: [{ type: 'checkbox', name: 'check', checked: false }],
        },
      ],
    };
    const result = compileUI({ format: 'json', version: 1, root }, options);
    const all = result.nodes.flatMap(function visit(node): typeof result.nodes {
      return [node, ...(node.children ?? []).flatMap(visit)];
    });
    const field = all.find((node) => node.tag === 'input' && node.attrs?.type === 'number');
    expect(field?.attrs).toMatchObject({ min: '0', max: '10', step: 'any', name: 'setting-limit' });
    expect(
      all.find((node) => node.attrs?.id === field?.attrs?.['aria-labelledby'])?.children?.[0].text,
    ).toBe('数量');
    expect(
      all.find((node) => node.attrs?.id === field?.attrs?.['aria-describedby'])?.children?.[0].text,
    ).toBe('行说明');
    expect(all.some((node) => node.attrs?.class === 'ui-setting ui-setting-checkbox')).toBe(true);
    const bound = root.children[0];
    for (const extra of [
      { children: [] },
      { events: { change: 'save' } },
      { valueType: 'object' },
      { config: '__proto__.x' },
    ]) {
      expect(() =>
        compileUI({ format: 'json', version: 1, root: { ...bound, ...extra } }, options),
      ).toThrow();
    }
  });
  it('expands nested trigger dependencies and rejects static trigger cycles', () => {
    const result = compileUI(
      {
        format: 'html',
        version: 1,
        html: `<input name="q"><button name="parent" onclick="core:event.trigger('child','click')">Parent</button><button name="child" for="q" onclick="save">Child</button>`,
      },
      options,
    );
    expect(result.events[0].capture).toContain('q');
    expect(() =>
      compileUI(
        {
          format: 'html',
          version: 1,
          html: `<button name="cycle" onclick="core:event.trigger('cycle','click')">Cycle</button>`,
        },
        options,
      ),
    ).toThrow('循环');
  });
  it('extracts events before sanitization and captures for/name values without native handlers', () => {
    const content = compileUI(
      {
        format: 'html',
        version: 1,
        html: `<input name="query"><button name="save" for="query" onclick="save($event,123,'abc',$for:query)">保存</button>`,
      },
      options,
    );
    expect(content.events[0].capture).toEqual(['query']);
    expect(content.events[0].for).toEqual(['query']);
    expect(JSON.stringify(content.nodes)).not.toContain('onclick');
    expect(content.events[0].program.branches[0][0].args).toHaveLength(4);
  });
  it('compiles typed JSON placeholders and named field watches', () => {
    const content = compileUI(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            { type: 'input', name: 'q', value: '' },
            { type: 'text', text: '${watch:q()}' },
            { type: 'progress', value: "${core:get('progress')}" },
          ],
        },
      },
      options,
    );
    expect(content.format).toBe('json');
    expect(content.styles).toEqual([]);
    expect(content.expressions).toHaveLength(2);
    expect(content.fields[0].name).toBe('q');
  });
  it('compiles accessible nested JSON tabs and preserves form field ownership', () => {
    const content = compileUI(
      {
        format: 'json',
        version: 1,
        root: {
          type: 'tabs',
          label: '页面信息',
          tabs: [
            { id: 'page', label: '属性', children: [{ type: 'text', text: '页面属性' }] },
            {
              id: 'settings',
              label: '配置',
              children: [
                {
                  type: 'form',
                  name: 'settingsForm',
                  events: { submit: 'save($event)' },
                  children: [
                    {
                      type: 'tabs',
                      label: '配置分组',
                      tabs: [
                        {
                          id: 'general',
                          label: '常规',
                          children: [{ type: 'input', name: 'query', value: '' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      options,
    );
    const all = [...content.nodes];
    for (let index = 0; index < all.length; index++) {
      all.push(...(all[index].children ?? []));
    }
    expect(all.filter((node) => node.attrs?.role === 'tablist')).toHaveLength(2);
    expect(all.filter((node) => node.attrs?.role === 'tab')).toHaveLength(3);
    expect(all.some((node) => node.attrs?.['aria-controls'])).toBe(true);
    expect(content.fields).toEqual([
      expect.objectContaining({ name: 'query', form: 'settingsForm', kind: 'string' }),
    ]);
    expect(content.events).toEqual([expect.objectContaining({ event: 'submit' })]);
    expect(() =>
      compileUI(
        {
          format: 'json',
          version: 1,
          root: {
            type: 'tabs',
            tabs: [
              { id: 'same', label: 'One', children: [] },
              { id: 'same', label: 'Two', children: [] },
            ],
          },
        },
        options,
      ),
    ).toThrow();
  });
  it('removes active content, rejects ambiguous bindings and prevents CSS URL escapes', () => {
    const compiled = compileUI(
      {
        format: 'html',
        version: 1,
        html: '<script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="/assets/a.png" onerror="alert(1)">',
      },
      options,
    );
    expect(JSON.stringify(compiled.nodes)).not.toMatch(/script|iframe|onerror/);
    expect(JSON.stringify(compiled.nodes)).toContain('/gateway/assets/a.png');
    expect(() =>
      compileUI(
        { format: 'html', version: 1, html: '<button onclick="a" data-ui-click="b">x</button>' },
        options,
      ),
    ).toThrow();
    expect(() => compileCSS('p{background:url(https://evil.test/a)}', options.resource)).toThrow();
    expect(() => compileCSS('p{color:var(--untrusted)}', options.resource)).toThrow();
  });
  it('rejects unknown fields, duplicate names, missing associations and cross-domain expressions', () => {
    expect(() =>
      compileUI(
        { format: 'json', version: 1, root: { type: 'text', text: 'x', unsafe: 'y' } },
        options,
      ),
    ).toThrow();
    expect(() =>
      compileUI({ format: 'html', version: 1, html: '<input name="a"><input name="a">' }, options),
    ).toThrow();
    expect(() =>
      compileUI(
        { format: 'html', version: 1, html: '<button for="missing" onclick="a">x</button>' },
        options,
      ),
    ).toThrow();
    expect(() =>
      compileUI({ format: 'html', version: 1, html: '<p>${core:get(ui:value())}</p>' }, options),
    ).toThrow();
  });
});
