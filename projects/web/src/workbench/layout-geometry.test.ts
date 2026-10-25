import { describe, expect, it } from 'vitest';
import {
  activitySlots,
  dragHorizontal,
  applyHorizontalDrag,
  type HorizontalDrag,
  applySidebarDrag,
  dragBottomPanel,
  dragSidebar,
  fitWorkbench,
  minimumNode,
  splitExtent,
} from './layout-geometry.ts';
const metrics = {
  activityWidth: 40,
  topbarHeight: 36,
  statusbarHeight: 32,
  splitterSize: 4,
  activityItemHeight: 28,
  activityGap: 4,
  activityPadding: 8,
};
import type { LayoutNode, WorkspaceSnapshot } from './types.ts';
const group = (id: string): LayoutNode => ({
  kind: 'group',
  id,
  tabIds: [],
  activeTabId: null,
  tabBarPosition: 'top',
});
const layout = (): WorkspaceSnapshot['layout'] => ({
  schemaVersion: 1,
  mainSidebar: { visible: true, side: 'left', size: 280, view: 'pages', openPagesRatio: 0.6 },
  auxiliarySidebar: { visible: true, size: 280 },
  panel: {
    dock: 'bottom',
    align: 'center',
    visible: true,
    height: 240,
    width: 360,
    activeView: 'output',
    terminalListSize: 200,
  },
  center: group('g'),
  focusedGroupId: 'g',
});

describe('window compression priorities', () => {
  it.each([
    [1280, 280, 280, 680],
    [1000, 240, 280, 440],
    [816, 168, 168, 440],
    [800, 168, 168, 424],
    [640, 168, 168, 264],
    [376, 168, 168, 0],
    [180, 168, 168, 0],
  ])('fits width %i without changing visibility or preferred sizes', (width, main, aux, center) => {
    const value = layout(),
      before = structuredClone(value);
    const result = fitWorkbench(value, width, 800, metrics);
    expect([result.mainWidth, result.auxWidth, result.centerWidth]).toEqual([main, aux, center]);
    expect(result.shellWidth).toBe(Math.max(376, width));
    expect(value).toEqual(before);
  });
  it.each([
    [800, 492, 240, 800],
    [300, 70, 162, 300],
    [216, 70, 78, 216],
    [100, 70, 78, 216],
  ])('fits height %i in center then panel order', (height, center, panel, outer) => {
    const result = fitWorkbench(layout(), 1280, height, metrics);
    expect([result.centerHeight, result.panelHeight, result.height]).toEqual([
      center,
      panel,
      outer,
    ]);
  });
  it('keeps a maximized panel tall and releases the center minimum', () => {
    const result = fitWorkbench(layout(), 1280, 100, metrics, false, true);
    expect([result.centerHeight, result.panelHeight, result.height]).toEqual([0, 100, 168]);
  });
});

describe('sidebar drag thresholds and coupled resizing', () => {
  const start = {
    visible: true,
    size: 280,
    oppositeVisible: true,
    oppositeSize: 280,
    availableWidth: 1240,
  };
  it.each([
    [168, true, 168],
    [85, true, 168],
    [84, false, 168],
  ])('holds the minimum then hides at requested width %i', (requested, visible, size) => {
    expect(dragSidebar(start, requested - 280)).toMatchObject({ visible, size });
  });
  it.each([
    [83, false, 168],
    [84, true, 168],
    [167, true, 168],
    [168, true, 168],
    [188, true, 188],
  ])('restores a hidden sidebar at %i', (delta, visible, size) => {
    expect(dragSidebar({ ...start, visible: false }, delta)).toMatchObject({ visible, size });
  });
  it.each([
    [520, 520, true, 280, 440],
    [600, 600, true, 200, 440],
    [632, 632, true, 168, 440],
    [715, 632, true, 168, 440],
    [716, 716, false, 168, 524],
    [758, 758, false, 168, 482],
    [800, 800, false, 168, 440],
    [900, 800, false, 168, 440],
  ])(
    'allocates width %i with a half-minimum collapse threshold',
    (requested, size, oppositeVisible, oppositeSize, center) => {
      const result = dragSidebar(start, requested - start.size);
      expect(result).toEqual({ visible: true, size, oppositeVisible, oppositeSize });
      expect(
        start.availableWidth - result.size - (result.oppositeVisible ? result.oppositeSize : 0),
      ).toBe(center);
    },
  );
  it('reverses auto-collapse within the gesture and fixes it after release', () => {
    expect(dragSidebar(start, 716 - 280).oppositeVisible).toBe(false);
    expect(dragSidebar(start, 715 - 280).oppositeVisible).toBe(true);
    expect(
      dragSidebar({ ...start, size: 800, oppositeVisible: false, oppositeSize: 168 }, -100),
    ).toMatchObject({ size: 700, oppositeVisible: false });
  });
  it.each(['mainSidebar', 'auxiliarySidebar'] as const)(
    'applies the same compression when %s is revealed',
    (part) => {
      const value = layout();
      applySidebarDrag(value, part, { ...start, visible: false }, 716);
      const other = part === 'mainSidebar' ? 'auxiliarySidebar' : 'mainSidebar';
      expect(value[part]).toMatchObject({ visible: true, size: 716 });
      expect(value[other]).toMatchObject({ visible: false, size: 168 });
    },
  );
});

