import type { LayoutNode, WorkspaceSnapshot } from './types.ts';

export const MIN_CENTER_WIDTH = 440;
export const MIN_CENTER_HEIGHT = 70;
export const MIN_GROUP_WIDTH = 220;
export const MIN_GROUP_HEIGHT = 70;
export const MIN_SIDEBAR_WIDTH = 168;
export const MIN_PANEL_WIDTH = 440;
export const MIN_PANEL_HEIGHT = 78;
export const MIN_DOCKED_PANEL_WIDTH = 220;

/** Chrome and controls are measured from the rendered layout, not duplicated as pixel constants. */
export interface WorkbenchMetrics {
  activityWidth: number;
  topbarHeight: number;
  statusbarHeight: number;
  splitterSize: number;
  activityItemHeight: number;
  activityGap: number;
  activityPadding: number;
}
export function minimumActivityHeight(metrics: WorkbenchMetrics) {
  return metrics.activityItemHeight * 3 + metrics.activityGap * 2 + metrics.activityPadding;
}

type Layout = WorkspaceSnapshot['layout'];
export type Sidebar = 'mainSidebar' | 'auxiliarySidebar';
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Window resizing preserves visibility and preferred sizes; only the rendered sizes shrink. */
export function fitWorkbench(
  layout: Layout | undefined,
  width: number,
  height: number,
  metrics: WorkbenchMetrics,
  focused = false,
  maximized = false,
) {
  const main = !focused && Boolean(layout?.mainSidebar.visible);
  const aux = !focused && Boolean(layout?.auxiliarySidebar.visible);
  const panel = !focused && Boolean(layout?.panel.visible);
  const bottom = !layout || layout.panel.dock === 'bottom';
  const chromeHeight = metrics.topbarHeight + metrics.statusbarHeight;
  const shellWidth = Math.max(
    width,
    metrics.activityWidth +
      (main ? MIN_SIDEBAR_WIDTH : 0) +
      (aux ? MIN_SIDEBAR_WIDTH : 0) +
      (panel && !bottom ? MIN_DOCKED_PANEL_WIDTH : 0),
  );
  const minimumBodyHeight =
    maximized && panel
      ? MIN_PANEL_HEIGHT
      : MIN_CENTER_HEIGHT + (panel && bottom ? MIN_PANEL_HEIGHT : 0);
  const bodyHeight = Math.max(
    height - chromeHeight,
    minimumBodyHeight,
    minimumActivityHeight(metrics),
  );
  let panelWidth =
    panel && !bottom
      ? Math.max(MIN_DOCKED_PANEL_WIDTH, layout?.panel.width ?? MIN_DOCKED_PANEL_WIDTH)
      : 0;
  let mainWidth = main
    ? Math.max(MIN_SIDEBAR_WIDTH, layout?.mainSidebar.size ?? MIN_SIDEBAR_WIDTH)
    : 0;
  let auxWidth = aux
    ? Math.max(MIN_SIDEBAR_WIDTH, layout?.auxiliarySidebar.size ?? MIN_SIDEBAR_WIDTH)
    : 0;
  const horizontalWidth = shellWidth - metrics.activityWidth;
  let deficit = Math.max(0, MIN_CENTER_WIDTH + mainWidth + auxWidth + panelWidth - horizontalWidth);
  const mainReduction = Math.min(deficit, Math.max(0, mainWidth - MIN_SIDEBAR_WIDTH));
  mainWidth -= mainReduction;
  deficit -= mainReduction;
  const auxReduction = Math.min(deficit, Math.max(0, auxWidth - MIN_SIDEBAR_WIDTH));
  auxWidth -= auxReduction;
  deficit -= auxReduction;
  panelWidth -= Math.min(deficit, Math.max(0, panelWidth - MIN_DOCKED_PANEL_WIDTH));
  const availableWidth = horizontalWidth - panelWidth;
  const panelHeight =
    panel && bottom
      ? maximized
        ? bodyHeight
        : clamp(
            layout?.panel.height ?? MIN_PANEL_HEIGHT,
            MIN_PANEL_HEIGHT,
            bodyHeight - MIN_CENTER_HEIGHT,
          )
      : 0;
  return {
    shellWidth,
    bodyHeight,
    height: bodyHeight + chromeHeight,
    availableWidth,
    mainWidth,
    auxWidth,
    panelWidth,
    panelHeight,
    centerWidth: Math.max(0, availableWidth - mainWidth - auxWidth),
    centerHeight: maximized && panel ? 0 : bodyHeight - panelHeight,
  };
}

