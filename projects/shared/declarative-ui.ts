/** Data-only contracts shared by the plugin host, workbench and sandbox renderer. */
export type UIValue = null | boolean | number | string | UIValue[] | { [key: string]: UIValue };
export type FieldValue = string | boolean | string[];
export type UISurface =
  | 'mainSidebar'
  | 'auxiliarySidebar'
  | 'statusBar'
  | 'tooltip'
  | 'contextMenu'
  | 'currentPage';
export const UI_UNAVAILABLE = '<无数据，需要打开插件页面>';
export const UI_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const UI_LIMITS = {
  bytes: 262144,
  valueBytes: 65536,
  nodes: 2000,
  depth: 20,
  bindings: 512,
  fields: 256,
  subscriptions: 128,
  steps: 64,
};
export class UIError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
export function uiAssert(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) {
    throw new UIError(code, message);
  }
}
export function uiName(value: unknown): asserts value is string {
  uiAssert(
    typeof value === 'string' && UI_NAME.test(value),
    'UI_INVALID_HANDLER_NAME',
    '名称必须为 1–64 位字母、数字、点、下划线或横线',
  );
}
export function safeKey(key: string) {
  uiAssert(
    !key.split('.').some((p) => ['__proto__', 'prototype', 'constructor'].includes(p)),
    'UI_INVALID_VALUE_TYPE',
    '不允许原型键',
  );
}
export function uiValue(value: unknown, limit = UI_LIMITS.valueBytes): UIValue {
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): UIValue => {
    uiAssert(depth <= 20, 'UI_QUOTA_EXCEEDED', '数据嵌套过深');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') {
      return v;
    }
    if (typeof v === 'number') {
      uiAssert(Number.isFinite(v), 'UI_INVALID_VALUE_TYPE', '数字必须有限');
      return v;
    }
    uiAssert(
      typeof v === 'object' && v !== null && !seen.has(v),
      'UI_INVALID_VALUE_TYPE',
      '仅支持无循环的 JSON 数据',
    );
    uiAssert(
      Array.isArray(v) || [Object.prototype, null].includes(Object.getPrototypeOf(v)),
      'UI_INVALID_VALUE_TYPE',
      '不支持该对象类型',
    );
    seen.add(v);
    let result: UIValue;
    if (Array.isArray(v)) {
      result = v.map((item) => visit(item, depth + 1));
    } else {
      const entries = Object.entries(v);
      result = Object.fromEntries(
        entries.map(([key, item]) => {
          safeKey(key);
          return [key, visit(item, depth + 1)];
        }),
      );
    }
    seen.delete(v);
    return result;
  };
  const result = visit(value, 0);
  uiAssert(
    new TextEncoder().encode(JSON.stringify(result)).length <= limit,
    'UI_QUOTA_EXCEEDED',
    '数据超过大小限制',
  );
  return result;
}
export interface NormalizedUIEvent {
  type: string;
  phase?: 'enter' | 'leave';
  name?: string;
  value?: FieldValue;
  values?: Record<string, FieldValue>;
  modifiers?: { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean };
}
export interface HandlerContext {
  invocation: 'event' | 'render' | 'watch';
  eventId?: string;
  instanceId: string;
  windowId: string;
  workspaceId: string;
  source: { kind: UISurface; viewId: string; name?: string };
  sourceTabId: string | null;
  event?: NormalizedUIEvent;
  readValue(name: string): FieldValue;
  signal: AbortSignal;
}
export interface HandlerDefinition {
  readOnly?: boolean;
  reads?: string[];
  run(this: HandlerContext, ...args: UIValue[]): UIValue | void | Promise<UIValue | void>;
  watch?(
    this: HandlerContext,
    args: UIValue[],
    emit: (value: UIValue) => void,
  ): (() => void) | Promise<() => void>;
}
export interface RenderContext {
  pluginId: string;
  instanceId: string;
  windowId: string;
  workspaceId: string;
  viewId: string;
  tabId: string | null;
  sourceTabId: string | null;
  signal: AbortSignal;
}
export type UIContent =
  | { format: 'html'; version: 1; html: string }
  | { format: 'json'; version: 1; root: UINode };
export type ContentSource<T> = T | ((context: RenderContext) => T | Promise<T>);
export type IconRef = { kind: 'asset'; path: string } | { kind: 'builtin'; name: string };
export interface UINode {
  type: string;
  key?: string;
  name?: string;
  for?: string | string[];
  children?: UINode[];
  tabs?: UITab[];
  events?: Record<string, string>;
  [key: string]: unknown;
}
export interface UITab {
  id: string;
  label: string;
  children: UINode[];
}
export interface SidebarDefinition {
  id: string;
  title: string;
  icon: IconRef;
  content: ContentSource<UIContent>;
}
export interface AuxiliaryDefinition extends SidebarDefinition {
  hideCurrentPage?: boolean;
}
export type MenuItem =
  | {
      kind: 'item';
      id: string;
      label: string;
      icon?: IconRef;
      disabled?: boolean | string;
      action: string;
    }
  | {
      kind: 'checkbox';
      id: string;
      label: string;
      checked: boolean | string;
      disabled?: boolean | string;
      action: string;
    }
  | { kind: 'submenu'; id: string; label: string; children: MenuItem[] }
  | { kind: 'separator' };
