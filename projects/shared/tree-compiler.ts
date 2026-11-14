import {
  uiRequired,
  uiAssert,
  uiControlName,
  uiValue,
  type IconRef,
  type UIEventBinding,
  type CallNode,
} from './declarative-ui.ts';
import { parseProgram, walkArgument } from './ui-expressions.ts';
import {
  TREE_LIMITS,
  type CompiledTree,
  type TreeItem,
  type TreeRowPart,
  type TreeRowView,
  type UITreeNode,
} from './tree.ts';
import { treeId, TreeDataStore, treeValueIds } from './tree-model.ts';

export interface TreeCompileOptions {
  resource(path: string): string;
  validateCall(name: string, readOnly: boolean, watch: boolean): void;
  reads?(name: string): string[];
}
export const treeNodeEvents = ['click', 'dblclick', 'activate', 'contextmenu', 'focus', 'blur'];
export const treeEvents = ['change', 'expand', 'collapse', 'filter', 'drop', 'loadError'];
function object(value: unknown): asserts value is Record<string, unknown> {
  uiAssert(
    value && typeof value === 'object' && !Array.isArray(value),
    'TREE_INVALID_DATA',
    '树数据需要对象',
  );
}
function keys(value: object, allowed: string[]) {
  uiAssert(
    Object.keys(value).every((key) => allowed.includes(key)),
    'TREE_INVALID_DATA',
    '树数据包含未知属性',
  );
}
function string(value: unknown): asserts value is string {
  uiAssert(typeof value === 'string', 'TREE_INVALID_DATA', '树文本需要字符串');
}
export function treeIcon(icon: unknown, options: TreeCompileOptions): IconRef {
  object(icon);
  if (icon.kind === 'builtin') {
    keys(icon, ['kind', 'name']);
    string(icon.name);
    uiAssert(/^[A-Za-z0-9_-]{1,100}$/.test(icon.name), 'TREE_INVALID_DATA', '图标名称无效');
    return { kind: 'builtin', name: icon.name };
  }
  keys(icon, ['kind', 'path']);
  uiAssert(icon.kind === 'asset', 'TREE_INVALID_DATA', '图标类型无效');
  string(icon.path);
  return { kind: 'asset', path: options.resource(icon.path) };
}
export function compileTreeProgram(
  text: unknown,
  tree: CompiledTree,
  options: TreeCompileOptions,
): string {
  string(text);
  const program = parseProgram(text, true),
    capture = new Set<string>();
  const associated =
    typeof tree.options.for === 'string' ? [tree.options.for] : (tree.options.for ?? []);
  for (const name of associated) {
    uiControlName(name);
    capture.add(name);
  }
  for (const branch of program.branches) {
    for (const step of branch) {
      walkArgument(step, (node) => {
        if (node.type === 'call') {
          uiAssert(!node.watch, 'TREE_INVALID_PROGRAM', '树事件不允许注册 watch');
          options.validateCall(node.name, node !== step, false);
          for (const name of options.reads?.(node.name) ?? []) {
            capture.add(name);
          }
          if (['core:value.read', 'core:value.write'].includes(node.name)) {
            const first = node.args[0];
            uiAssert(
              first?.type === 'literal' && typeof first.value === 'string',
              'TREE_INVALID_PROGRAM',
              '字段读写目标必须为静态名称',
            );
            capture.add(first.value);
          }
        }
        if (node.type === 'field') {
          capture.add(node.name);
        }
      });
    }
  }
  if (tree.options.selectionMode !== 'none') {
    capture.add(tree.name);
  }
  const previous = tree.bindings.find(
    (binding) => JSON.stringify(binding.program) === JSON.stringify(program),
  );
  if (previous) {
    return previous.id;
  }
  uiAssert(
    tree.bindings.length < TREE_LIMITS.programs,
    'TREE_QUOTA_EXCEEDED',
    '树事件程序超过 512 个',
  );
  const id = `${tree.treeId}:${tree.dataEpoch}:${crypto.randomUUID()}`;
  tree.bindings.push({
    id,
    nodeId: tree.hostNodeId,
    event: 'tree',
    program,
    for: [...associated],
    capture: [...capture],
  });
  return id;
}
export function compileTreeItems(
  value: unknown,
  tree: CompiledTree,
  options: TreeCompileOptions,
  payload = false,
): TreeItem[] {
  uiValue(value, payload ? TREE_LIMITS.pageBytes : 262144);
  uiAssert(Array.isArray(value), 'TREE_INVALID_DATA', '节点列表必须是数组');
  if (payload) {
    uiAssert(value.length <= TREE_LIMITS.page, 'TREE_QUOTA_EXCEEDED', '每页最多 200 个节点');
  }
  const result = structuredClone(value) as unknown as TreeItem[];
  const ids = new Set<string>(),
    stack = [...result];
  while (stack.length) {
    const item = uiRequired(stack.pop());
    object(item);
    keys(item, [
      'id',
      'label',
      'description',
      'tooltip',
      'icon',
      'expandedIcon',
      'hasChildren',
      'children',
      'disabled',
      'readonly',
      'selectable',
      'draggable',
      'droppable',
      'data',
      'events',
    ]);
    uiAssert(treeId(item.id) && !ids.has(item.id), 'TREE_DUPLICATE_ID', '节点 ID 无效或重复');
    ids.add(item.id);
    string(item.label);
    for (const key of ['description', 'tooltip'] as const) {
      if (item[key] !== undefined) {
        string(item[key]);
      }
    }
    for (const key of [
      'disabled',
      'readonly',
      'selectable',
      'draggable',
      'droppable',
      'hasChildren',
    ] as const) {
      uiAssert(
        item[key] === undefined || typeof item[key] === 'boolean',
        'TREE_INVALID_DATA',
        '节点开关需要布尔值',
      );
    }
    for (const key of ['icon', 'expandedIcon'] as const) {
      if (item[key]) {
        item[key] = treeIcon(item[key], options);
      }
    }
    if (item.children !== undefined) {
      uiAssert(
        Array.isArray(item.children) && !(item.hasChildren === false && item.children.length),
        'TREE_INVALID_DATA',
        'children 与 hasChildren 冲突',
      );
      stack.push(...item.children);
      item.hasChildren ??= item.children.length > 0;
    }
    if (item.events) {
      object(item.events);
      keys(item.events, treeNodeEvents);
      item.bindings = Object.fromEntries(
        Object.entries(item.events).map(([event, text]) => [
          event,
          compileTreeProgram(text, tree, options),
        ]),
      );
      delete item.events;
    }
    uiAssert(ids.size <= TREE_LIMITS.nodes, 'TREE_QUOTA_EXCEEDED', '树节点超过上限');
  }
  return result;
}
export function compileTreeController(
  text: unknown,
  readOnly: boolean,
  options: TreeCompileOptions,
): CallNode {
  string(text);
  // parseProgram enforces branch/domain rules; a controller additionally requires explicit ().
  uiAssert(text.trim().endsWith(')'), 'TREE_INVALID_PROGRAM', '树控制器必须显式调用');
  const program = parseProgram(text, true);
  uiAssert(
    program.branches.length === 1 && program.branches[0].length === 1,
    'TREE_INVALID_PROGRAM',
    '树控制器必须为单调用',
  );
  const call = program.branches[0][0];
  walkArgument(call, (node) => {
    uiAssert(
      !['event', 'prev', 'this'].includes(node.type),
      'TREE_INVALID_PROGRAM',
      '树控制器参数上下文无效',
    );
    if (node.type === 'call') {
      uiAssert(!node.watch, 'TREE_INVALID_PROGRAM', '树控制器不允许 watch');
      options.validateCall(node.name, readOnly || node !== call, false);
      node.readOnly = readOnly || node !== call;
    }
  });
  return call;
}
export function compileTree(node: UITreeNode, options: TreeCompileOptions): CompiledTree {
  uiValue(
    Object.fromEntries(Object.entries(node).filter(([, value]) => value !== undefined)),
    262144,
  );
  uiControlName(node.name);
  string(node.label);
  keys(node, [
    'type',
    'key',
    'name',
    'label',
    'nodes',
    'loadChildren',
    'renderNode',
    'resolvePath',
    'selectionMode',
    'value',
    'defaultExpandedKeys',
    'disabled',
    'readonly',
    'height',
    'rowHeight',
    'indent',
    'indentGuides',
    'expandOn',
    'search',
    'dragDrop',
    'virtual',
    'nodeEvents',
    'events',
    'visible',
    'for',
  ]);
  const selectionMode = node.selectionMode ?? 'single';
  uiAssert(
    ['none', 'single', 'multiple'].includes(selectionMode),
    'TREE_INVALID_DATA',
    '选择模式无效',
  );
  for (const key of ['disabled', 'readonly'] as const) {
    uiAssert(
      node[key] === undefined ||
        typeof node[key] === 'boolean' ||
        (typeof node[key] === 'string' && node[key].includes('${')),
      'TREE_INVALID_DATA',
      '树权限需要布尔值或模板',
    );
  }
  const number = (value: unknown, min: number, max: number) =>
    uiAssert(
      typeof value === 'number' &&
        Number.isFinite(value) &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max,
      'TREE_INVALID_DATA',
      '树尺寸或配额无效',
    );
  number(node.rowHeight ?? 22, 22, 40);
  number(node.indent ?? 8, 8, 24);
  if (node.height !== 'fill') {
    number(node.height ?? 280, 44, 10000);
  }
  uiAssert(
    node.indentGuides === undefined || ['none', 'onHover', 'always'].includes(node.indentGuides),
    'TREE_INVALID_DATA',
    '缩进导线选项无效',
  );
  uiAssert(
    node.expandOn === undefined || ['click', 'doubleClick', 'twistie'].includes(node.expandOn),
    'TREE_INVALID_DATA',
    '展开方式无效',
  );
  if (node.search !== undefined && node.search !== false) {
    object(node.search);
    keys(node.search, ['visible', 'placeholder', 'mode', 'match', 'debounce', 'controller']);
    uiAssert(
      node.search.mode === undefined || ['filter', 'highlight'].includes(node.search.mode),
      'TREE_INVALID_DATA',
      '搜索方式无效',
    );
    uiAssert(
      node.search.match === undefined || ['substring', 'fuzzy'].includes(node.search.match),
      'TREE_INVALID_DATA',
      '匹配方式无效',
    );
    number(node.search.debounce ?? 150, 0, 5000);
  }
  if (node.dragDrop !== undefined && node.dragDrop !== false) {
    object(node.dragDrop);
    keys(node.dragDrop, ['mode', 'multiple', 'move']);
    uiAssert(
      node.dragDrop.mode === undefined || ['reorder', 'reparent'].includes(node.dragDrop.mode),
      'TREE_INVALID_DATA',
      '拖拽方式无效',
    );
    uiAssert(
      !node.loadChildren || node.dragDrop.move,
      'TREE_INVALID_PROGRAM',
      '动态排序必须声明 move 控制器',
    );
  }
  if (typeof node.virtual === 'object') {
    keys(node.virtual, ['overscan']);
    number(node.virtual.overscan ?? 8, 0, 100);
  }
  const {
    nodes,
    loadChildren,
    renderNode,
    resolvePath,
    events,
    nodeEvents,
    type: _type,
    ...settings
  } = node;
  const tree: CompiledTree = {
    signature: '',
    treeId: `tree-${node.key ?? node.name}`,
    hostNodeId: '',
    dataEpoch: crypto.randomUUID(),
    name: node.name,
    key: node.key ?? node.name,
    label: node.label,
    options: { ...structuredClone(settings), selectionMode },
    controllers: {},
    bindings: [],
    defaults: {},
  };
  for (const [key, text] of Object.entries({
    children: loadChildren,
    render: renderNode,
    path: resolvePath,
    search: node.search && node.search.controller,
    move: node.dragDrop && node.dragDrop.move,
  })) {
    if (text) {
      tree.controllers[key as keyof CompiledTree['controllers']] = compileTreeController(
        text,
        key !== 'move',
        options,
      );
    }
  }
  for (const [map, allowed] of [
    [events, treeEvents],
    [nodeEvents, treeNodeEvents],
  ] as const) {
    if (map) {
      object(map);
      keys(map, allowed);
      for (const [event, text] of Object.entries(map)) {
        tree.defaults[event as keyof typeof tree.defaults] = compileTreeProgram(
          text,
          tree,
          options,
        );
      }
    }
  }
  if (nodes) {
    tree.nodes = compileTreeItems(nodes, tree, options);
  }
  const store = new TreeDataStore(tree.dataEpoch, tree.nodes);
  if (typeof node.value !== 'string' || !node.value.includes('${')) {
    const ids = treeValueIds(node.value ?? (selectionMode === 'multiple' ? [] : ''), selectionMode);
    for (const id of [...ids, ...(node.defaultExpandedKeys ?? [])]) {
      uiAssert(
        store.nodes.has(id) || tree.controllers.path,
        'TREE_UNKNOWN_NODE',
        '初始节点 ID 无法解析，需要 resolvePath',
      );
    }
  }
  if (tree.options.search) {
    delete tree.options.search.controller;
  }
  if (tree.options.dragDrop) {
    delete tree.options.dragDrop.move;
  }
  return tree;
}
export function compileTreeRow(
  value: unknown,
  tree: CompiledTree,
  options: TreeCompileOptions,
): TreeRowView {
  uiValue(value, TREE_LIMITS.pageBytes);
  object(value);
  keys(value, ['content', 'actions', 'tooltip', 'ariaLabel']);
  uiAssert(Array.isArray(value.content), 'TREE_INVALID_RENDER', '自定义行需要 content');
  const view = structuredClone(value) as unknown as TreeRowView;
  let count = 0;
  const parts = (items: TreeRowPart[], depth: number) => {
    uiAssert(depth <= 4, 'TREE_INVALID_RENDER', '自定义行嵌套过深');
    for (const part of items) {
      uiAssert(++count <= TREE_LIMITS.parts, 'TREE_INVALID_RENDER', '自定义行内容过多');
      object(part);
      if (part.type === 'stack') {
        keys(part, ['type', 'direction', 'gap', 'children']);
        uiAssert(
          part.direction === 'row' &&
            Array.isArray(part.children) &&
            (part.gap === undefined ||
              (Number.isFinite(part.gap) && part.gap >= 0 && part.gap <= 24)),
          'TREE_INVALID_RENDER',
          '行布局无效',
        );
        parts(part.children, depth + 1);
      } else if (part.type === 'icon') {
        keys(part, ['type', 'icon', 'label']);
        part.icon = treeIcon(part.icon, options);
      } else {
        keys(part, ['type', 'text', 'tone']);
        uiAssert(['text', 'badge'].includes(part.type), 'TREE_INVALID_RENDER', '行内容类型无效');
        string(part.text);
        uiAssert(
          part.tone === undefined || ['normal', 'muted', 'warning', 'error'].includes(part.tone),
          'TREE_INVALID_RENDER',
          '行颜色无效',
        );
      }
    }
  };
  parts(view.content, 1);
  const actions = new Set<string>();
  uiAssert(
    !view.actions || (Array.isArray(view.actions) && view.actions.length <= TREE_LIMITS.actions),
    'TREE_INVALID_RENDER',
    '行操作超过上限',
  );
  for (const action of view.actions ?? []) {
    keys(action, ['id', 'label', 'icon', 'disabled', 'events']);
    uiControlName(action.id);
    string(action.label);
    uiAssert(
      !actions.has(action.id) &&
        typeof action.events?.click === 'string' &&
        (action.disabled === undefined || typeof action.disabled === 'boolean'),
      'TREE_INVALID_RENDER',
      '行操作无效',
    );
    actions.add(action.id);
    action.icon = treeIcon(action.icon, options);
    action.bindingId = compileTreeProgram(action.events.click, tree, options);
    delete action.events;
  }
  for (const key of ['tooltip', 'ariaLabel'] as const) {
    if (view[key] !== undefined) {
      string(view[key]);
    }
  }
  return view;
}
export function treeBinding(tree: CompiledTree, id: string): UIEventBinding {
  const binding = tree.bindings.find((binding) => binding.id === id);
  uiAssert(binding, 'TREE_STALE_BINDING', '树事件绑定已失效');
  return binding;
}
