import type {
  Group,
  InternalPage,
  LayoutNode,
  PluginTab,
  Tab,
  WorkspaceSnapshot,
} from './types.ts';
import { pageNames } from './types.ts';
import { pruneEmptyGroups } from '../../../shared/workbench-layout.ts';
export const uid = () => crypto.randomUUID();
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const titleOf = (tab: Tab) =>
  tab.customTitle ||
  (tab.kind === 'plugin' ? tab.originalPageTitle || tab.originalPluginTitle : pageNames[tab.page]);
export function groups(node: LayoutNode): Group[] {
  return node.kind === 'group' ? [node] : [...groups(node.first), ...groups(node.second)];
}
export function findGroup(s: WorkspaceSnapshot, id = s.layout.focusedGroupId) {
  return groups(s.layout.center).find((g) => g.id === id) ?? groups(s.layout.center)[0];
}
export function activeTab(s: WorkspaceSnapshot): Tab | undefined {
  return s.tabs.find((t) => t.id === findGroup(s).activeTabId);
}
export function visit(node: LayoutNode, apply: (node: LayoutNode) => LayoutNode): LayoutNode {
  if (node.kind === 'split') {
    node = { ...node, first: visit(node.first, apply), second: visit(node.second, apply) };
  }
  return apply(node);
}
export function focusTab(s: WorkspaceSnapshot, id: string) {
  const group = groups(s.layout.center).find((g) => g.tabIds.includes(id)),
    tab = s.tabs.find((t) => t.id === id);
  if (!group || !tab) {
    return;
  }
  group.activeTabId = id;
  s.layout.focusedGroupId = group.id;
  tab.lastFocusedAt = new Date().toISOString();
  if (tab.kind === 'plugin') {
    s.focusedPluginTabId = id;
  }
}
export function addTab(s: WorkspaceSnapshot, tab: Tab, groupId = s.layout.focusedGroupId) {
  if (s.tabs.length >= 200) {
    throw new Error('已达到 200 个标签上限，请先整理页面。');
  }
  s.tabs.push(tab);
  findGroup(s, groupId).tabIds.push(tab.id);
  focusTab(s, tab.id);
}
export function internalTab(page: InternalPage): Tab {
  const now = new Date().toISOString();
  return {
    id: uid(),
    kind: 'internal',
    page,
    pinned: false,
    customTitle: null,
    createdAt: now,
    lastFocusedAt: now,
  };
}
export function newPluginTab(
  pluginId: string,
  title: string,
  url: string,
  locator: PluginTab['locator'],
): PluginTab {
  const now = new Date().toISOString();
  return {
    id: uid(),
    kind: 'plugin',
    pluginId,
    originalPluginTitle: title,
    originalPageTitle: title,
    customTitle: null,
    url,
    locator,
    pinned: false,
    keepAlive: false,
    createdAt: now,
    lastFocusedAt: now,
    navigation: { entries: [{ entryId: uid(), url, title, navigatedAt: now }], index: 0 },
    stateSnapshotId: null,
  };
}
export function splitGroup(
  s: WorkspaceSnapshot,
  axis: 'horizontal' | 'vertical',
  moveTabId?: string,
) {
  if (groups(s.layout.center).length >= 8) {
    throw new Error('已达到 8 个分组上限。');
  }
  const current = findGroup(s),
    next: Group = {
      kind: 'group',
      id: uid(),
      tabIds: [],
      activeTabId: null,
      tabBarPosition: current.tabBarPosition,
    };
  s.layout.center = visit(s.layout.center, (n) =>
    n.id === current.id
      ? { kind: 'split', id: uid(), axis, ratio: 0.5, first: n, second: next }
      : n,
  );
  s.layout.focusedGroupId = next.id;
  if (moveTabId) {
    moveTab(s, moveTabId, next.id);
  }
}
export function moveTab(s: WorkspaceSnapshot, id: string, target: string, index?: number) {
  if (!s.tabs.some((t) => t.id === id)) {
    return;
  }
  const destination = groups(s.layout.center).find((g) => g.id === target);
  if (!destination) {
    return;
  }
  for (const g of groups(s.layout.center)) {
    g.tabIds = g.tabIds.filter((t) => t !== id);
    if (g.activeTabId === id) {
      g.activeTabId = g.tabIds[0] ?? null;
    }
  }
  destination.tabIds.splice(index ?? destination.tabIds.length, 0, id);
  focusTab(s, id);
  pruneEmptyGroups(s);
}
export function mergeGroups(s: WorkspaceSnapshot) {
  const gs = groups(s.layout.center),
    target = findGroup(s);
  target.tabIds = gs.flatMap((g) => g.tabIds);
  target.activeTabId = target.activeTabId ?? target.tabIds[0] ?? null;
  s.layout.center = target;
  s.layout.focusedGroupId = target.id;
}
export function defaultLayout(s: WorkspaceSnapshot) {
  const g = findGroup(s);
  mergeGroups(s);
  s.layout = {
    schemaVersion: 1,
    mainSidebar: { side: 'left', visible: true, size: 280, view: 'pages', openPagesRatio: 0.6 },
    auxiliarySidebar: { visible: true, size: 280 },
    panel: {
      dock: 'bottom',
      align: 'center',
      visible: true,
      width: 360,
      height: 240,
      activeView: 'output',
      terminalListSize: 200,
    },
    center: { ...g, tabBarPosition: 'top' },
    focusedGroupId: g.id,
  };
}
export function navigateTab(
  tab: PluginTab,
  url: string,
  locator: PluginTab['locator'],
  mode: 'push' | 'replace' | 'traverse' = 'push',
  index?: number,
) {
  tab.url = url;
  tab.locator = locator;
  if (mode === 'traverse') {
    tab.navigation.index = index ?? tab.navigation.index;
    return;
  }
  const entry = {
    entryId: uid(),
    url,
    title: tab.originalPageTitle,
    navigatedAt: new Date().toISOString(),
  };
  if (mode === 'replace' && tab.navigation.index >= 0) {
    tab.navigation.entries[tab.navigation.index] = entry;
  } else {
    tab.navigation.entries = tab.navigation.entries.slice(0, tab.navigation.index + 1);
    tab.navigation.entries.push(entry);
    if (tab.navigation.entries.length > 500) {
      tab.navigation.entries.shift();
    }
    tab.navigation.index = tab.navigation.entries.length - 1;
  }
}
export function relocatedUrl(
  locator: PluginTab['locator'],
  installationId: string,
  original: string,
) {
  if (locator.installationId !== installationId) {
    throw new Error('记录属于另一套 SCWC 安装，请先重新绑定插件。');
  }
  const url = new URL(
    `/web/page/plugin/${encodeURIComponent(locator.pluginId)}${locator.path}`,
    location.origin,
  );
  url.search = locator.search;
  url.hash = locator.hash;
  // Preserve the exact query order and repeated keys stored by the locator.
  return url.href || original;
}
