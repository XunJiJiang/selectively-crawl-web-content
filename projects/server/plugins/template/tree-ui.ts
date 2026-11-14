import { uiRequired } from '../../../shared/declarative-ui.ts';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { HandlerDefinition, UIValue, UINode } from '../../../shared/declarative-ui.ts';
import type {
  TreeControllerContext,
  TreeItem,
  TreeMoveResult,
  TreeRowView,
} from '../../../shared/tree.ts';
import { TreeDataStore, normalizeTreeMove } from '../../../shared/tree-model.ts';

/** This provider is shared by workbench and script handlers in the actual plugin process. */
export class TreeDemoProvider {
  private version = 1;
  private roots: TreeItem[] = [
    {
      id: 'source',
      label: 'src',
      description: '分页数据 / 支持跨目录移动',
      hasChildren: true,
      icon: { kind: 'builtin', name: 'folder' },
    },
    {
      id: 'docs',
      label: 'docs',
      description: '空目录可接收移动',
      hasChildren: true,
      icon: { kind: 'builtin', name: 'folder' },
    },
    {
      id: 'retry',
      label: '加载错误与重试',
      hasChildren: true,
      icon: { kind: 'builtin', name: 'warning' },
    },
    {
      id: 'readonly',
      label: '只读目录',
      readonly: true,
      children: [{ id: 'readonly-note', label: 'README.md' }],
    },
    {
      id: 'disabled',
      label: '禁用目录',
      disabled: true,
      children: [{ id: 'disabled-note', label: '不可操作' }],
    },
  ];
  private children = new Map<string, TreeItem[]>([
    [
      'source',
      Array.from({ length: 600 }, (_, index) => ({
        id: `file-${index + 1}`,
        label: `module-${String(index + 1).padStart(4, '0')}.ts`,
        description: '后端分页',
        data: { ordinal: index + 1 },
        events: index === 0 ? { activate: 'tree.record()' } : undefined,
      })).map((item) => JSON.parse(JSON.stringify(item)) as TreeItem),
    ],
    ['docs', []],
    ['retry', [{ id: 'recovered', label: '重试成功.txt' }]],
  ]);
  private failed = new Set<string>();
  private receipts = new Map<string, { fingerprint: string; result: TreeMoveResult }>();
  private tail: Promise<unknown> = Promise.resolve();
  private ready: Promise<void>;
  private file?: string;
  last: UIValue = null;
  constructor(file?: string) {
    this.file = file;
    this.ready = file
      ? fs
          .readFile(file, 'utf8')
          .then((raw) => {
            const stored = JSON.parse(raw) as {
              version: number;
              roots: TreeItem[];
              children: [string, TreeItem[]][];
              receipts: [string, { fingerprint: string; result: TreeMoveResult }][];
            };
            // Re-validate structural identities before accepting persisted order.
            new TreeDataStore(
              'demo',
              stored.roots.map((item) => ({
                ...item,
                ...(stored.children.some(([id]) => id === item.id)
                  ? { children: uiRequired(stored.children.find(([id]) => id === item.id))[1] }
                  : {}),
              })),
            );
            this.version = stored.version;
            this.roots = stored.roots;
            this.children = new Map(stored.children);
            this.receipts = new Map(stored.receipts);
          })
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
          })
      : Promise.resolve();
  }
  private all() {
    return this.roots.map((item) => ({
      ...item,
      ...(this.children.has(item.id) ? { children: uiRequired(this.children.get(item.id)) } : {}),
    }));
  }
  private snapshot() {
    return new TreeDataStore('demo', this.all());
  }
  handlers(): Record<
    string,
    {
      readOnly?: boolean;
      run(this: { signal?: AbortSignal }, ...args: UIValue[]): ReturnType<HandlerDefinition['run']>;
    }
  > {
    const owner = this;
    return {
      'tree.children': {
        readOnly: true,
        async run(value) {
          await owner.ready;
          this.signal?.throwIfAborted();
          const context = value as unknown as Extract<TreeControllerContext, { kind: 'children' }>;
          if (context.parent?.id === 'retry' && !owner.failed.has(context.dataEpoch)) {
            owner.failed.add(context.dataEpoch);
            throw new Error('演示首次读取失败，请点击重试');
          }
          const items =
            context.parent === null ? owner.roots : (owner.children.get(context.parent.id) ?? []);
          const offset = context.cursor ? Number(context.cursor) : 0;
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > items.length)
            throw new Error('无效游标');
          const limit = Math.min(context.limit, 120);
          return {
            items: items.slice(offset, offset + limit),
            nextCursor: offset + limit < items.length ? String(offset + limit) : null,
            version: String(owner.version),
          } as unknown as UIValue;
        },
      },
      'tree.render': {
        readOnly: true,
        async run(value) {
          await owner.ready;
          this.signal?.throwIfAborted();
          const context = value as unknown as Extract<TreeControllerContext, { kind: 'render' }>;
          const view: TreeRowView = {
            content: [
              {
                type: 'icon',
                icon: { kind: 'builtin', name: context.node.hasChildren ? 'folder' : 'typescript' },
              },
              { type: 'text', text: context.node.label },
              { type: 'badge', text: context.node.hasChildren ? '目录' : 'TS' },
              { type: 'text', text: context.node.description ?? '', tone: 'muted' },
            ],
            actions: [
              {
                id: 'inspect',
                label: '查看节点（无括号事件）',
                icon: { kind: 'builtin', name: 'info' },
                events: { click: 'tree.record' },
              },
            ],
            tooltip: `${context.node.label} · 稳定 ID: ${context.node.id}`,
          };
          return view as unknown as UIValue;
        },
      },
      'tree.path': {
        readOnly: true,
        async run(value) {
          await owner.ready;
          const context = value as unknown as Extract<
              TreeControllerContext,
              { kind: 'resolvePath' }
            >,
            store = owner.snapshot();
          const ids = [...store.ancestors(context.nodeId).reverse(), context.nodeId];
          return {
            path: ids.map((id) => {
              const item = store.nodes.get(id)?.item;
              if (!item) throw new Error('节点已删除');
              return item;
            }),
            version: String(owner.version),
          } as unknown as UIValue;
        },
      },
      'tree.search': {
        readOnly: true,
        async run(value) {
          await owner.ready;
          const context = value as unknown as Extract<TreeControllerContext, { kind: 'search' }>,
            store = owner.snapshot();
          const matches = [...store.nodes].filter(([, record]) =>
            record.item.label.toLowerCase().includes(context.query.toLowerCase()),
          );
          const start = Number(context.cursor ?? 0),
            limit = Math.min(120, context.limit);
          return {
            hits: matches.slice(start, start + limit).map(([id]) => ({
              path: [...store.ancestors(id).reverse(), id].map(
                (key) => uiRequired(store.nodes.get(key)).item,
              ),
            })),
            nextCursor: start + limit < matches.length ? String(start + limit) : null,
            version: String(owner.version),
          } as unknown as UIValue;
        },
      },
      'tree.move': {
        async run(value) {
          await owner.ready;
          const context = value as unknown as Extract<TreeControllerContext, { kind: 'move' }>;
          const run = owner.tail.then(async () => {
            this.signal?.throwIfAborted();
            const fingerprint = JSON.stringify({
              sourceIds: context.sourceIds,
              targetParentId: context.targetParentId,
              beforeId: context.beforeId,
              expectedVersion: context.expectedVersion,
            });
            const cached = owner.receipts.get(context.operationId);
            if (cached) {
              if (cached.fingerprint !== fingerprint) throw new Error('operationId 冲突');
              return cached.result;
            }
            if (context.expectedVersion !== String(owner.version))
              return { accepted: false, message: '数据版本冲突，请刷新' } as TreeMoveResult;
            const store = owner.snapshot(),
              move = normalizeTreeMove(
                store,
                context.sourceIds,
                context.targetParentId,
                context.beforeId,
                { name: 'demo', label: 'Demo', dragDrop: { mode: 'reparent' } },
              );
            const parents = new Set([
              move.targetParentId,
              ...move.sourceIds.map((id) => uiRequired(store.nodes.get(id)).parentId),
            ]);
            const lists = new Map<string | null, TreeItem[]>([
              [null, owner.roots],
              ...owner.children,
            ]);
            const sources = move.sourceIds.map((id) => uiRequired(store.nodes.get(id)).item);
            for (const parent of parents)
              lists.set(
                parent,
                (lists.get(parent) ?? []).filter((item) => !move.sourceIds.includes(item.id)),
              );
            const target = uiRequired(lists.get(move.targetParentId));
            const index =
              move.beforeId === null
                ? target.length
                : target.findIndex((item) => item.id === move.beforeId);
            target.splice(index, 0, ...sources);
            const result: TreeMoveResult = {
              accepted: true,
              version: String(owner.version + 1),
              invalidateParents: [...parents],
            };
            const receipts = new Map(owner.receipts);
            receipts.set(context.operationId, { fingerprint, result });
            const roots = uiRequired(lists.get(null)),
              children = [...lists].filter(([id]) => id !== null) as [string, TreeItem[]][];
            if (owner.file) {
              await fs.mkdir(path.dirname(owner.file), { recursive: true });
              const temp = owner.file + '.tmp';
              await fs.writeFile(
                temp,
                JSON.stringify({
                  version: owner.version + 1,
                  roots,
                  children,
                  receipts: [...receipts].slice(-512),
                }),
              );
              await fs.rename(temp, owner.file);
            }
            owner.roots = roots;
            owner.children = new Map(children);
            owner.version++;
            owner.receipts = receipts;
            return result;
          });
          owner.tail = run.catch(() => undefined);
          return (await run) as unknown as UIValue;
        },
      },
      'tree.record': {
        readOnly: true,
        run(...args) {
          owner.last = args;
          return {
            type: 'notification',
            data: { type: 'info', message: `树事件：${JSON.stringify(args).slice(0, 160)}` },
          };
        },
      },
    };
  }
}
const provider = new TreeDemoProvider(
  process.env.SCWC_TEMPLATE_TREE_DEMO_FILE ??
    fileURLToPath(new URL('./data/tree-demo.json', import.meta.url)),
);
export const treeDemoHandlers = provider.handlers();
export function treeDemoContent(): UINode[] {
  const staticNodes: TreeItem[] = [
    {
      id: 'static-src',
      label: 'src',
      tooltip: '源代码目录',
      icon: { kind: 'builtin', name: 'folder' },
      children: [
        {
          id: 'static-main',
          label: 'main.ts',
          description: '双击或 Enter 激活',
          tooltip: 'src/main.ts · 双击或 Enter 激活',
          events: { activate: 'tree.record()' },
        },
        { id: 'static-config', label: 'config.json' },
      ],
    },
    {
      id: 'static-docs',
      label: 'docs',
      tooltip: '文档目录',
      children: [{ id: 'static-readme', label: 'README.md', tooltip: 'docs/README.md' }],
    },
    { id: 'static-locked', label: '禁用节点', tooltip: '此节点不可选择或激活', disabled: true },
  ];
  return [
    {
      type: 'text',
      text: 'Explorer 行选择：Ctrl/Cmd 切换，Shift 区间；方向键浏览，Ctrl/Cmd+F 搜索，F2 进入行操作。',
      tone: 'muted',
    },
    {
      type: 'tree',
      key: 'static-tree',
      name: 'staticFiles',
      label: '静态树 / 多选 / 本地搜索 / 拖动',
      nodes: staticNodes,
      selectionMode: 'multiple',
      value: [],
      defaultExpandedKeys: ['static-src'],
      height: 200,
      dragDrop: { mode: 'reparent' },
      nodeEvents: { activate: 'tree.record' },
      events: { change: 'tree.record|tree.record($prev)', drop: 'tree.record()' },
    },
    {
      type: 'tree',
      key: 'dynamic-tree',
      name: 'dynamicFiles',
      label: '动态树 / 分页 / 远端搜索 / 自定义行',
      loadChildren: 'tree.children($tree)',
      renderNode: 'tree.render($tree)',
      resolvePath: 'tree.path($tree)',
      selectionMode: 'multiple',
      value: [],
      height: 300,
      search: { visible: true, controller: 'tree.search($tree)' },
      dragDrop: { mode: 'reparent', move: 'tree.move($tree)' },
      nodeEvents: { activate: 'tree.record', contextmenu: 'tree.record($event)' },
      events: { change: 'tree.record', loadError: 'tree.record', drop: 'tree.record' },
    },
    {
      type: 'stack',
      direction: 'row',
      children: [
        {
          type: 'button',
          text: '展开已加载',
          events: { click: "core:tree.expandAll('dynamicFiles')" },
        },
        {
          type: 'button',
          text: '收起',
          events: { click: "core:tree.collapseAll('dynamicFiles')" },
        },
        {
          type: 'button',
          text: '定位 module-0400',
          events: { click: "core:tree.reveal('dynamicFiles','file-400')" },
        },
        {
          type: 'button',
          text: '读取选择',
          events: { click: "core:value.read('dynamicFiles')|tree.record($prev)" },
        },
      ],
    },
    {
      type: 'tree',
      key: 'single-tree',
      name: 'singleFile',
      label: '单选树',
      nodes: staticNodes,
      value: 'static-main',
      height: 130,
      defaultExpandedKeys: ['static-src'],
      nodeEvents: { click: 'tree.record' },
    },
    {
      type: 'tree',
      key: 'readonly-tree',
      name: 'readonlyFile',
      label: '只读：保留搜索与展开，冻结选择和排序',
      nodes: staticNodes,
      readonly: true,
      value: 'static-main',
      height: 130,
      nodeEvents: { click: 'tree.record' },
    },
    {
      type: 'tree',
      key: 'disabled-tree',
      name: 'disabledFile',
      label: '禁用树',
      nodes: staticNodes,
      disabled: true,
      height: 100,
    },
  ];
}