export interface SidebarDrag {
  visible: boolean;
  size: number;
  oppositeVisible: boolean;
  oppositeSize: number;
  availableWidth: number;
}

export type HorizontalPart = Sidebar | 'panel';
export interface HorizontalPane {
  visible: boolean;
  size: number;
}
export interface HorizontalDrag {
  availableWidth: number;
  mainSide: 'left' | 'right';
  panelDock: 'bottom' | 'left' | 'right';
  mainSidebar: HorizontalPane;
  auxiliarySidebar: HorizontalPane;
  panel: HorizontalPane;
}
const horizontalMinimum = (part: HorizontalPart) =>
  part === 'panel' ? MIN_DOCKED_PANEL_WIDTH : MIN_SIDEBAR_WIDTH;

/** Recompute every stage from pointerdown, including every collapse, to make reversal lossless. */
export function dragHorizontal(start: HorizontalDrag, part: HorizontalPart, delta: number) {
  const parts: HorizontalPart[] = ['mainSidebar', 'auxiliarySidebar', 'panel'];
  const panes = Object.fromEntries(
    parts.map((key) => [
      key,
      { visible: start[key].visible, size: Math.max(horizontalMinimum(key), start[key].size) },
    ]),
  ) as Record<HorizontalPart, HorizontalPane>;
  const minimum = horizontalMinimum(part);
  const requested = (start[part].visible ? start[part].size : 0) + delta;
  const active = panes[part];
  active.visible = start[part].visible ? requested > minimum / 2 : requested >= minimum / 2;
  active.size = minimum;
  const participating = (key: HorizontalPart) => key !== 'panel' || start.panelDock !== 'bottom';
  const otherWidth = () =>
    parts.reduce(
      (sum, key) =>
        sum + (key !== part && participating(key) && panes[key].visible ? panes[key].size : 0),
      0,
    );
  if (active.visible) {
    active.size = Math.max(minimum, requested);
    const opposite: Sidebar =
      part === 'panel'
        ? start.mainSide === start.panelDock
          ? 'auxiliarySidebar'
          : 'mainSidebar'
        : part === 'mainSidebar'
          ? 'auxiliarySidebar'
          : 'mainSidebar';
    const donors: HorizontalPart[] = [opposite];
    if (part !== 'panel' && start.panelDock !== 'bottom' && panes.panel.visible) {
      donors.push('panel');
    }
    let deficit = Math.max(0, active.size + otherWidth() + MIN_CENTER_WIDTH - start.availableWidth);
    for (const key of donors) {
      if (!panes[key].visible) {
        continue;
      }
      const reduction = Math.min(deficit, Math.max(0, panes[key].size - horizontalMinimum(key)));
      panes[key].size -= reduction;
      deficit -= reduction;
    }
    // A docked panel hides before the opposite sidebar. Each released width is
    // shared equally between the dragged pane and center at its half-minimum threshold.
    const collapses = part === 'panel' ? [opposite] : [...donors].reverse();
    for (const key of collapses) {
      if (!panes[key].visible) {
        continue;
      }
      const limit = Math.max(minimum, start.availableWidth - MIN_CENTER_WIDTH - otherWidth());
      if (active.size <= limit) {
        break;
      }
      if (requested < limit + horizontalMinimum(key) / 2) {
        active.size = limit;
        break;
      }
      panes[key].visible = false;
      panes[key].size = horizontalMinimum(key);
    }
    active.size = Math.min(
      active.size,
      Math.max(minimum, start.availableWidth - MIN_CENTER_WIDTH - otherWidth()),
    );
  }
  return {
    ...panes,
    centerWidth: Math.max(
      0,
      start.availableWidth - otherWidth() - (active.visible ? active.size : 0),
    ),
  };
}

