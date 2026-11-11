import { describe, expect, it, vi } from 'vitest';
import { DeclarativeUIService } from './declarative-ui.ts';
import { PageSessions } from './page-sessions.ts';
import type { Request } from 'express';
import type { UIWireRegistry, UIValue } from '../../shared/declarative-ui.ts';
import { requireValue } from '../../shared/workbench-protocol.ts';
const registry = (program: string): UIWireRegistry => ({
  handlers: [{ name: 'save', readOnly: false, watch: false, reads: [] }],
  views: [
    {
      surface: 'mainSidebar',
      definition: {
        id: 'test',
        title: 'Test',
        content: {
          format: 'html',
          version: 1,
          html: `<input name="query"><button for="query" onclick="${program}">保存</button>`,
        },
      },
    },
  ],
  mounts: [],
  inspector: false,
});
async function setup(program: string, invoke: (data: Record<string, unknown>) => Promise<unknown>) {
  const service = new DeclarativeUIService();
  await service.install('p', 'epoch', process.cwd(), registry(program), invoke);
  const instance = await service.create({
    pluginId: 'p',
    surface: 'mainSidebar',
    viewId: 'test',
    windowId: 'window',
    workspaceId: 'workspace',
    tabId: null,
    sourceTabId: null,
    sourceFrameEpoch: null,
  });
  return { service, instance };
}
describe('handler execution and page authorization', () => {
  it('blocks invalid template reads and field writes before values reach the frontend', async () => {
    const service = new DeclarativeUIService();
    const invoke = vi.fn(async (data: Record<string, unknown>) => ({
      hasValue: true,
      value:
        data.name === 'check'
          ? { success: (data.args as UIValue[])[0] !== 'blocked', message: '拒绝值' }
          : 'consumed',
    }));
    const snapshot = registry('save');
    snapshot.handlers.push(
      { name: 'check', readOnly: true, watch: false, reads: [] },
      { name: 'read', readOnly: true, watch: false, reads: [] },
    );
    snapshot.views[0].definition.content = {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        children: [
          { type: 'input', name: 'query', minLength: 2, validator: 'check($this)' },
          { type: 'input', name: 'unrelated', validator: 'check($this)' },
          { type: 'text', text: '${read($for:query)}' },
          { type: 'text', text: '${ui:display($for:query)}' },
          { type: 'button', events: { click: 'ui:save($for:query)' } },
          { type: 'button', events: { click: "core:value.write('query','blocked')|save()" } },
        ],
      },
    };
    await service.install('p', 'epoch', process.cwd(), snapshot, invoke);
    try {
      const view = await service.create({
        pluginId: 'p',
        surface: 'mainSidebar',
        viewId: 'test',
        windowId: 'window',
        workspaceId: 'workspace',
        tabId: null,
        sourceTabId: 'source',
        sourceFrameEpoch: 'epoch',
      });
      const invalid = await service.data(view.id, 'window', {
        renderRevision: view.renderRevision,
        fields: { query: 'blocked', unrelated: 'blocked' },
      });
      expect(invalid.updates).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'query', error: '拒绝值' })]),
      );
      expect(invalid.updates.every((update) => !('value' in update) && !('fields' in update))).toBe(
        true,
      );
      expect(invoke.mock.calls.some(([call]) => call.name === 'read')).toBe(false);
      const valid = await service.data(view.id, 'window', {
        renderRevision: view.renderRevision,
        fields: { query: 'allowed', unrelated: 'blocked' },
      });
      expect(valid.updates).toContainEqual(
        expect.objectContaining({ frontend: true, fields: { query: 'allowed' } }),
      );
      const click = view.compiled.events.filter((binding) => binding.event === 'click');
      const result = await service.execute(view.id, 'window', {
        eventId: 'invalid-write',
        renderRevision: view.renderRevision,
        bindingId: click[1].id,
        fields: { query: 'allowed' },
      });
      expect(result).toMatchObject({ status: 'failed', effects: [], error: { field: 'query' } });
      expect(invoke.mock.calls.some(([call]) => call.name === 'save')).toBe(false);
      const blocked = await service.execute(view.id, 'window', {
        eventId: 'no-handoff',
        renderRevision: view.renderRevision,
        bindingId: click[0].id,
        fields: { query: 'blocked' },
      });
      expect(blocked).toMatchObject({ status: 'failed', field: 'query' });
      expect(blocked).not.toHaveProperty('fields');
      await expect(
        service.validateValues(view.id, 'window', {
          renderRevision: view.renderRevision,
          fields: { query: 'blocked' },
        }),
      ).rejects.toMatchObject({ field: 'query' });
      await expect(
        service.validateValues(view.id, 'window', {
          renderRevision: view.renderRevision,
          fields: { query: 'allowed' },
        }),
      ).resolves.toEqual({ validated: true });
    } finally {
      service.releaseOwner('epoch');
    }
  });
  it('keeps dotted menu IDs while generating legal control names', async () => {
    const service = new DeclarativeUIService();
    await service.install(
      'p',
      'epoch',
      process.cwd(),
      {
        handlers: [{ name: 'save', readOnly: false, watch: false, reads: [] }],
        mounts: [],
        inspector: false,
        views: [
          {
            surface: 'statusBar',
            definition: {
              id: 'status',
              ariaLabel: 'Status',
              text: 'Status',
              contextMenu: [
                {
                  kind: 'checkbox',
                  id: 'entry.check',
                  label: 'Check',
                  checked: true,
                  action: 'save',
                },
                { kind: 'item', id: 'entry-check', label: 'Action', action: 'save' },
              ],
            },
          },
        ],
      },
      async () => ({ hasValue: true, value: null }),
    );
    try {
      const instance = await service.create({
        pluginId: 'p',
        surface: 'contextMenu',
        viewId: 'status',
        windowId: 'window',
        workspaceId: 'workspace',
        tabId: null,
        sourceTabId: null,
        sourceFrameEpoch: null,
      });
      expect(instance.compiled.fields[0].name).toMatch(/^menu-[a-f0-9]+$/);
      const nodes = instance.compiled.nodes.flatMap(
        function visit(node): typeof instance.compiled.nodes {
          return [node, ...(node.children ?? []).flatMap(visit)];
        },
      );
      expect(nodes.some((node) => node.key === 'entry.check')).toBe(true);
      expect(nodes.some((node) => node.attrs?.name === 'entry-check')).toBe(true);
    } finally {
      service.releaseOwner('epoch');
    }
  });
  it.each(['mainSidebar', 'auxiliarySidebar', 'tooltip'] as const)(
    'validates values and custom results before any actions in %s',
    async (surface) => {
      const service = new DeclarativeUIService();
      const content: UIValue = {
        format: 'json',
        version: 1,
        root: {
          type: 'stack',
          children: [
            { type: 'input', name: 'other', value: 'abcd' },
            {
              type: 'input',
              name: 'q',
              minLength: 2,
              maxLength: 4,
              pattern: '[a-z]+',
              patternMessage: '小写字母',
              validator: 'check($this,$for:other)',
            },
            { type: 'button', for: 'q', events: { click: 'save($for:q)' } },
          ],
        },
      };
      const invoke = vi.fn(async (data: Record<string, unknown>) => ({
        hasValue: true,
        value:
          data.name === 'check'
            ? { success: (data.args as UIValue[])[0] === 'abcd', message: '必须匹配' }
            : 'saved',
      }));
      await service.install(
        'p',
        'epoch',
        process.cwd(),
        {
          handlers: [
            { name: 'check', readOnly: true, watch: false, reads: [] },
            { name: 'save', readOnly: false, watch: false, reads: [] },
          ],
          views: [
            {
              surface: surface === 'tooltip' ? 'statusBar' : surface,
              definition: {
                id: 'validation',
                title: 'Validation',
                ariaLabel: 'Validation',
                ...(surface === 'tooltip'
                  ? { text: 'Validation', tooltip: { content } }
                  : { content }),
              },
            },
          ],
          mounts: [],
          inspector: false,
        },
        invoke,
      );
      try {
        const instance = await service.create({
          pluginId: 'p',
          surface,
          viewId: 'validation',
          windowId: 'window',
          workspaceId: 'workspace',
          tabId: null,
          sourceTabId: null,
          sourceFrameEpoch: null,
        });
        const send = (value: string) =>
          service.execute(instance.id, 'window', {
            eventId: crypto.randomUUID(),
            bindingId: requireValue(
              instance.compiled.events.find((binding) => binding.event === 'click'),
            ).id,
            renderRevision: instance.renderRevision,
            fields: { q: value, other: 'abcd' },
          });
        await expect(send('A!')).resolves.toMatchObject({
          status: 'failed',
          error: { message: '小写字母' },
        });
        expect(invoke).not.toHaveBeenCalled();
        await expect(send('abc')).resolves.toMatchObject({
          status: 'failed',
          error: { message: '必须匹配' },
        });
        expect(invoke).toHaveBeenLastCalledWith(
          expect.objectContaining({
            name: 'check',
            args: ['abc', 'abcd'],
            context: expect.objectContaining({ invocation: 'render' }),
          }),
        );
        expect(invoke.mock.calls.some(([data]) => data.name === 'save')).toBe(false);
        await expect(send('abcd')).resolves.toMatchObject({ status: 'succeeded', result: 'saved' });
        invoke.mockResolvedValueOnce({ hasValue: true, value: true } as never);
        await expect(send('abcd')).resolves.toMatchObject({
          status: 'failed',
          error: { code: 'UI_INVALID_VALIDATOR_RESULT' },
        });
      } finally {
        service.releaseOwner('epoch');
      }
    },
  );
  it('requires frontend validation acknowledgement before running a backend action', async () => {
    const service = new DeclarativeUIService(),
      invoke = vi.fn(async () => ({ hasValue: true, value: 'saved' }));
    const snapshot = registry('save');
    snapshot.views[0].definition.content = {
      format: 'json',
      version: 1,
      root: {
        type: 'stack',
        children: [
          { type: 'input', name: 'query', validator: 'ui:check($this)' },
          { type: 'button', for: 'query', events: { click: 'save' } },
        ],
      },
    };
    await service.install('p', 'epoch', process.cwd(), snapshot, invoke);
    try {
      const instance = await service.create({
        pluginId: 'p',
        surface: 'mainSidebar',
        viewId: 'test',
        windowId: 'window',
        workspaceId: 'workspace',
        tabId: null,
        sourceTabId: 'source',
        sourceFrameEpoch: 'document',
      });
      const response = (await service.execute(instance.id, 'window', {
        eventId: 'validator',
        bindingId: 'e0',
        renderRevision: instance.renderRevision,
        fields: { query: 'value' },
      })) as {
        status: string;
        continuation: string;
        branches: { readOnly: boolean; validationField: string }[][];
      };
      expect(response.status).toBe('frontend');
      expect(response.branches[0][0]).toMatchObject({ readOnly: true, validationField: 'query' });
      expect(invoke).not.toHaveBeenCalled();
      await expect(
        service.continueEvent(instance.id, 'window', response.continuation, false),
      ).resolves.toMatchObject({ status: 'failed' });
      expect(invoke).not.toHaveBeenCalled();
    } finally {
      service.releaseOwner('epoch');
    }
  });
  it('rejects hiding page information without a valid template, including direct registry updates', async () => {
    const service = new DeclarativeUIService();
    const invalidContents: UIValue[] = [null, {}, { format: 'text', text: 'not a template' }];
    for (const content of invalidContents) {
      await expect(
        service.install(
          'p',
          'epoch',
          process.cwd(),
          {
            handlers: [],
            mounts: [],
            inspector: false,
            views: [
              {
                surface: 'auxiliarySidebar',
                definition: { id: 'details', title: 'Details', hideCurrentPage: true, content },
              },
            ],
          },
          async () => null,
        ),
      ).rejects.toThrow('必须提供 JSON 或 HTML 模板');
    }
    expect(service.registry('window').items).toHaveLength(0);
  });
  it('commits completed branches and discards effects from a failed branch', async () => {
    const { service, instance } = await setup(
      "core:value.write('query','first'),core:value.write('query','discard')|save($prev)",
      async () => {
        throw Error('private backend details');
      },
    );
    const response = (await service.execute(instance.id, 'window', {
      eventId: 'partial',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: 'initial' },
    })) as { status: string; effects: { args: unknown[] }[]; error: { message: string } };
    expect(response.status).toBe('partial');
    expect(response.effects.map((effect) => effect.args[1])).toEqual(['first']);
    expect(response.error.message).not.toContain('private');
    service.releaseOwner('epoch');
  });
  it('consumes frontend phase acknowledgements once before continuing backend branches', async () => {
    let calls = 0;
    let finish: () => void = () => {
      /* Replaced when the backend begins. */
    };
    const service = new DeclarativeUIService();
    await service.install(
      'p',
      'epoch',
      process.cwd(),
      registry('ui:select($event),save($event)'),
      async () => {
        calls++;
        await new Promise<void>((resolve) => (finish = resolve));
        return { hasValue: true, value: 'done' };
      },
    );
    const instance = await service.create({
      pluginId: 'p',
      surface: 'mainSidebar',
      viewId: 'test',
      windowId: 'window',
      workspaceId: 'workspace',
      tabId: null,
      sourceTabId: 'source',
      sourceFrameEpoch: 'document',
    });
    const response = (await service.execute(instance.id, 'window', {
      eventId: 'mixed',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: 'initial' },
    })) as { status: string; continuation: string };
    expect(response.status).toBe('frontend');
    const first = service.continueEvent(instance.id, 'window', response.continuation, true),
      duplicate = service.continueEvent(instance.id, 'window', response.continuation, true);
    expect(first).toBe(duplicate);
    await expect.poll(() => calls).toBe(1);
    finish();
    expect(await first).toMatchObject({ status: 'succeeded', result: 'done' });
    expect(await duplicate).toMatchObject({ status: 'succeeded' });
    service.releaseOwner('epoch');
  });
  it('passes filtered augmented events, supports explicit arguments and deduplicates effects', async () => {
    let calls = 0;
    const { service, instance } = await setup('save', async (data) => {
      calls++;
      return { hasValue: true, value: (data.args as UIValue[])[0] };
    });
    const body = {
      eventId: 'one',
      renderRevision: instance.renderRevision,
      bindingId: instance.compiled.events[0].id,
      fields: { query: { value: 'abc', editSequence: 1 } },
      event: { type: 'forged', modifiers: { alt: false, ctrl: true, meta: false, shift: false } },
    };
    const first = (await service.execute(instance.id, 'window', body)) as {
      result: { type: string; value: string; values: unknown };
    };
    expect(first.result).toMatchObject({ type: 'click', value: 'abc', values: { query: 'abc' } });
    await service.execute(instance.id, 'window', body);
    expect(calls).toBe(1);
    expect(() =>
      service.execute(instance.id, 'window', {
        ...body,
        fields: { query: { value: 'different', editSequence: 1 } },
      }),
    ).toThrow('冲突');
    expect(() => service.get(instance.id, 'other')).toThrow();
    service.releaseOwner('epoch');
    expect(() => service.get(instance.id, 'window')).toThrow();
  });
  it('uses positional parameters and previous results entirely in the backend', async () => {
    let args: unknown;
    const { service, instance } = await setup(
      "core:string.trim($for:query)|save($prev,123,'abc')",
      async (data) => {
        args = data.args;
        return { hasValue: true, value: null };
      },
    );
    await service.execute(instance.id, 'window', {
      eventId: 'two',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: '  term  ' },
    });
    expect(args).toEqual(['term', 123, 'abc']);
    service.releaseOwner('epoch');
  });
  it('returns the exact unavailable message for a frontend branch without borrowing another tab', async () => {
    const { service, instance } = await setup('ui:save($event)', async () => {
      throw Error('must not call backend');
    });
    const result = await service.execute(instance.id, 'window', {
      eventId: 'front',
      renderRevision: instance.renderRevision,
      bindingId: 'e0',
      fields: { query: 'x' },
    });
    expect(result).toMatchObject({ status: 'unavailable', result: '<无数据，需要打开插件页面>' });
    service.releaseOwner('epoch');
  });
  it('permits only the exact read configuration route for page grants', () => {
    const sessions = new PageSessions();
    const page = sessions.create({
      pluginId: 'p',
      safeId: 'safe',
      tabId: 'tab',
      frameEpoch: 'epoch',
      owner: 'window',
      origin: 'http://localhost',
    });
    const req = (method: string, path: string) =>
      ({ method, path, headers: { authorization: 'Bearer ' + page.grant } }) as Request;
    expect(sessions.authorize(req('GET', '/web/api/workbench/plugins/p/config'), page.origin)).toBe(
      page,
    );
    for (const suffix of ['', '/update', '/reset', '/definitions', '/validation']) {
      expect(() =>
        sessions.authorize(
          req('POST', '/web/api/workbench/plugins/p/config' + suffix),
          page.origin,
        ),
      ).toThrow();
    }
    expect(() =>
      sessions.authorize(req('GET', '/web/api/workbench/plugins/other/config'), page.origin),
    ).toThrow();
  });
});
