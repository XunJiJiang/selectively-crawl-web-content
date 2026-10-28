export type { WorkspaceSnapshot, LayoutNode } from '../../../server/workbench/workspace.ts';
export type { ConfigSnapshot, ConfigDefinition } from '../../../server/types/plugin-config.d.ts';
export type { InputRequest } from '../../../server/types/task.d.ts';
import type { WorkspaceSnapshot } from '../../../server/workbench/workspace.ts';
export type Tab = WorkspaceSnapshot['tabs'][number];
export type PluginTab = Extract<Tab, { kind: 'plugin' }>;
export type InternalPage = Extract<Tab, { kind: 'internal' }>['page'];
export type Group = Extract<WorkspaceSnapshot['layout']['center'], { kind: 'group' }>;
export interface CatalogItem {
  pluginId: string;
  title: string;
  description: string | null;
  version: string | null;
  enabled: boolean;
  runtime: { status: string; pid: number | null; reason: string | null };
  ui: {
    detection: string;
    state: string;
    entryUrl: string | null;
    buildCapability: string;
    diagnostics: { code: string; message: string }[];
  };
  diagnostics: { code: string; message: string }[];
  revision: number;
}
export interface PreferenceValues {
  bookmarkFolders?: { id: string; name: string; parentId?: string | null }[];
  bookmarkOrder?: string[];
  theme?: 'system' | 'light-2026' | 'dark-2026';
  keybindings?: Keybinding[];
  energy?: { enabled: boolean; idleMinutes: number };
}
export interface Keybinding {
  commandId: string;
  platform: 'all' | 'mac' | 'windows' | 'linux';
  context: string;
  keys: string[] | null;
}
export interface Preferences {
  values: PreferenceValues;
  revision: number;
}
export interface Bootstrap {
  installationId: string;
  coreBootId: string;
  catalogRevision: number;
  preferences: Preferences;
  commands: { name: string; description?: string; executable: boolean }[];
}
export interface Workspace {
  workspaceId: string;
  revision: number;
  snapshot: WorkspaceSnapshot;
  executions?: Execution[];
  inputs?: import('./types.ts').InputRequest[];
}
export interface Lease {
  workspaceId: string;
  token: string;
  expiresAt: number;
  clonedFrom?: string;
}
export interface Bookmark {
  folderId?: string | null;
  id: string;
  pluginId: string;
  url: string;
  locator: PluginTab['locator'];
  originalTitle: string;
  customTitle?: string | null;
  previewId?: string | null;
  revision: number;
}
export interface ClosedTab {
  closeId: string;
  closedAt: string;
  restoredAt: string | null;
  batchId: string;
  tab: PluginTab;
}
export type {
  NotificationState as Notification,
  TaskState as Job,
} from '../../../shared/workbench-feedback.ts';
export interface Terminal {
  id: string;
  title: string;
  draft: string;
  history: string[];
  archivedAt: string | null;
  revision: number;
}
export interface Execution {
  id: string;
  terminalId: string;
  coreBootId: string;
  status: string;
  command?: string;
  error?: string;
}
export interface OutputRecord {
  seq: number;
  streamId: string;
  timestamp: string;
  level?: string;
  text: string;
  source?: string;
  pluginId?: string;
  type?: 'prompt' | 'command' | 'output' | 'error' | 'warning' | 'info' | 'success';
  executionId?: string;
  coreBootId?: string;
  restored?: boolean;
}
export interface TerminalViewState {
  draft: string;
  historyCursor: number;
  historyDraft: string;
  historyLocked: boolean;
  selectionAnchor: number;
  selectionHead: number;
  follow: boolean;
  scrollTop: number;
  scrollAnchor?: { seq: number; offset: number };
}
export interface PageSession {
  grant: string;
  safeId: string;
  tabId: string;
  frameEpoch: string;
  expiresAt: number;
}
export interface ListPage<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}
export interface WorkbenchEvent {
  version: 1;
  eventId: string;
  coreBootId: string;
  stream: string;
  seq: number;
  type: string;
  entityId?: string;
  revision?: number;
  payload: unknown;
}
export const pageNames: Record<InternalPage, string> = {
  welcome: '欢迎',
  pages: '页面',
  settings: '设置',
  keybindings: '快捷键设置',
  search: '搜索结果',
  bookmarks: '收藏',
  history: '关闭历史',
  plugins: '插件管理',
};
export const runtimeNames: Record<string, string> = {
  ready: '运行中',
  starting: '启动中',
  disabled: '已禁用',
  stopped: '已停止',
  stopping: '停止中',
  failed: '运行失败',
  unresponsive: '无响应',
};
export const uiNames: Record<string, string> = {
  ready: '页面就绪',
  none: '无页面',
  unknown: '页面待探测',
  missing: '页面缺失',
  building: '构建中',
  error: '构建失败',
};

export const pageStateNames: Record<string, string> = {
  navigating: '加载中',
  'document-loaded': '文档已加载',
  ready: '就绪',
  stopped: '已停止',
  suspended: '已暂停',
  hibernating: '正在保存状态',
  restoring: '恢复中',
  'bridge-unavailable': '兼容模式',
  error: '加载失败',
  'restore-error': '恢复失败',
};