export function applyHorizontalDrag(
  layout: Layout,
  part: HorizontalPart,
  start: HorizontalDrag,
  delta: number,
) {
  const result = dragHorizontal(start, part, delta);
  for (const key of ['mainSidebar', 'auxiliarySidebar'] as const) {
    Object.assign(layout[key], result[key]);
  }
  if (layout.panel.dock !== 'bottom') {
    layout.panel.visible = result.panel.visible;
    layout.panel.width = result.panel.size;
  }
}

/** Two-sidebar adapter for consumers that do not have a lateral panel. */
export function dragSidebar(start: SidebarDrag, delta: number) {
  const result = dragHorizontal(
    {
      availableWidth: start.availableWidth,
      mainSide: 'left',
      panelDock: 'bottom',
      mainSidebar: { visible: start.visible, size: start.size },
      auxiliarySidebar: { visible: start.oppositeVisible, size: start.oppositeSize },
      panel: { visible: false, size: MIN_DOCKED_PANEL_WIDTH },
    },
    'mainSidebar',
    delta,
  );
  return {
    visible: result.mainSidebar.visible,
    size: result.mainSidebar.size,
    oppositeVisible: result.auxiliarySidebar.visible,
    oppositeSize: result.auxiliarySidebar.size,
  };
}

export function applySidebarDrag(layout: Layout, part: Sidebar, start: SidebarDrag, delta: number) {
  const opposite = part === 'mainSidebar' ? 'auxiliarySidebar' : 'mainSidebar';
  const result = dragSidebar(start, delta);
  Object.assign(layout[part], { visible: result.visible, size: result.size });
  Object.assign(layout[opposite], { visible: result.oppositeVisible, size: result.oppositeSize });
}

export function dragBottomPanel(
  start: { visible: boolean; height: number; maximized: boolean; availableHeight: number },
  delta: number,
) {
  const availableHeight = Math.max(start.availableHeight, MIN_CENTER_HEIGHT + MIN_PANEL_HEIGHT);
  const requested = (start.maximized ? availableHeight : start.visible ? start.height : 0) + delta;
  const revealThreshold = MIN_PANEL_HEIGHT / 2;
  const maximizeThreshold = MIN_CENTER_HEIGHT / 2;
  const visible = start.visible ? requested > revealThreshold : requested >= revealThreshold;
  const maximized =
    visible &&
    (start.maximized
      ? requested > availableHeight - maximizeThreshold
      : requested >= availableHeight - maximizeThreshold);
  return {
    visible,
    maximized,
    height: maximized
      ? availableHeight
      : clamp(requested, MIN_PANEL_HEIGHT, availableHeight - MIN_CENTER_HEIGHT),
  };
}

export function minimumNode(
  node: LayoutNode,
  splitterSize: number,
): { width: number; height: number } {
  if (node.kind === 'group') {
    return { width: MIN_GROUP_WIDTH, height: MIN_GROUP_HEIGHT };
  }
  const a = minimumNode(node.first, splitterSize),
    b = minimumNode(node.second, splitterSize);
  return node.axis === 'horizontal'
    ? { width: a.width + b.width + splitterSize, height: Math.max(a.height, b.height) }
    : { width: Math.max(a.width, b.width), height: a.height + b.height + splitterSize };
}

