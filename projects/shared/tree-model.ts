import { uiRequired, uiAssert, uiValue } from './declarative-ui.ts';
import {
  TREE_LIMITS,
  type ChildListState,
  type CompiledTree,
  type NodeRecord,
  type TreeItem,
  type TreeItemSnapshot,
  type TreePatch,
  type TreeValue,
  type TreeViewState,
} from './tree.ts';

export const emptyList = (status: ChildListState['status'] = 'unloaded'): ChildListState => ({
  ids: [],
  status,
  complete: status === 'loaded',
  nextCursor: null,
  generation: 0,
});
export const treeId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 512 && !/[\x00-\x1f\x7f]/.test(id);
export class TreeDataStore {
  nodes = new Map<string, NodeRecord>();
  children = new Map<string | null, ChildListState>();
  version: string | null = null;
  dataEpoch: string;
  constructor(epoch: string, items?: TreeItem[]) {
    this.dataEpoch = epoch;
    this.children.set(null, emptyList());
    if (items) {
      this.replace(null, items, null, true);
    }
  }
  clone() {
    const copy = new TreeDataStore(this.dataEpoch);
    copy.nodes = new Map(this.nodes);
    copy.children = new Map(this.children);
    copy.version = this.version;
    return copy;
  }
  descendants(id: string) {
    const ids: string[] = [],
      stack = [id];
    while (stack.length) {
      const current = uiRequired(stack.pop());
      ids.push(current);
      stack.push(...(this.nodes.get(current)?.childIds ?? []));
    }
    return ids;
  }
  ancestors(id: string): string[] {
    const result: string[] = [];
    let parent = this.nodes.get(id)?.parentId;
    while (parent != null) {
      uiAssert(
        result.length < TREE_LIMITS.depth && !result.includes(parent),
        'TREE_INVALID_PARENT',
        '节点父子关系无效',
      );
      result.push(parent);
      parent = this.nodes.get(parent)?.parentId;
    }
    return result;
  }
  snapshot(id: string, options?: { disabled?: unknown; readonly?: unknown }): TreeItemSnapshot {
    const record = this.nodes.get(id);
    uiAssert(record, 'TREE_UNKNOWN_NODE', '节点不存在');
    const path = [id, ...this.ancestors(id)].map((key) => uiRequired(this.nodes.get(key)).item);
    return {
      id,
      parentId: record.parentId,
      label: record.item.label,
      hasChildren: record.item.hasChildren === true || record.childIds.length > 0,
      disabled: options?.disabled === true || path.some((item) => item.disabled),
      readonly: options?.readonly === true || path.some((item) => item.readonly),
      ...(record.item.description === undefined ? {} : { description: record.item.description }),
      ...(record.item.data === undefined ? {} : { data: record.item.data }),
    };
  }
  /** Validate on an isolated candidate; no partial pages or patches become visible. */
  replace(
    parentId: string | null,
    items: TreeItem[],
    cursor: string | null,
    complete: boolean,
    append = false,
    deferQuota = false,
  ): TreePatch {
    uiAssert(parentId === null || this.nodes.has(parentId), 'TREE_UNKNOWN_NODE', '父节点不存在');
    const candidate = this.clone();
    const old = candidate.children.get(parentId) ?? emptyList();
    const removed = new Set<string>();
    if (!append) {
      for (const id of old.ids) {
        for (const child of candidate.descendants(id)) {
          removed.add(child);
        }
      }
      for (const id of removed) {
        candidate.nodes.delete(id);
        candidate.children.delete(id);
      }
    }
    const top: string[] = [],
      records: NodeRecord[] = [],
      lists: [string | null, ChildListState][] = [];
    const stack = items
      .map((item) => ({
        item,
        parentId,
        depth: parentId === null ? 1 : this.ancestors(parentId).length + 2,
      }))
      .reverse();
    while (stack.length) {
      const { item, parentId: parent, depth } = uiRequired(stack.pop());
      uiAssert(
        treeId(item.id) && !candidate.nodes.has(item.id) && depth <= TREE_LIMITS.depth,
        'TREE_DUPLICATE_ID',
        '节点 ID 重复、父子关系冲突或层级超限',
      );
      const { children, ...flat } = item;
      const retained = this.nodes.get(item.id);
      const preserve =
        !append &&
        children === undefined &&
        item.hasChildren === true &&
        retained?.parentId === parent;
      const record = {
        item: flat,
        parentId: parent,
        childIds: children?.map((child) => child.id) ?? (preserve ? retained.childIds : []),
        nodeRevision: (this.nodes.get(item.id)?.nodeRevision ?? 0) + 1,
      };
      candidate.nodes.set(item.id, record);
      removed.delete(item.id);
      records.push(record);
      if (parent === parentId) {
        top.push(item.id);
      }
      const list = preserve
        ? { ...uiRequired(this.children.get(item.id)) }
        : {
            ...emptyList(children || !item.hasChildren ? 'loaded' : 'unloaded'),
            ids: record.childIds,
          };
      candidate.children.set(item.id, list);
      lists.push([item.id, list]);
      if (preserve) {
        for (const child of retained.childIds.flatMap((id) => this.descendants(id))) {
          const saved = uiRequired(this.nodes.get(child));
          candidate.nodes.set(child, saved);
          candidate.children.set(child, uiRequired(this.children.get(child)));
          removed.delete(child);
          records.push(saved);
          lists.push([child, uiRequired(this.children.get(child))]);
        }
      }
      if (children) {
        for (let index = children.length - 1; index >= 0; index--) {
          stack.push({ item: children[index], parentId: item.id, depth: depth + 1 });
        }
      }
    }
    const list = {
      ...old,
      ids: [...(append ? old.ids : []), ...top],
      status: 'loaded' as const,
      complete,
      nextCursor: cursor,
      error: undefined,
    };
    candidate.children.set(parentId, list);
    lists.push([parentId, list]);
    if (parentId !== null) {
      const parent = uiRequired(candidate.nodes.get(parentId));
      const record = { ...parent, childIds: list.ids, nodeRevision: parent.nodeRevision + 1 };
      candidate.nodes.set(parentId, record);
      records.push(record);
    }
    if (!deferQuota) {
      candidate.checkQuota();
    }
    this.nodes = candidate.nodes;
    this.children = candidate.children;
    return { upsert: records, lists, remove: [...removed], version: this.version };
  }
  checkQuota() {
    uiAssert(
      this.nodes.size <= TREE_LIMITS.nodes &&
        new TextEncoder().encode(JSON.stringify([...this.nodes.values()])).length <=
          TREE_LIMITS.bytes,
      'TREE_QUOTA_EXCEEDED',
      '树数据缓存已达上限，请收起并释放分支后重试',
    );
  }
  apply(patch: TreePatch) {
    const next = this.clone();
    for (const id of patch.remove ?? []) {
      next.nodes.delete(id);
      next.children.delete(id);
    }
    for (const record of patch.upsert ?? []) {
      uiAssert(
        treeId(record.item.id) && !record.item.children,
        'TREE_INVALID_PATCH',
        '树节点补丁无效',
      );
      if ((next.nodes.get(record.item.id)?.nodeRevision ?? -1) <= record.nodeRevision) {
        next.nodes.set(record.item.id, record);
      }
    }
    for (const [id, list] of patch.lists ?? []) {
      uiAssert(
        new Set(list.ids).size === list.ids.length,
        'TREE_DUPLICATE_ID',
        '子列表包含重复节点',
      );
      if ((next.children.get(id)?.generation ?? -1) <= list.generation) {
        next.children.set(id, list);
      }
    }
    for (const [id, record] of next.nodes) {
      uiAssert(
        record.parentId === null || next.nodes.has(record.parentId),
        'TREE_INVALID_PARENT',
        '节点父级不存在',
      );
      next.ancestors(id);
      for (const child of record.childIds) {
        uiAssert(next.nodes.get(child)?.parentId === id, 'TREE_INVALID_PARENT', '子节点父级不一致');
      }
    }
    for (const [parent, list] of next.children) {
      for (const id of list.ids) {
        uiAssert(next.nodes.get(id)?.parentId === parent, 'TREE_INVALID_PARENT', '子列表关系无效');
      }
    }
    next.checkQuota();
    this.nodes = next.nodes;
    this.children = next.children;
    if (patch.version !== undefined) {
      this.version = patch.version;
    }
    for (const id of patch.invalidate ?? []) {
      const list = this.children.get(id);
      if (list) {
        this.children.set(id, {
          ...list,
          status: 'unloaded',
          complete: false,
          nextCursor: null,
          generation: list.generation + 1,
        });
      }
    }
  }
  patch(): TreePatch {
    return { upsert: [...this.nodes.values()], lists: [...this.children], version: this.version };
  }
}
export interface VisibleTreeRow {
  kind: 'node' | 'loading' | 'retry' | 'more';
  id: string;
  parentId: string | null;
  depth: number;
  index: number;
  posinset: number;
  setsize: number;
}
export function matchTreeText(
  text: string,
  query: string,
  mode: 'fuzzy' | 'substring' = 'fuzzy',
): [number, number][] {
  const source = text.toLocaleLowerCase(),
    needle = query.toLocaleLowerCase();
  if (!needle) {
    return [];
  }
  if (mode === 'substring') {
    const start = source.indexOf(needle);
    return start < 0 ? [] : [[start, start + needle.length]];
  }
  const ranges: [number, number][] = [];
  let position = 0;
  for (const char of needle) {
    const found = source.indexOf(char, position);
    if (found < 0) {
      return [];
    }
    const last = ranges[ranges.length - 1];
    if (last?.[1] === found) {
      last[1]++;
    } else {
      ranges.push([found, found + 1]);
    }
    position = found + 1;
  }
  return ranges;
}
export function visibleTreeRows(
  store: TreeDataStore,
  state: TreeViewState,
  options: CompiledTree['options'],
): VisibleTreeRow[] {
  const filter = state.query && options.search !== false && options.search?.mode !== 'highlight';
  const included = new Set<string>(),
    expanded = new Set(state.expandedIds);
  if (filter) {
    for (const [id, record] of store.nodes) {
      if (
        matchTreeText(
          record.item.label + ' ' + (record.item.description ?? ''),
          state.query,
          options.search === false ? 'fuzzy' : options.search?.match,
        ).length
      ) {
        included.add(id);
        for (const parent of store.ancestors(id)) {
          included.add(parent);
          expanded.add(parent);
        }
      }
    }
  }
  const result: VisibleTreeRow[] = [];
  const stack: { parentId: string | null; depth: number; ids: string[]; offset: number }[] = [
    { parentId: null, depth: 1, ids: store.children.get(null)?.ids ?? [], offset: 0 },
  ];
  while (stack.length) {
    const frame = uiRequired(stack[stack.length - 1]);
    if (frame.offset >= frame.ids.length) {
      stack.pop();
      const list = store.children.get(frame.parentId);
      if (
        !filter &&
        list &&
        (list.status === 'loading' ||
          list.status === 'error' ||
          (list.status === 'loaded' && !list.complete))
      ) {
        const kind =
          list.status === 'loading' ? 'loading' : list.status === 'error' ? 'retry' : 'more';
        result.push({
          kind,
          id: '',
          parentId: frame.parentId,
          depth: frame.depth,
          index: result.length,
          posinset: 0,
          setsize: -1,
        });
      }
      continue;
    }
    const offset = frame.offset++,
      id = frame.ids[offset];
    if (filter && !included.has(id)) {
      continue;
    }
    const record = store.nodes.get(id);
    if (!record) {
      continue;
    }
    result.push({
      kind: 'node',
      id,
      parentId: frame.parentId,
      depth: frame.depth,
      index: result.length,
      posinset: offset + 1,
      setsize: store.children.get(frame.parentId)?.complete ? frame.ids.length : -1,
    });
    if (expanded.has(id)) {
      stack.push({ parentId: id, depth: frame.depth + 1, ids: record.childIds, offset: 0 });
    }
  }
  return result;
}
export function treeValueIds(
  value: unknown,
  mode: CompiledTree['options']['selectionMode'],
): string[] {
  uiAssert(
    mode === 'multiple'
      ? Array.isArray(value) && value.every(treeId)
      : typeof value === 'string' && (value === '' || treeId(value)),
    'TREE_INVALID_SELECTION',
    '树选择值类型无效',
  );
  const ids = typeof value === 'string' ? (value ? [value] : []) : (value as string[]);
  uiAssert(
    ids.length <= TREE_LIMITS.selected && new Set(ids).size === ids.length,
    'TREE_INVALID_SELECTION',
    '选择包含重复 ID 或超过 500 项',
  );
  uiValue(ids);
  return ids;
}
export function selectTreeRows(
  store: TreeDataStore,
  state: TreeViewState,
  rows: VisibleTreeRow[],
  id: string,
  options: CompiledTree['options'],
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
) {
  const snapshot = store.snapshot(id, options),
    item = uiRequired(store.nodes.get(id)).item;
  state.focusedId = id;
  if (
    snapshot.disabled ||
    snapshot.readonly ||
    item.selectable === false ||
    options.selectionMode === 'none'
  ) {
    return false;
  }
  const old = JSON.stringify([...state.selectedIds]),
    add = modifiers.ctrl || modifiers.meta;
  const frozen = [...state.selectedIds].filter((key) => {
    const permission = store.snapshot(key, options);
    return permission.disabled || permission.readonly;
  });
  let next = new Set(state.selectedIds);
  if (options.selectionMode === 'multiple' && modifiers.shift && state.rangeAnchorId) {
    const business = rows.filter((row) => row.kind === 'node'),
      from = business.findIndex((row) => row.id === state.rangeAnchorId),
      to = business.findIndex((row) => row.id === id);
    if (!add) {
      next = new Set(frozen);
    }
    for (const row of business.slice(from < 0 ? to : Math.min(from, to), Math.max(from, to) + 1)) {
      const effective = store.snapshot(row.id, options);
      if (
        !effective.disabled &&
        !effective.readonly &&
        uiRequired(store.nodes.get(row.id)).item.selectable !== false
      ) {
        next.add(row.id);
      }
    }
  } else if (options.selectionMode === 'multiple' && add) {
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    state.rangeAnchorId = id;
  } else {
    next = new Set([...frozen, id]);
    state.rangeAnchorId = id;
  }
  uiAssert(next.size <= TREE_LIMITS.selected, 'TREE_QUOTA_EXCEEDED', '最多选择 500 个节点');
  state.selectedIds = next;
  return old !== JSON.stringify([...next]);
}
export function treeSelectionValue(state: TreeViewState, mode?: string): TreeValue {
  return mode === 'multiple' ? [...state.selectedIds] : ([...state.selectedIds][0] ?? '');
}
export function reconcileTreeState(store: TreeDataStore, state: TreeViewState) {
  state.selectedIds = new Set([...state.selectedIds].filter((id) => store.nodes.has(id)));
  state.expandedIds = new Set([...state.expandedIds].filter((id) => store.nodes.has(id)));
  if (state.focusedId && !store.nodes.has(state.focusedId)) {
    state.focusedId = store.children.get(null)?.ids[0] ?? null;
  }
  if (state.rangeAnchorId && !store.nodes.has(state.rangeAnchorId)) {
    state.rangeAnchorId = null;
  }
}
export function normalizeTreeMove(
  store: TreeDataStore,
  sourceIds: string[],
  targetParentId: string | null,
  beforeId: string | null,
  options: CompiledTree['options'],
  allowIncompleteTarget = false,
) {
  uiAssert(
    options.dragDrop && !options.disabled && !options.readonly,
    'TREE_READ_ONLY',
    '树不允许移动',
  );
  uiAssert(
    sourceIds.length > 0 &&
      sourceIds.length <= TREE_LIMITS.selected &&
      new Set(sourceIds).size === sourceIds.length,
    'TREE_INVALID_MOVE',
    '移动来源无效',
  );
  const selected = new Set(sourceIds);
  const source = sourceIds.filter(
    (id) => !store.ancestors(id).some((parent) => selected.has(parent)),
  );
  const order = visibleTreeRows(
    store,
    {
      expandedIds: new Set(store.nodes.keys()),
      selectedIds: new Set(),
      focusedId: null,
      rangeAnchorId: null,
      query: '',
    },
    options,
  )
    .filter((row) => row.kind === 'node')
    .map((row) => row.id);
  source.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  if (options.dragDrop.multiple === false) {
    uiAssert(source.length === 1, 'TREE_INVALID_MOVE', '此树仅允许单节点移动');
  }
  for (const id of source) {
    const node = store.nodes.get(id),
      effective = store.snapshot(id, options);
    uiAssert(
      node && !effective.disabled && !effective.readonly && node.item.draggable !== false,
      'TREE_READ_ONLY',
      '来源节点不允许移动',
    );
    uiAssert(
      targetParentId !== id &&
        (targetParentId === null || !store.ancestors(targetParentId).includes(id)),
      'TREE_MOVE_CYCLE',
      '不能移入自身或后代',
    );
    if (options.dragDrop.mode !== 'reparent') {
      uiAssert(node.parentId === targetParentId, 'TREE_INVALID_MOVE', '此树只允许同级排序');
    }
  }
  if (targetParentId !== null) {
    const effective = store.snapshot(targetParentId, options),
      item = uiRequired(store.nodes.get(targetParentId)).item;
    uiAssert(
      !effective.disabled &&
        !effective.readonly &&
        item.droppable !== false &&
        (item.droppable === true || effective.hasChildren),
      'TREE_READ_ONLY',
      '目标不允许接收节点',
    );
  }
  const siblings = (store.children.get(targetParentId)?.ids ?? []).filter(
    (id) => !source.includes(id),
  );
  uiAssert(
    beforeId === null || siblings.includes(beforeId),
    'TREE_INVALID_ANCHOR',
    '插入锚点不属于真实目标列表',
  );
  uiAssert(
    allowIncompleteTarget || store.children.get(targetParentId)?.complete,
    'TREE_INCOMPLETE_TARGET',
    '请先加载完整目标列表',
  );
  return { sourceIds: source, targetParentId, beforeId };
}