describe('bottom panel snapping', () => {
  const start = { visible: true, height: 240, maximized: false, availableHeight: 740 };
  it.each([
    [40, true, 78],
    [39, false, 78],
  ])('shrinks to requested height %i', (height, visible, actual) => {
    expect(dragBottomPanel(start, height - 240)).toEqual({
      visible,
      height: actual,
      maximized: false,
    });
  });
  it.each([
    [38, false, 78],
    [39, true, 78],
    [77, true, 78],
    [78, true, 78],
    [100, true, 100],
  ])('reveals from hidden after %i pixels', (delta, visible, height) => {
    expect(dragBottomPanel({ ...start, visible: false }, delta)).toEqual({
      visible,
      height,
      maximized: false,
    });
  });
  it('pauses at the center minimum, maximizes after half the center minimum, and reverses', () => {
    expect(dragBottomPanel(start, 670 - 240)).toEqual({
      visible: true,
      height: 670,
      maximized: false,
    });
    expect(dragBottomPanel(start, 704 - 240)).toEqual({
      visible: true,
      height: 670,
      maximized: false,
    });
    expect(dragBottomPanel(start, 705 - 240)).toEqual({
      visible: true,
      height: 740,
      maximized: true,
    });
    const maximized = { ...start, maximized: true };
    expect(dragBottomPanel(maximized, -34).maximized).toBe(true);
    expect(dragBottomPanel(maximized, -35)).toEqual({
      visible: true,
      height: 670,
      maximized: false,
    });
    expect(dragBottomPanel(maximized, -69).height).toBe(670);
    expect(dragBottomPanel(maximized, -71).height).toBe(669);
  });
});

describe('leaf group sizing and activity overflow', () => {
  const node: Extract<LayoutNode, { kind: 'split' }> = {
    kind: 'split',
    id: 's',
    axis: 'horizontal',
    ratio: 0.3,
    first: group('a'),
    second: group('b'),
  };
  it('retains unequal sizes while sharing each width change equally', () => {
    const before = splitExtent(node, 1004, metrics.splitterSize);
    const after = splitExtent(node, 1104, metrics.splitterSize, before);
    expect([before.first, before.available - before.first]).toEqual([300, 700]);
    expect([after.first, after.available - after.first]).toEqual([350, 750]);
    const small = splitExtent(node, 444, metrics.splitterSize, after);
    expect([small.first, small.available - small.first]).toEqual([220, 220]);
  });
  it('computes nested minima and shares changes across final horizontal groups', () => {
    const nested = {
      ...node,
      ratio: 0.5,
      second: { ...node, id: 'nested', first: group('b'), second: group('c') },
    };
    expect(minimumNode(nested, metrics.splitterSize)).toEqual({ width: 668, height: 70 });
    const before = splitExtent(nested, 1004, metrics.splitterSize);
    const after = splitExtent(nested, 1094, metrics.splitterSize, before);
    expect(after.first - before.first).toBeCloseTo(30);
    expect(after.available - after.first - (before.available - before.first)).toBeCloseTo(60);
    expect(minimumNode({ ...node, axis: 'vertical' }, metrics.splitterSize)).toEqual({
      width: 220,
      height: 144,
    });
  });
  it.each([
    [100, 0, true],
    [132, 1, true],
    [196, 3, true],
    [228, 5, false],
  ])(
    'preserves settings and makes excess views available at height %i',
    (height, visible, overflow) => {
      expect(activitySlots(height, 5, metrics)).toEqual({ visible, overflow });
    },
  );
});