export interface StatusBarDefinition {
  id: string;
  ariaLabel: string;
  text?: string;
  icon?: IconRef;
  alignment?: 'left' | 'right';
  priority?: number;
  visible?: boolean | string;
  disabled?: boolean | string;
  events?: Record<string, string>;
  tooltip?: {
    content: ContentSource<UIContent | { format: 'text'; text: string }>;
    width?: number;
  };
  contextMenu?: MenuItem[];
}
export interface Disposable {
  dispose(): Promise<void>;
}
export interface SidebarHandle extends Disposable {
  set(def: SidebarDefinition): Promise<void>;
  setContent(content: UIContent, target?: { instanceId: string }): Promise<void>;
}
export interface AuxiliaryHandle extends Disposable {
  set(def: AuxiliaryDefinition): Promise<void>;
  setContent(content: UIContent, target?: { instanceId: string }): Promise<void>;
  setCurrentPageVisible(visible: boolean): Promise<void>;
}
export interface InspectorData {
  title?: string;
  properties: { key: string; label: string; value: string }[];
}
export interface InspectorProvider {
  provide(context: {
    pluginId: string;
    windowId: string;
    workspaceId: string;
    tabId: string | null;
    locator: { path: string; search: string; hash: string } | null;
    signal: AbortSignal;
  }): InspectorData | Promise<InspectorData>;
}
export interface PluginUI {
  apis: {
    mountStatic(
      path: string,
      source: { file: string } | { directory: string },
    ): Promise<Disposable>;
  };
  handlers: { register(name: string, definition: HandlerDefinition): Promise<Disposable> };
  registerMainSidebar(def: SidebarDefinition): Promise<SidebarHandle>;
  registerAuxiliarySidebar(def: AuxiliaryDefinition): Promise<AuxiliaryHandle>;
  registerStatusBar(
    def: StatusBarDefinition,
  ): Promise<Disposable & { set(def: StatusBarDefinition): Promise<void> }>;
  inspector: {
    register(
      def: InspectorProvider,
    ): Promise<Disposable & { invalidate(target?: { tabId: string }): Promise<void> }>;
  };
  transaction(run: (draft: PluginUI) => void | Promise<void>): Promise<void>;
}
export type ArgumentNode =
  | { type: 'literal'; value: UIValue }
  | { type: 'event' }
  | { type: 'prev' }
  | { type: 'field'; name: string }
  | { type: 'array'; items: ArgumentNode[] }
  | { type: 'object'; entries: [string, ArgumentNode][] }
  | CallNode;
export interface CallNode {
  type: 'call';
  name: string;
  args: ArgumentNode[];
  watch: boolean;
  domain: 'backend' | 'frontend';
}
export interface UIProgram {
  branches: CallNode[][];
}
export type TemplatePart = string | ArgumentNode;
export interface SafeNode {
  id: string;
  tag?: string;
  text?: string;
  attrs?: Record<string, string>;
  children?: SafeNode[];
  key?: string;
}
export interface UIField {
  name: string;
  nodeId: string;
  kind: 'string' | 'boolean' | 'multiple';
  form?: string;
}
export interface UIEventBinding {
  id: string;
  nodeId: string;
  event: string;
  program: UIProgram;
  for: string[];
  capture: string[];
}
export interface UIExpressionBinding {
  id: string;
  nodeId: string;
  attribute?: string;
  parts: TemplatePart[];
}
export interface CompiledUI {
  format: 'html' | 'json';
  nodes: SafeNode[];
  fields: UIField[];
  events: UIEventBinding[];
  expressions: UIExpressionBinding[];
  styles: string[];
}
export interface UIContribution {
  pluginId: string;
  ownerEpoch: string;
  surface: UISurface;
  id: string;
  title: string;
  icon?: IconRef;
  hideCurrentPage?: boolean;
  alignment?: 'left' | 'right';
  priority?: number;
  hasTooltip?: boolean;
  hasContextMenu?: boolean;
}
export interface ClientEffect {
  id: string;
  type: string;
  args: UIValue[];
  instanceId: string;
  renderRevision: number;
}
export interface UIWireRegistry {
  handlers: { name: string; readOnly: boolean; watch: boolean; reads: string[] }[];
  views: { surface: UISurface; definition: Record<string, UIValue> }[];
  mounts: { path: string; file?: string; directory?: string }[];
  inspector: boolean;
}

export const hasOwn = (value: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(value, key);
