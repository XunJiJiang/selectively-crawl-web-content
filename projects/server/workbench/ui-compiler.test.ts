import { describe, expect, it } from 'vitest';
import { compileUI, compileCSS } from './ui-compiler.ts';
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
  it('expands nested trigger dependencies and rejects static trigger cycles',()=>{
    const result=compileUI({format:'html',version:1,html:`<input name="q"><button name="parent" onclick="core:event.trigger('child','click')">Parent</button><button name="child" for="q" onclick="save">Child</button>`},options);
    expect(result.events[0].capture).toContain('q');
    expect(()=>compileUI({format:'html',version:1,html:`<button name="cycle" onclick="core:event.trigger('cycle','click')">Cycle</button>`},options)).toThrow('循环');
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