it('shares shrinking equally among remaining leaves after a nested group reaches its minimum', () => {
  const second: Extract<LayoutNode, { kind: 'split' }> = {
    kind: 'split',
    id: 'inner',
    axis: 'horizontal',
    ratio: 0.2,
    first: group('b'),
    second: group('c'),
  };
  const root: Extract<LayoutNode, { kind: 'split' }> = {
    kind: 'split',
    id: 'outer',
    axis: 'horizontal',
    ratio: 0.3,
    first: group('a'),
    second,
  };
  const before = splitExtent(root, 1004, metrics.splitterSize);
  const innerBefore = splitExtent(second, 700, metrics.splitterSize);
  const extents = new Map([
    ['outer', before],
    ['inner', innerBefore],
  ]);
  const after = splitExtent(root, 944, metrics.splitterSize, before, extents);
  const innerAfter = splitExtent(
    second,
    after.available - after.first,
    metrics.splitterSize,
    innerBefore,
    extents,
  );
  expect([before.first, innerBefore.first, innerBefore.available - innerBefore.first]).toEqual([
    300, 220, 476,
  ]);
  expect([after.first, innerAfter.first, innerAfter.available - innerAfter.first]).toEqual([
    270, 220, 446,
  ]);
});

it('uses measured chrome and controls when deciding compression and scroll boundaries', () => {
  const custom = {
    ...metrics,
    activityWidth: 52,
    topbarHeight: 42,
    statusbarHeight: 38,
    activityItemHeight: 40,
    activityGap: 6,
    activityPadding: 12,
  };
  const small = fitWorkbench(layout(), 300, 100, custom);
  expect([small.shellWidth, small.height, small.centerHeight, small.panelHeight]).toEqual([
    388, 228, 70, 78,
  ]);
  expect(activitySlots(144, 5, custom)).toEqual({ visible: 0, overflow: true });
  expect(activitySlots(190, 5, custom)).toEqual({ visible: 1, overflow: true });
});

it('clamps legacy saved sizes using the new independent minima', () => {
  const value = layout();
  value.mainSidebar.size = 100;
  value.auxiliarySidebar.size = 100;
  value.panel.height = 70;
  const result = fitWorkbench(value, 1280, 800, metrics);
  expect([result.mainWidth, result.auxWidth, result.panelHeight]).toEqual([168, 168, 78]);
});

const horizontal = (
  mainSide: 'left' | 'right' = 'left',
  panelDock: 'left' | 'right' = 'left',
): HorizontalDrag => ({
  availableWidth: 1800,
  mainSide,
  panelDock,
  mainSidebar: { visible: true, size: 280 },
  auxiliarySidebar: { visible: true, size: 280 },
  panel: { visible: true, size: 360 },
});

