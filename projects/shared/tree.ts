import type {
  CallNode,
  FieldValue,
  IconRef,
  NormalizedUIEvent,
  UIEventBinding,
  UINode,
  UIValue,
} from './declarative-ui.ts';

export type TreeId = string;
export type TreeValue = string | string[];
export type TreeNodeEventName =
  | 'click'
  | 'dblclick'
  | 'activate'
  | 'contextmenu'
  | 'focus'
  | 'blur';
export type TreeEventName = 'change' | 'expand' | 'collapse' | 'filter' | 'drop' | 'loadError';
export interface TreeItem {
  id: TreeId;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: IconRef;
  expandedIcon?: IconRef;
  hasChildren?: boolean;
  children?: TreeItem[];
  disabled?: boolean;
  readonly?: boolean;
  selectable?: boolean;
  draggable?: boolean;
  droppable?: boolean;
  data?: UIValue;
  events?: Partial<Record<TreeNodeEventName, string>>;
  /** Compiler-owned. Providers cannot supply binding identities. */
  bindings?: Partial<Record<TreeNodeEventName, string>>;
}
export interface UITreeNode extends UINode {
  type: 'tree';
  name: string;
  label: string;
  nodes?: TreeItem[];
  loadChildren?: string;
  renderNode?: string;
  resolvePath?: string;
  selectionMode?: 'none' | 'single' | 'multiple';
  value?: TreeValue;
  defaultExpandedKeys?: TreeId[];
  disabled?: boolean | string;
  readonly?: boolean | string;
  height?: number | 'fill';
  rowHeight?: number;
  indent?: number;
  indentGuides?: 'none' | 'onHover' | 'always';
  expandOn?: 'click' | 'doubleClick' | 'twistie';
  search?:
    | false
    | {
        visible?: boolean;
        placeholder?: string;
        mode?: 'filter' | 'highlight';
        match?: 'fuzzy' | 'substring';
        debounce?: number;
        controller?: string;
      };
  dragDrop?: false | { mode?: 'reorder' | 'reparent'; multiple?: boolean; move?: string };
  virtual?: boolean | { overscan?: number };
  nodeEvents?: Partial<Record<TreeNodeEventName, string>>;
}
export interface TreeItemSnapshot {
  id: string;
  parentId: string | null;
  label: string;
  description?: string;
  hasChildren: boolean;
  disabled: boolean;
  readonly: boolean;
  data?: UIValue;
}
export type TreeControllerContext = { treeName: string; requestId: string; dataEpoch: string } & (
  | {
      kind: 'children';
      parent: TreeItemSnapshot | null;
      cursor: string | null;
      limit: number;
      version: string | null;
    }
  | { kind: 'render'; node: TreeItemSnapshot }
  | { kind: 'search'; query: string; cursor: string | null; limit: number; version: string | null }
  | { kind: 'resolvePath'; nodeId: string }
  | {
      kind: 'move';
      operationId: string;
      sourceIds: string[];
      targetId: string | null;
      position: 'before' | 'after' | 'inside';
      targetParentId: string | null;
      beforeId: string | null;
      expectedVersion: string;
    }
);
export interface TreeChildrenPage {
  items: TreeItem[];
  nextCursor: string | null;
  version: string;
}
export interface TreeSearchPage {
  hits: { path: TreeItem[]; matchRanges?: [number, number][] }[];
  nextCursor: string | null;
  version: string;
}
export interface TreePathResult {
  path: TreeItem[];
  version: string;
}
export type TreeMoveResult =
  | { accepted: false; message?: string }
  | { accepted: true; version: string; invalidateParents: (string | null)[] };
export type TreeRowPart =
  | { type: 'text'; text: string; tone?: 'normal' | 'muted' | 'warning' | 'error' }
  | { type: 'icon'; icon: IconRef; label?: string }
  | { type: 'badge'; text: string; tone?: 'normal' | 'warning' | 'error' }
  | { type: 'stack'; direction: 'row'; gap?: number; children: TreeRowPart[] };
