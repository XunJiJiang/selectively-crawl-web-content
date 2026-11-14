import { uiRequired, uiValue } from '../../shared/declarative-ui.ts';
import { describe, expect, it, vi } from 'vitest';
import { compileUI } from './ui-compiler.ts';
import { compileTree, compileTreeRow } from '../../shared/tree-compiler.ts';
import {
  TreeDataStore,
  matchTreeText,
  normalizeTreeMove,
  selectTreeRows,
  visibleTreeRows,
} from '../../shared/tree-model.ts';
import { TreeSession } from '../../shared/tree-session.ts';
import { evaluateArgument, parseProgram } from '../../shared/ui-expressions.ts';
import type { TreeRequest, UITreeNode, TreeViewState } from '../../shared/tree.ts';

const options = {
  resource: () => {
    throw new Error('resource denied');
  },
  validateCall: (_name: string, _readonly: boolean, _watch: boolean) => undefined,
};
const declaration = (extra: Partial<UITreeNode> = {}): UITreeNode => ({
  type: 'tree',
  name: 'files',
  label: 'Files',
  nodes: [
    {
      id: 'folder',
      label: 'src',
      children: [
        { id: 'a', label: 'alpha.ts' },
        { id: 'b', label: 'beta.ts' },
      ],
    },
    { id: 'empty', label: 'Empty', children: [] },
  ],
  ...extra,
});
function session(extra: Partial<UITreeNode> = {}) {
  return new TreeSession(compileTree(declaration(extra), options), options);
}
function request(tree: TreeSession, body: Record<string, unknown>): TreeRequest {
  return {
    instanceId: 'i',
    renderRevision: 1,
    treeId: tree.definition.treeId,
    dataEpoch: tree.definition.dataEpoch,
    requestId: crypto.randomUUID(),
    ...body,
  } as TreeRequest;
}
const execution = { fields: {}, invoke: vi.fn(async () => undefined) };
describe('tree authority and state', () => {
  it('compiles one controlled host, an adapter field, safe bindings and no business SafeNodes', () => {
    const model = compileUI(
      {
        format: 'json',
        version: 1,
        root: declaration({
          selectionMode: 'multiple',
          value: ['a'],
          nodeEvents: { click: 'record|record()' },
        }),
      },
      options,
    );
    expect(model.nodes).toHaveLength(1);
    expect(model.nodes[0].tag).toBe('div');
    expect(model.fields).toMatchObject([{ name: 'files', kind: 'multiple' }]);
    expect(model.trees?.[0].bindings[0].program.branches[0].map((call) => call.args)).toEqual([
      [{ type: 'event' }],
      [],
    ]);
    expect(() =>
      compileUI(
        {
          format: 'json',
          version: 1,
          root: { type: 'button', events: { click: 'record($tree)' } },
        },
        options,
      ),
    ).toThrow('$tree');
    expect(() => compileTree(declaration({ value: 'missing' }), options)).toThrow('resolvePath');
  });
  it('distinguishes unknown branches, known empty children and incomplete pages', () => {
    const tree = session({
      nodes: [
        { id: 'unknown', label: 'Unknown', hasChildren: true },
        { id: 'empty', label: 'Empty', children: [] },
      ],
    });
    expect(tree.store.children.get('unknown')?.status).toBe('unloaded');
    expect(tree.store.children.get('empty')).toMatchObject({ status: 'loaded', complete: true });
    expect(() =>
      tree.store.replace(
        null,
        [
          { id: 'dup', label: 'A' },
          { id: 'dup', label: 'B' },
        ],
        null,
        true,
      ),
    ).toThrow();
    expect(tree.store.nodes.has('unknown')).toBe(true);
  });
  it('keeps selection, focus and expansion independent, applies range gestures and searches loaded collapsed children', () => {
    const tree = session({ selectionMode: 'multiple' });
    const state: TreeViewState = {
      selectedIds: new Set(),
      expandedIds: new Set(['folder']),
      focusedId: null,
      rangeAnchorId: null,
      query: '',
    };
    let rows = visibleTreeRows(tree.store, state, tree.definition.options);
    selectTreeRows(tree.store, state, rows, 'a', tree.definition.options);
    selectTreeRows(tree.store, state, rows, 'b', tree.definition.options, { shift: true });
    expect([...state.selectedIds]).toEqual(['a', 'b']);
    state.expandedIds.clear();
    state.query = 'alp';
    rows = visibleTreeRows(tree.store, state, tree.definition.options);
    expect(rows.map((row) => row.id)).toEqual(['folder', 'a']);
    expect([...state.expandedIds]).toEqual([]);
    expect(matchTreeText('Alpha.ts', 'AT')).toEqual([
      [0, 1],
      [6, 7],
    ]);
  });
  it('uses real anchors, deduplicates descendants and rejects cycles, readonly ancestry and incomplete targets', () => {
    const tree = session({ dragDrop: { mode: 'reparent' }, selectionMode: 'multiple' });
    expect(
      normalizeTreeMove(tree.store, ['a', 'folder'], null, 'empty', tree.definition.options)
        .sourceIds,
    ).toEqual(['folder']);
    expect(() =>
      normalizeTreeMove(tree.store, ['folder'], 'folder', null, tree.definition.options),
    ).toThrow('自身');
    expect(() => normalizeTreeMove(tree.store, ['a'], null, 'b', tree.definition.options)).toThrow(
      '锚点',
    );
    uiRequired(tree.store.nodes.get('folder')).item.readonly = true;
    expect(() => normalizeTreeMove(tree.store, ['a'], null, null, tree.definition.options)).toThrow(
      '来源',
    );
  });
  it('rejects pagination version changes and duplicate IDs without partially installing data', async () => {
    const tree = session({ nodes: undefined, loadChildren: 'children($tree)' });
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ id: 'one', label: 'One' }],
        nextCursor: 'next',
        version: 'v1',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'two', label: 'Two' }],
        nextCursor: null,
        version: 'v2',
      })
      .mockResolvedValueOnce({
        items: [{ id: 'one', label: 'Duplicate' }],
        nextCursor: null,
        version: 'v1',
      });
    await tree.request(
      request(tree, { kind: 'children', parentId: null, generation: 1, cursor: null }),
      { fields: {}, invoke },
    );
    expect(tree.store.children.get(null)).toMatchObject({ complete: false, nextCursor: 'next' });
    expect(
      (
        await tree.request(
          request(tree, { kind: 'children', parentId: null, generation: 2, cursor: 'next' }),
          { fields: {}, invoke },
        )
      ).error?.code,
    ).toBe('TREE_VERSION_CONFLICT');
    expect(
      (
        await tree.request(
          request(tree, { kind: 'children', parentId: null, generation: 3, cursor: 'next' }),
          { fields: {}, invoke },
        )
      ).error?.code,
    ).toBe('TREE_DUPLICATE_ID');
    expect([...tree.store.nodes.keys()]).toEqual(['one']);
  });
  it('discards cancelled reads and old generations while independent branches complete', async () => {
    const tree = session({
      nodes: [
        { id: 'x', label: 'X', hasChildren: true },
        { id: 'y', label: 'Y', hasChildren: true },
      ],
      loadChildren: 'children($tree)',
    });
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(async (_call, args) =>
      (args[0] as { parent: { id: string } }).parent.id === 'x'
        ? await new Promise((resolve) => {
            finish = resolve;
          })
        : { items: [{ id: 'yy', label: 'YY' }], nextCursor: null, version: '1' },
    );
    const first = request(tree, { kind: 'children', parentId: 'x', generation: 1, cursor: null });
    const pending = tree.request(first, { fields: {}, invoke: invoke as never });
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    await tree.request(
      request(tree, { kind: 'cancel', targetRequestId: first.requestId }),
      execution,
    );
    await tree.request(
      request(tree, { kind: 'children', parentId: 'y', generation: 1, cursor: null }),
      { fields: {}, invoke: invoke as never },
    );
    finish({ items: [{ id: 'xx', label: 'XX' }], nextCursor: null, version: '1' });
    expect((await pending).error?.code).toBe('TREE_CANCELLED');
    expect(tree.store.nodes.has('xx')).toBe(false);
    expect(tree.store.nodes.has('yy')).toBe(true);
  });
  it('registers dynamic actions, rejects arbitrary programs and enforces readonly business events', async () => {
    const tree = session({
      renderNode: 'render($tree)',
      readonly: true,
      nodeEvents: { click: 'write' },
    });
    const guard = new TreeSession(tree.definition, {
      ...options,
      validateCall: (name, readonly) => {
        if (readonly && name === 'write') {
          throw new Error('not readonly');
        }
      },
    });
    expect(() =>
      guard.event(
        {
          treeId: guard.definition.treeId,
          dataEpoch: guard.definition.dataEpoch,
          nodeId: 'a',
          type: 'click',
          selectedIds: [],
          focusedId: 'a',
          reason: 'pointer',
        },
        uiRequired(guard.definition.defaults.click),
      ),
    ).toThrow('not readonly');
    expect(() =>
      compileTreeRow({ content: [{ type: 'html', text: '<script>' }] }, tree.definition, options),
    ).toThrow();
    const response = await tree.request(
      request(tree, { kind: 'render', nodes: [{ id: 'a', revision: 1 }] }),
      {
        fields: {},
        invoke: async () => ({
          content: [{ type: 'text', text: 'Safe' }],
          actions: [
            {
              id: 'open',
              label: 'Open',
              icon: { kind: 'builtin', name: 'file' },
              events: { click: 'read' },
            },
          ],
        }),
      },
    );
    expect(response.rows?.[0].view.actions?.[0].events).toBeUndefined();
    expect(response.rows?.[0].view.actions?.[0].bindingId).toBeTypeOf('string');
    expect(() =>
      tree.event(
        {
          treeId: tree.definition.treeId,
          dataEpoch: tree.definition.dataEpoch,
          nodeId: 'a',
          type: 'action',
          actionId: 'evil',
          selectedIds: [],
          focusedId: 'a',
          reason: 'pointer',
        },
        'write()',
      ),
    ).toThrow();
  });
  it('persists dynamic moves once per operationId and reports saved before any refresh', async () => {
    const tree = session({
      dragDrop: { mode: 'reparent', move: 'move($tree)' },
      loadChildren: 'children($tree)',
    });
    tree.store.version = 'v1';
    const invoke = vi.fn(async () => ({ accepted: true, version: 'v2', invalidateParents: [] }));
    const first = request(tree, {
      kind: 'command',
      operationId: 'op',
      command: {
        type: 'move',
        sourceIds: ['a', 'b'],
        targetParentId: null,
        beforeId: 'empty',
        expectedVersion: 'v1',
      },
    });
    const result = await tree.request(first, { fields: {}, invoke });
    expect(result).toMatchObject({
      saved: true,
      accepted: true,
      message: '移动已保存，列表待刷新',
    });
    expect(
      (await tree.request({ ...first, requestId: 'again' }, { fields: {}, invoke })).saved,
    ).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
  it('retains existing bare, explicit zero argument and pipe event semantics with $tree scoped arguments', async () => {
    const program = parseProgram('handler|handler()|handler($prev,$tree)', true),
      calls: unknown[] = [];
    let prev;
    for (const call of program.branches[0]) {
      prev = await evaluateArgument(call, {
        fields: {},
        event: { original: true },
        tree: { node: 'a' },
        prev,
        invoke: async (_call, args) => {
          calls.push(args);
          return 'last';
        },
      });
    }
    expect(calls).toEqual([[{ original: true }], [], ['last', { node: 'a' }]]);
    expect(() => parseProgram('handler($tree.node.id)', true)).toThrow();
    expect(() => parseProgram('handler|ui:handler', true)).toThrow('前后端');
  });
  it('rejects cycles and quotas in atomic patches', () => {
    const store = new TreeDataStore('epoch', [{ id: 'a', label: 'A' }]);
    expect(() =>
      store.apply({
        upsert: [{ item: { id: 'b', label: 'B' }, childIds: [], parentId: 'b', nodeRevision: 1 }],
      }),
    ).toThrow();
    expect(store.nodes.has('b')).toBe(false);
  });
  it('preserves loaded children and selection through a same-version parent refresh', async () => {
    const tree = session({ loadChildren: 'children($tree)', value: 'a' });
    tree.store.version = 'v1';
    const result = await tree.request(
      request(tree, {
        kind: 'children',
        parentId: null,
        generation: 1,
        cursor: null,
        refresh: true,
      }),
      {
        fields: {},
        invoke: async () =>
          uiValue({
            items: [
              { id: 'folder', label: 'renamed', hasChildren: true },
              { id: 'empty', label: 'Empty', children: [] },
            ],
            nextCursor: null,
            version: 'v1',
          }),
      },
    );
    expect(result.error).toBeUndefined();
    expect(tree.store.nodes.get('a')?.parentId).toBe('folder');
    expect(tree.value).toBe('a');
  });
  it('finishes cancelled reads promptly even when the provider ignores its signal', async () => {
    const tree = session({ nodes: undefined, loadChildren: 'children($tree)' });
    const first = request(tree, { kind: 'children', parentId: null, generation: 1, cursor: null });
    const pending = tree.request(first, {
      fields: {},
      invoke: async () =>
        new Promise(() => {
          /* Intentionally empty fixture callback. */
        }),
    });
    await tree.request(
      request(tree, { kind: 'cancel', targetRequestId: first.requestId }),
      execution,
    );
    expect((await pending).error?.code).toBe('TREE_CANCELLED');
    expect(tree.pendingCount).toBe(0);
  });
  it('keeps both action registrations when independent row batches finish concurrently', async () => {
    const tree = session({ renderNode: 'render($tree)' });
    const invoke = async (_call: unknown, args: unknown[]) => {
      const { node } = args[0] as { node: { id: string } };
      await new Promise((resolve) => setTimeout(resolve, node.id === 'a' ? 5 : 1));
      return {
        content: [{ type: 'text', text: node.id }],
        actions: [
          {
            id: 'open',
            label: 'Open',
            icon: { kind: 'builtin', name: 'file' },
            events: { click: `open('${node.id}')` },
          },
        ],
      };
    };
    const replies = await Promise.all(
      ['a', 'b'].map((id) =>
        tree.request(request(tree, { kind: 'render', nodes: [{ id, revision: 1 }] }), {
          fields: {},
          invoke: invoke as never,
        }),
      ),
    );
    for (const reply of replies) {
      const row = uiRequired(reply.rows)[0],
        binding = uiRequired(uiRequired(row.view.actions)[0].bindingId);
      expect(tree.definition.bindings.some((item) => item.id === binding)).toBe(true);
    }
  });
  it('resolves a programmatic selection without selecting or focusing the resolved path', async () => {
    const tree = session({
      nodes: undefined,
      loadChildren: 'load($tree)',
      resolvePath: 'path($tree)',
    });
    const patches = await tree.prepareSelection(
      'leaf',
      { instanceId: 'i', renderRevision: 1 },
      {
        fields: {},
        invoke: async () =>
          uiValue({
            path: [
              { id: 'root', label: 'Root', hasChildren: true },
              { id: 'leaf', label: 'Leaf' },
            ],
            version: 'static:0',
          }),
      },
    );
    expect(patches).toHaveLength(1);
    expect(tree.value).toBe('');
    tree.validateSelection('leaf', true);
    expect(tree.value).toBe('leaf');
  });
  it('releases an inactive complete branch before exceeding the node quota', async () => {
    const tree = session({
      nodes: [
        { id: 'cold', label: 'Cold', hasChildren: true },
        { id: 'hot', label: 'Hot', hasChildren: true },
      ],
      loadChildren: 'load($tree)',
    });
    tree.store.replace(
      'cold',
      Array.from({ length: 9900 }, (_, index) => ({ id: `c${index}`, label: 'C' })),
      null,
      true,
    );
    const result = await tree.request(
      request(tree, {
        kind: 'children',
        parentId: 'hot',
        cursor: null,
        generation: 1,
        viewState: { expandedIds: ['hot'], selectedIds: [], focusedId: 'hot' },
      }),
      {
        fields: {},
        invoke: async () => ({
          items: Array.from({ length: 200 }, (_, index) => ({ id: `h${index}`, label: 'H' })),
          nextCursor: null,
          version: 'v1',
        }),
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.patch?.remove).toHaveLength(9900);
    expect(tree.store.children.get('cold')?.status).toBe('unloaded');
    expect(tree.store.nodes.size).toBe(202);
  });
});