function axisWeight(node: LayoutNode, axis: 'horizontal' | 'vertical'): number {
  if (node.kind === 'group') {
    return 1;
  }
  const a = axisWeight(node.first, axis),
    b = axisWeight(node.second, axis);
  return node.axis === axis ? a + b : Math.max(a, b);
}

export interface SplitExtent {
  available: number;
  first: number;
  ratio: number;
  children: string;
}
/** Extent after giving every leaf the same pixel delta, freezing leaves at their minimum. */
function resizedExtent(
  node: LayoutNode,
  axis: 'horizontal' | 'vertical',
  extent: number,
  delta: number,
  extents: ReadonlyMap<string, SplitExtent>,
  splitterSize: number,
): number {
  if (node.kind === 'group') {
    return Math.max(axis === 'horizontal' ? MIN_GROUP_WIDTH : MIN_GROUP_HEIGHT, extent + delta);
  }
  if (node.axis !== axis) {
    return Math.max(
      resizedExtent(node.first, axis, extent, delta, extents, splitterSize),
      resizedExtent(node.second, axis, extent, delta, extents, splitterSize),
    );
  }
  const before = extents.get(node.id);
  const sizes =
    before?.ratio === node.ratio && before.children === `${node.first.id}:${node.second.id}`
      ? before
      : splitExtent(node, extent, splitterSize);
  return (
    resizedExtent(node.first, axis, sizes.first, delta, extents, splitterSize) +
    resizedExtent(node.second, axis, sizes.available - sizes.first, delta, extents, splitterSize) +
    splitterSize
  );
}

/** Share the change in pixels among leaves; once one branch reaches its minimum, give the rest to the other. */
export function splitExtent(
  node: Extract<LayoutNode, { kind: 'split' }>,
  extent: number,
  splitterSize: number,
  previous?: SplitExtent,
  extents: ReadonlyMap<string, SplitExtent> = new Map(),
): SplitExtent {
  const axis = node.axis === 'horizontal' ? 'width' : 'height';
  const firstMin = minimumNode(node.first, splitterSize)[axis],
    secondMin = minimumNode(node.second, splitterSize)[axis];
  const available = Math.max(firstMin + secondMin, extent - splitterSize);
  const children = `${node.first.id}:${node.second.id}`;
  const weight =
    axisWeight(node.first, node.axis) /
    (axisWeight(node.first, node.axis) + axisWeight(node.second, node.axis));
  let first =
    previous && previous.ratio === node.ratio && previous.children === children
      ? previous.first + (available - previous.available) * weight
      : available * node.ratio;
  if (
    previous &&
    previous.ratio === node.ratio &&
    previous.children === children &&
    available < previous.available
  ) {
    // A branch may contain both frozen and resizable leaves. Solve one shared pixel delta
    // across those leaves instead of continuing to count already frozen groups.
    let low = -previous.available,
      high = 0;
    for (let i = 0; i < 40; i++) {
      const delta = (low + high) / 2;
      const total =
        resizedExtent(node.first, node.axis, previous.first, delta, extents, splitterSize) +
        resizedExtent(
          node.second,
          node.axis,
          previous.available - previous.first,
          delta,
          extents,
          splitterSize,
        );
      if (total > available) {
        high = delta;
      } else {
        low = delta;
      }
    }
    first =
      Math.round(
        resizedExtent(
          node.first,
          node.axis,
          previous.first,
          (low + high) / 2,
          extents,
          splitterSize,
        ) * 1e6,
      ) / 1e6;
  }
  return {
    available,
    first: clamp(first, firstMin, available - secondMin),
    ratio: node.ratio,
    children,
  };
}

export function activitySlots(height: number, count: number, metrics: WorkbenchMetrics) {
  const stride = metrics.activityItemHeight + metrics.activityGap;
  const slots = Math.max(
    3,
    stride > 0 ? Math.floor((height - metrics.activityPadding + metrics.activityGap) / stride) : 3,
  );
  const overflow = count > slots - 2;
  return { visible: overflow ? slots - 3 : count, overflow };
}