describe('lateral panel sizing', () => {
  it.each([
    [1840, 280, 280, 360, 880],
    [1280, 168, 272, 360, 440],
    [1200, 168, 192, 360, 440],
    [1100, 168, 168, 284, 440],
    [1036, 168, 168, 220, 440],
    [1000, 168, 168, 220, 404],
    [500, 168, 168, 220, 0],
  ])(
    'compresses center, main, auxiliary and panel in order at width %i',
    (width, main, aux, panel, center) => {
      const value = layout();
      value.panel.dock = 'left';
      const result = fitWorkbench(value, width, 800, metrics);
      expect([result.mainWidth, result.auxWidth, result.panelWidth, result.centerWidth]).toEqual([
        main,
        aux,
        panel,
        center,
      ]);
      expect(result.shellWidth).toBe(Math.max(width, 596));
      expect(value.panel.visible).toBe(true);
    },
  );
  it.each([
    [109, false, 220],
    [110, true, 220],
    [219, true, 220],
    [220, true, 220],
    [221, true, 221],
  ])('reveals at a half-minimum width of %i', (delta, visible, size) => {
    const start = horizontal();
    start.panel.visible = false;
    expect(dragHorizontal(start, 'panel', delta).panel).toEqual({ visible, size });
  });
  it.each([
    [220, true],
    [111, true],
    [110, false],
  ])('collapses only after crossing a requested panel width of %i', (requested, visible) => {
    expect(dragHorizontal(horizontal(), 'panel', requested - 360).panel).toEqual({
      visible,
      size: 220,
    });
  });
  it.each(['left', 'right'] as const)(
    'grows a %s panel by compressing only the far sidebar, including swapped sidebar positions',
    (dock) => {
      for (const mainSide of ['left', 'right'] as const) {
        const start = horizontal(mainSide, dock);
        const far = mainSide === dock ? 'auxiliarySidebar' : 'mainSidebar';
        const near = far === 'mainSidebar' ? 'auxiliarySidebar' : 'mainSidebar';
        for (const [requested, size, farVisible, farSize, center] of [
          [800, 800, true, 280, 440],
          [850, 850, true, 230, 440],
          [912, 912, true, 168, 440],
          [995, 912, true, 168, 440],
          [996, 996, false, 168, 524],
          [1040, 1040, false, 168, 480],
          [1080, 1080, false, 168, 440],
          [1200, 1080, false, 168, 440],
        ] as const) {
          const result = dragHorizontal(start, 'panel', requested - 360);
          expect(result.panel).toEqual({ visible: true, size });
          expect(result[far]).toEqual({ visible: farVisible, size: farSize });
          expect(result[near]).toEqual({ visible: true, size: 280 });
          expect(result.centerWidth).toBe(center);
        }
        expect(dragHorizontal(start, 'panel', 995 - 360)[far].visible).toBe(true);
        const released = dragHorizontal(start, 'panel', 1080 - 360);
        const shrink = dragHorizontal({ ...start, ...released }, 'panel', -100);
        expect(shrink[far].visible).toBe(false);
        expect(shrink.centerWidth).toBe(540);
      }
    },
  );
  it.each(['mainSidebar', 'auxiliarySidebar'] as const)(
    'uses the panel as a donor before hiding the opposite sidebar when %s grows',
    (part) => {
      for (const dock of ['left', 'right'] as const) {
        const start = horizontal('left', dock),
          before = structuredClone(start);
        const other = part === 'mainSidebar' ? 'auxiliarySidebar' : 'mainSidebar';
        for (const [requested, size, otherVisible, otherSize, panelVisible, panelSize, center] of [
          [720, 720, true, 280, true, 360, 440],
          [800, 800, true, 200, true, 360, 440],
          [832, 832, true, 168, true, 360, 440],
          [900, 900, true, 168, true, 292, 440],
          [972, 972, true, 168, true, 220, 440],
          [1081, 972, true, 168, true, 220, 440],
          [1082, 1082, true, 168, false, 220, 550],
          [1192, 1192, true, 168, false, 220, 440],
          [1275, 1192, true, 168, false, 220, 440],
          [1276, 1276, false, 168, false, 220, 524],
          [1360, 1360, false, 168, false, 220, 440],
          [1600, 1360, false, 168, false, 220, 440],
        ] as const) {
          const result = dragHorizontal(start, part, requested - 280);
          expect(result[part]).toEqual({ visible: true, size });
          expect(result[other]).toEqual({ visible: otherVisible, size: otherSize });
          expect(result.panel).toEqual({ visible: panelVisible, size: panelSize });
          expect(result.centerWidth).toBe(center);
        }
        expect(start).toEqual(before);
        const released = dragHorizontal(start, part, 1082 - 280);
        const shrink = dragHorizontal({ ...start, ...released }, part, -100);
        expect(shrink.panel.visible).toBe(false);
        expect(shrink.centerWidth).toBe(650);
        expect(dragHorizontal(start, part, 1081 - 280).panel.visible).toBe(true);
        expect(dragHorizontal(start, part, 1275 - 280)[other].visible).toBe(true);
      }
    },
  );
  it('persists lateral panel collapse without changing the bottom panel geometry or layout tree', () => {
    const value = layout();
    value.panel.dock = 'right';
    const center = structuredClone(value.center);
    applyHorizontalDrag(value, 'mainSidebar', horizontal('left', 'right'), 1082 - 280);
    expect(value.panel).toMatchObject({ visible: false, width: 220, height: 240 });
    expect(value.center).toEqual(center);
    const result = fitWorkbench(value, 1840, 800, metrics);
    expect([result.mainWidth, result.auxWidth, result.panelWidth, result.centerWidth]).toEqual([
      1082, 168, 0, 550,
    ]);
  });
});
