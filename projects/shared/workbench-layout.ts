import type { LayoutNode, WorkspaceSnapshot } from '../server/workbench/workspace.ts';

/** Collapse empty leaves while retaining one empty root when the workspace has no tabs. */
export function pruneEmptyGroups(snapshot: WorkspaceSnapshot) {
  const prune = (node: LayoutNode): LayoutNode | undefined => {
    if (node.kind === 'group') {
      return node.tabIds.length ? node : undefined;
    }
    const first = prune(node.first),
      second = prune(node.second);
    return first && second ? { ...node, first, second } : (first ?? second);
  };
  const first = (node: LayoutNode): Extract<LayoutNode, { kind: 'group' }> =>
    node.kind === 'group' ? node : first(node.first);
  snapshot.layout.center = prune(snapshot.layout.center) ?? first(snapshot.layout.center);
  const contains = (node: LayoutNode): boolean =>
    node.kind === 'group'
      ? node.id === snapshot.layout.focusedGroupId
      : contains(node.first) || contains(node.second);
  if (!contains(snapshot.layout.center)) {
    snapshot.layout.focusedGroupId = first(snapshot.layout.center).id;
  }
}
