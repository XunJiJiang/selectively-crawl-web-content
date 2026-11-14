import { uiRequired } from '../../shared/declarative-ui.ts';
import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DeclarativeUIService } from './declarative-ui.ts';
import { ScriptUIRuntime } from '../user-script/ui.ts';
import { TreeDemoProvider, treeDemoContent } from '../plugins/template/tree-ui.ts';
import type { ScriptConfigV2, ScriptContext } from '../../shared/script-ui.ts';
import type { UIValue, UIWireRegistry } from '../../shared/declarative-ui.ts';
import type { TreeRequest } from '../../shared/tree.ts';

const context: ScriptContext = {
  version: 'v2',
  site: {
    url: 'https://example.com/tree',
    rootUrl: 'https://example.com',
    origin: 'https://example.com',
    pathname: '/tree',
    host: 'example.com',
    hostname: 'example.com',
  },
  data: [],
  values: {},
  logger: {} as SCWC.TLogger,
};
const source = {
  format: 'json' as const,
  version: 1 as const,
  root: { type: 'stack', children: treeDemoContent() },
};
it('persists demo moves and operation receipts across provider recreation', async () => {
  const dir = await fs.mkdtemp(path.join(process.cwd(), 'node_modules/.tmp/tree-persist-'));
  try {
    const file = path.join(dir, 'order.json');
    const move = {
      treeName: 'files',
      requestId: 'r',
      dataEpoch: 'e',
      kind: 'move',
      operationId: 'once',
      sourceIds: ['file-1'],
      targetId: 'docs',
      position: 'inside',
      targetParentId: 'docs',
      beforeId: null,
      expectedVersion: '1',
    };
    const first = new TreeDemoProvider(file).handlers();
    const accepted = await first['tree.move'].run.apply({}, [move] as never);
    expect(accepted).toMatchObject({ accepted: true, version: '2' });
    const second = new TreeDemoProvider(file).handlers();
    expect(await second['tree.move'].run.apply({}, [move] as never)).toEqual(accepted);
    const page = await second['tree.children'].run.apply({}, [
      {
        treeName: 'files',
        requestId: 'read',
        dataEpoch: 'e',
        kind: 'children',
        parent: { id: 'docs' },
        cursor: null,
        limit: 200,
        version: '2',
      },
    ] as never);
    expect(page).toMatchObject({ items: [{ id: 'file-1' }], version: '2' });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
it('retains an unchanged script tree cache on refresh and retires the old instance', async () => {
  const runtime = new ScriptUIRuntime();
  const config: ScriptConfigV2 = {
    version: 'v2',
    title: 'Tree',
    content: source,
    handlers: new TreeDemoProvider().handlers(),
  };
  const first = await runtime.render(config, context);
  const second = await runtime.render(config, { ...context, previousInstanceId: first.instanceId });
  expect(uiRequired(second.compiled.trees)[0].dataEpoch).toBe(
    uiRequired(first.compiled.trees)[0].dataEpoch,
  );
  await expect(
    runtime.event(
      {
        version: 'v2',
        instanceId: first.instanceId,
        eventId: 'old',
        bindingId: '$read',
        readOnly: true,
        fields: {},
      },
      context,
    ),
  ).rejects.toThrow('过期');
  config.handlers = new TreeDemoProvider().handlers();
  await expect(
    runtime.event(
      {
        version: 'v2',
        instanceId: second.instanceId,
        eventId: 'changed',
        bindingId: '$read',
        readOnly: true,
        fields: {},
      },
      context,
    ),
  ).rejects.toThrow('注册已变化');
});
it('runs the template provider through real script compilation, root paging, custom actions, selection and field reads', async () => {
  const handlers = new TreeDemoProvider().handlers();
  const config: ScriptConfigV2 = { version: 'v2', title: 'Tree', content: source, handlers };
  const runtime = new ScriptUIRuntime(),
    model = await runtime.render(config, context);
  expect(model.compiled.trees).toHaveLength(5);
  const tree = uiRequired(
    uiRequired(model.compiled.trees).find((tree) => tree.name === 'dynamicFiles'),
  );
  const base = {
    instanceId: model.instanceId,
    renderRevision: 1,
    treeId: tree.treeId,
    dataEpoch: tree.dataEpoch,
  };
  const send = async (body: object) =>
    runtime.event(
      {
        version: 'v2',
        instanceId: model.instanceId,
        eventId: crypto.randomUUID(),
        bindingId: '$tree',
        readOnly: true,
        fields: {},
        treeRequest: { ...base, requestId: crypto.randomUUID(), ...body } as TreeRequest,
      },
      context,
    );
  const root = uiRequired(
    (await send({ kind: 'children', parentId: null, cursor: null, generation: 1 })).treeResponse,
  );
  expect(root.error).toBeUndefined();
  expect(root.patch?.upsert?.some((record) => record.item.id === 'source')).toBe(true);
  const page = uiRequired(
    (await send({ kind: 'children', parentId: 'source', cursor: null, generation: 1 }))
      .treeResponse,
  );
  expect(page.patch?.lists?.find(([id]) => id === 'source')?.[1]).toMatchObject({
    complete: false,
    nextCursor: '120',
  });
  const record = uiRequired(
    uiRequired(uiRequired(page.patch).upsert).find((record) => record.item.id === 'file-1'),
  );
  const rendered = uiRequired(
    (await send({ kind: 'render', nodes: [{ id: record.item.id, revision: record.nodeRevision }] }))
      .treeResponse,
  );
  expect(rendered.error).toBeUndefined();
  const action = uiRequired(uiRequired(rendered.rows)[0].view.actions)[0];
  const result = await runtime.event(
    {
      version: 'v2',
      instanceId: model.instanceId,
      eventId: 'select-and-action',
      bindingId: uiRequired(action.bindingId),
      fields: { dynamicFiles: { value: ['file-1'], editSequence: 1 } },
      tree: {
        treeId: tree.treeId,
        dataEpoch: tree.dataEpoch,
        type: 'action',
        actionId: action.id,
        nodeId: 'file-1',
        focusedId: 'file-1',
        selectedIds: ['file-1'],
        reason: 'pointer',
      },
    },
    context,
  );
  expect(result.result).toMatchObject({ type: 'notification' });
  await expect(
    runtime.event(
      {
        version: 'v2',
        instanceId: model.instanceId,
        eventId: 'foreign',
        bindingId: uiRequired(action.bindingId),
        fields: {},
        tree: {
          treeId: tree.treeId,
          dataEpoch: tree.dataEpoch,
          type: 'action',
          actionId: action.id,
          nodeId: 'source',
          focusedId: 'source',
          selectedIds: [],
          reason: 'pointer',
        },
      },
      context,
    ),
  ).rejects.toThrow();
  await expect(
    runtime.event(
      {
        version: 'v2',
        instanceId: model.instanceId,
        eventId: 'wrong-site',
        bindingId: '$read',
        readOnly: true,
        fields: {},
      },
      { ...context, site: { ...context.site, url: 'https://other.example/tree' } },
    ),
  ).rejects.toThrow('过期');
});
it('shares backend semantics in workbench and refuses readonly/disabled forgeries and arbitrary bindings', async () => {
  const service = new DeclarativeUIService(),
    handlers = new TreeDemoProvider().handlers(),
    invoked = vi.fn(async (request: Record<string, unknown>) => {
      const handler = handlers[String(request.name)];
      return {
        hasValue: true,
        value: await handler.run.apply(
          { signal: new AbortController().signal } as never,
          request.args as UIValue[],
        ),
      };
    });
  const registry: UIWireRegistry = {
    handlers: Object.entries(handlers).map(([name, handler]) => ({
      name,
      readOnly: handler.readOnly === true,
      reads: [],
      watch: false,
    })),
    views: [
      {
        surface: 'mainSidebar',
        definition: { id: 'tree-demo', title: 'Tree', content: source as unknown as UIValue },
      },
    ],
    mounts: [],
    inspector: false,
  };
  await service.install('p', 'owner', process.cwd(), registry, invoked);
  const instance = await service.create({
    pluginId: 'p',
    surface: 'mainSidebar',
    viewId: 'tree-demo',
    windowId: 'window',
    workspaceId: 'workspace',
    tabId: null,
    sourceTabId: null,
    sourceFrameEpoch: null,
  });
  try {
    const tree = uiRequired(
      uiRequired(instance.compiled.trees).find((tree) => tree.name === 'dynamicFiles'),
    );
    const envelope = {
      instanceId: instance.id,
      renderRevision: instance.renderRevision,
      treeId: tree.treeId,
      dataEpoch: tree.dataEpoch,
    };
    const root = (await service.tree(instance.id, 'window', {
      ...envelope,
      requestId: 'root',
      kind: 'children',
      parentId: null,
      generation: 1,
      cursor: null,
    })) as { treeResponse: { error?: unknown } };
    expect(root.treeResponse.error).toBeUndefined();
    const readonly = uiRequired(
      uiRequired(instance.compiled.trees).find((tree) => tree.name === 'readonlyFile'),
    );
    expect(() =>
      service.execute(instance.id, 'window', {
        eventId: 'forged-selection',
        bindingId: uiRequired(readonly.defaults.click),
        renderRevision: instance.renderRevision,
        fields: { readonlyFile: { value: 'static-config' } },
        tree: {
          treeId: readonly.treeId,
          dataEpoch: readonly.dataEpoch,
          type: 'click',
          nodeId: 'static-config',
          selectedIds: ['static-config'],
          focusedId: 'static-config',
          reason: 'pointer',
        },
      }),
    ).toThrow('只读');
    const disabled = uiRequired(
      uiRequired(instance.compiled.trees).find((tree) => tree.name === 'disabledFile'),
    );
    expect(() =>
      service.execute(instance.id, 'window', {
        eventId: 'forged-disabled',
        bindingId: '$state',
        renderRevision: instance.renderRevision,
        fields: {},
        tree: {
          treeId: disabled.treeId,
          dataEpoch: disabled.dataEpoch,
          type: 'click',
          nodeId: 'static-src',
          selectedIds: [],
          focusedId: 'static-src',
          reason: 'pointer',
        },
      }),
    ).toThrow('禁用');
    service.release(instance.id);
    await expect(
      service.tree(instance.id, 'window', {
        ...envelope,
        requestId: 'late',
        kind: 'children',
        parentId: null,
        generation: 2,
        cursor: null,
      }),
    ).rejects.toThrow('不存在');
  } finally {
    service.release(instance.id);
  }
});