export interface TreeRowView {
  content: TreeRowPart[];
  actions?: {
    id: string;
    label: string;
    icon: IconRef;
    disabled?: boolean;
    events?: { click: string };
    bindingId?: string;
  }[];
  tooltip?: string;
  ariaLabel?: string;
}
export interface CompiledTree {
  signature: string;
  treeId: string;
  hostNodeId: string;
  dataEpoch: string;
  name: string;
  key: string;
  label: string;
  options: Pick<
    UITreeNode,
    | 'name'
    | 'key'
    | 'label'
    | 'selectionMode'
    | 'value'
    | 'defaultExpandedKeys'
    | 'disabled'
    | 'readonly'
    | 'height'
    | 'rowHeight'
    | 'indent'
    | 'indentGuides'
    | 'expandOn'
    | 'search'
    | 'dragDrop'
    | 'virtual'
    | 'for'
  >;
  nodes?: TreeItem[];
  controllers: Partial<Record<'children' | 'render' | 'search' | 'path' | 'move', CallNode>>;
  bindings: UIEventBinding[];
  defaults: Partial<Record<TreeNodeEventName | TreeEventName, string>>;
}
export interface TreeEnvelope {
  instanceId: string;
  renderRevision: number;
  treeId: string;
  dataEpoch: string;
  requestId: string;
  viewState?: { expandedIds: string[]; selectedIds: string[]; focusedId: string | null };
}
export type TreeCommand =
  | { type: 'expand' | 'collapse' | 'reveal'; nodeId: string }
  | { type: 'expandAll' | 'collapseAll' }
  | { type: 'refresh'; parentId: string | null }
  | { type: 'filter'; query: string }
  | {
      type: 'move';
      sourceIds: string[];
      targetParentId: string | null;
      beforeId: string | null;
      expectedVersion: string;
    };
export type TreeRequest = TreeEnvelope &
  (
    | {
        kind: 'children';
        parentId: string | null;
        generation: number;
        cursor: string | null;
        refresh?: boolean;
      }
    | { kind: 'render'; nodes: { id: string; revision: number }[] }
    | { kind: 'search'; query: string; queryGeneration: number; cursor: string | null }
    | { kind: 'path'; nodeId: string }
    | { kind: 'cancel'; targetRequestId: string }
    | { kind: 'command'; operationId: string; command: TreeCommand }
  );
export interface TreeWireEvent {
  treeId: string;
  dataEpoch: string;
  nodeId: string | null;
  type: TreeNodeEventName | TreeEventName | 'action';
  selectedIds: string[];
  focusedId: string | null;
  actionId?: string;
  query?: string;
  expanded?: boolean;
  reason: 'pointer' | 'keyboard' | 'api' | 'retry';
}
export interface TreeEvent extends NormalizedUIEvent {
  tree: {
    nodeId: string | null;
    node: TreeItemSnapshot | null;
    selectedIds: string[];
    focusedId: string | null;
    expanded?: boolean;
    query?: string;
    actionId?: string;
    reason: TreeWireEvent['reason'];
    move?: { sourceIds: string[]; targetParentId: string | null; beforeId: string | null };
    error?: { code: string; message: string };
  };
}
export interface NodeRecord {
  item: TreeItem;
  parentId: string | null;
  childIds: string[];
  nodeRevision: number;
}
export interface ChildListState {
  ids: string[];
  status: 'unloaded' | 'loading' | 'loaded' | 'error';
  complete: boolean;
  nextCursor: string | null;
  generation: number;
  error?: { code: string; message: string };
}
export interface TreePatch {
  upsert?: NodeRecord[];
  lists?: [string | null, ChildListState][];
  remove?: string[];
  invalidate?: (string | null)[];
  version?: string | null;
}
export type TreeResponse = TreeEnvelope & {
  sequence: number;
  kind: TreeRequest['kind'];
  patch?: TreePatch;
  page?: TreeSearchPage;
  path?: TreePathResult;
  rows?: { id: string; revision: number; view: TreeRowView }[];
  accepted?: boolean;
  operationId?: string;
  command?: TreeCommand;
  saved?: boolean;
  message?: string;
  error?: { code: string; message: string; retryable: boolean };
};
export interface TreeViewState {
  expandedIds: Set<string>;
  selectedIds: Set<string>;
  focusedId: string | null;
  rangeAnchorId: string | null;
  query: string;
}
export interface TreeFieldAdapter {
  readValue(): TreeValue;
  writeValue(value: FieldValue): void;
  focus(): void;
  captureState(): TreeViewState;
  restoreState(state: TreeViewState): void;
  dispose(): void;
}
export const TREE_LIMITS = {
  page: 200,
  pageBytes: 49152,
  render: 32,
  nodes: 10000,
  bytes: 16777216,
  instanceNodes: 20000,
  instanceBytes: 33554432,
  selected: 500,
  depth: 128,
  concurrent: 4,
  instanceConcurrent: 8,
  parts: 32,
  actions: 4,
  programs: 512,
};
